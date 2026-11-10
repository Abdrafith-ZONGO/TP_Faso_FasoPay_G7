// code/B2-outils.js : bonus B2, préparation, rafale de virements et vérifications (TP FasoPay, groupe 07)
//
// Ce fichier ne fait que DÉFINIR des fonctions (voir B2-lancer.sh). Tout se passe dans la base fasopay_b2 ;
// fasopay_tp (nos données du TP) n'est jamais touchée.
//
//   preparer()            : repart de zéro, crée les collections (mêmes validateurs outbox que la Partie 1) et 20 wallets
//   rafale("A", 1000)     : 1 000 virements par transfer() (code/transfer.js), clés "A-1" ... "A-1000"
//   photo("titre")        : état à un instant donné (transactions, outbox PENDING / SENT, notifications)
//   verifier()            : les preuves finales : 0 événement perdu, 0 notification en double

var gardeB2 = function () {
  if (db.getName() !== "fasopay_b2") throw new Error("À lancer sur fasopay_b2, pas sur " + db.getName());
};

function preparer() {
  gardeB2();
  db.dropDatabase();
  var idTexte = { bsonType: ["string", "objectId"] }, dateBson = { bsonType: "date" };
  // Le même validateur outbox que sur fasopay_tp (Partie 1)
  db.createCollection("outbox", { validationLevel: "strict", validationAction: "error", validator: { $jsonSchema: {
    bsonType: "object", required: ["type", "txId", "status"], additionalProperties: false,
    properties: { _id: idTexte, type: { bsonType: "string", enum: ["TRANSFER_COMPLETED"] }, txId: { bsonType: "string" },
      status: { bsonType: "string", enum: ["PENDING", "SENT"] }, createdAt: dateBson, sentAt: dateBson } } } });
  db.createCollection("transactions");
  db.createCollection("ledger_entries");
  db.createCollection("notifications");
  db.createCollection("relais_etat");
  db.transactions.createIndex({ idempotencyKey: 1 }, { unique: true, name: "uniq_idempotency_key" });
  var w = [];
  for (var i = 1; i <= 20; i++) {
    w.push({ _id: "W" + (i < 10 ? "0" : "") + i, customerId: "C" + i, balance: NumberInt(1000000), currency: "XOF",
             status: "ACTIVE", dailyLimit: NumberInt(2000000), version: NumberInt(0), updatedAt: new Date() });
  }
  db.wallets.insertMany(w);
  print("base fasopay_b2 prête : " + db.wallets.countDocuments() + " wallets de 1 000 000 FCFA, collections : " +
        db.getCollectionNames().sort().join(", "));
}

function rafale(prefixe, n) {
  gardeB2();
  var ok = 0, autres = 0, debut = Date.now();
  for (var i = 1; i <= n; i++) {
    var a = 1 + Math.floor(Math.random() * 20), b = 1 + Math.floor(Math.random() * 19);
    if (b >= a) b++;                                  // jamais un virement vers soi-même
    var de = "W" + (a < 10 ? "0" : "") + a, vers = "W" + (b < 10 ? "0" : "") + b;
    var r = transfer(de, vers, 100, prefixe + "-" + i);
    if (r.ok && !r.replay) ok++; else autres++;
  }
  print("rafale " + prefixe + " : " + ok + " virements faits, " + autres + " autres réponses, en " +
        ((Date.now() - debut) / 1000).toFixed(1) + " s");
}

function photo(titre) {
  gardeB2();
  print(titre + " : transactions " + db.transactions.countDocuments() +
        ", outbox PENDING " + db.outbox.countDocuments({ status: "PENDING" }) +
        ", outbox SENT " + db.outbox.countDocuments({ status: "SENT" }) +
        ", notifications " + db.notifications.countDocuments());
}

function verifier() {
  gardeB2();
  var echecs = 0;
  var test = function (ok, texte) { print((ok ? "OK     " : "ÉCHEC  ") + texte); if (!ok) echecs++; };
  var tx = db.transactions.countDocuments(), ob = db.outbox.countDocuments(), notif = db.notifications.countDocuments();
  var pending = db.outbox.countDocuments({ status: "PENDING" });
  // Événement perdu = un événement outbox sans notification
  var perdus = db.outbox.aggregate([
    { $lookup: { from: "notifications", localField: "_id", foreignField: "_id", as: "n" } },
    { $match: { n: { $size: 0 } } }, { $count: "n" }]).toArray();
  perdus = perdus.length ? perdus[0].n : 0;
  // Doublon = deux notifications pour la même transaction (compté sur txId, pas seulement sur _id)
  var doublons = db.notifications.aggregate([
    { $group: { _id: "$txId", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: "n" }]).toArray();
  doublons = doublons.length ? doublons[0].n : 0;
  // Notification sans événement (inventée)
  var orphelines = db.notifications.aggregate([
    { $lookup: { from: "outbox", localField: "_id", foreignField: "_id", as: "o" } },
    { $match: { o: { $size: 0 } } }, { $count: "n" }]).toArray();
  orphelines = orphelines.length ? orphelines[0].n : 0;
  var etat = db.relais_etat.findOne({ _id: "relais-notifications" });

  print("transactions : " + tx + ", événements outbox : " + ob + ", notifications : " + notif +
        ", traités selon le jeton : " + (etat ? etat.traites : "aucun"));
  test(ob === tx, "un événement outbox par virement (" + ob + " pour " + tx + ")");
  test(pending === 0, "aucun événement resté PENDING (" + pending + ")");
  test(perdus === 0, "0 événement perdu : chaque événement a sa notification (" + perdus + " sans notification)");
  test(doublons === 0, "0 notification en double pour une même transaction (" + doublons + ")");
  test(orphelines === 0, "aucune notification sans événement (" + orphelines + ")");
  test(notif === ob, "autant de notifications que d'événements (" + notif + " pour " + ob + ")");
  print("RÉSULTAT : " + (6 - echecs) + " vérifications OK, " + echecs + " en échec");
}
