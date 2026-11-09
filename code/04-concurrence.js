// code/04-concurrence.js : test de concurrence de la Partie 4
//
// Ce fichier ne fait que définir des fonctions. Il est utilisé en trois temps (voir 04-lancer.sh) :
//   1. preparer()     : remet les wallets du test à leur état de départ et fixe une heure de départ commune
//   2. client("A") et client("B") : DEUX processus mongosh lancés en même temps
//   3. verifier()     : contrôle les invariants demandés par l'énoncé
//
// Le scénario de l'énoncé : 50 virements de 100 FCFA depuis W_CONC, qui ne contient que 3 000 FCFA.
// Chaque client en envoie 25. Il faut obtenir exactement 30 acceptés et 20 refus, sans jamais passer en négatif.
// En plus, juste au départ, les deux clients envoient le MÊME virement avec la MÊME clé (500 FCFA depuis W_MC) :
// un seul doit passer.

var garde = function () {
  if (db.getName() !== "fasopay_test") throw new Error("À lancer sur fasopay_test, pas sur " + db.getName());
};

function preparer() {
  garde();
  // On efface les traces d'un lancement précédent, puis on remet les soldes de départ.
  var anciennes = db.transactions.find({ idempotencyKey: { $regex: "^(conc-|cle-commune)" } }, { _id: 1 }).toArray().map(function (t) { return t._id; });
  db.ledger_entries.deleteMany({ txId: { $in: anciennes } });
  db.outbox.deleteMany({ txId: { $in: anciennes } });
  db.transactions.deleteMany({ _id: { $in: anciennes } });
  [["W_CONC", 3000], ["W_CONC_DEST", 0], ["W_MC", 10000], ["W_MC_DEST", 0]].forEach(function (x) {
    db.wallets.replaceOne({ _id: x[0] }, { _id: x[0], customerId: "C-" + x[0], balance: NumberInt(x[1]), currency: "XOF", status: "ACTIVE",
      dailyLimit: NumberInt(200000), version: NumberInt(0), updatedAt: new Date() }, { upsert: true });
  });
  // Heure de départ commune, dans 6 secondes : les deux clients attendent cet instant pour partir ensemble.
  var depart = new Date(Date.now() + 6000);
  db.banc.deleteMany({});
  db.banc.insertOne({ _id: "depart", at: depart });
  print("préparé : W_CONC = 3000, W_CONC_DEST = 0, W_MC = 10000, W_MC_DEST = 0 ; départ commun à " + depart.toISOString());
}

function client(nom) {
  garde();
  load("/tmp/code/transfer.js");
  var depart = db.banc.findOne({ _id: "depart" }).at;
  while (new Date() < depart) sleep(5);                    // on attend l'heure de départ commune
  print("client " + nom + " : départ à " + new Date().toISOString());

  // 1. La même clé, envoyée par les deux clients au même instant
  var rc = transfer("W_MC", "W_MC_DEST", 500, "cle-commune-1");
  print(new Date().toISOString() + " | " + nom + " | cle-commune-1 | " + JSON.stringify(rc));

  // 2. Les 25 virements de 100 FCFA de ce client
  var acceptes = 0, refuses = 0, erreurs = 0, rejoues = 0;
  for (var i = 1; i <= 25; i++) {
    var cle = "conc-" + nom + "-" + (i < 10 ? "0" : "") + i;
    var stats = {};
    var debut = new Date();
    try {
      var r = transfer("W_CONC", "W_CONC_DEST", 100, cle, { stats: stats });
      if (r.ok) acceptes++; else refuses++;
      if (stats.essais > 1) rejoues++;
      print(debut.toISOString() + " | " + nom + " | " + cle + " | " + (r.ok ? "ACCEPTÉ" : r.error) + " | essais=" + stats.essais);
    } catch (e) {
      erreurs++;
      print(debut.toISOString() + " | " + nom + " | " + cle + " | ERREUR " + e.message);
    }
  }
  print("client " + nom + " : fin à " + new Date().toISOString() + " ; acceptés=" + acceptes + ", refusés=" + refuses +
        ", erreurs=" + erreurs + ", virements rejoués après un conflit=" + rejoues);
  db.banc.replaceOne({ _id: "client-" + nom }, { _id: "client-" + nom, acceptes: acceptes, refuses: refuses, erreurs: erreurs, rejoues: rejoues, cleCommune: rc }, { upsert: true });
}

function verifier() {
  garde();
  var bilan = { ok: 0, echec: 0 };
  var verif = function (libelle, condition) { if (condition) bilan.ok++; else bilan.echec++; print((condition ? "OK     " : "ÉCHEC  ") + libelle); };
  var A = db.banc.findOne({ _id: "client-A" }), B = db.banc.findOne({ _id: "client-B" });
  print("client A : " + JSON.stringify(A));
  print("client B : " + JSON.stringify(B));

  var ids = db.transactions.find({ idempotencyKey: { $regex: "^conc-" } }, { _id: 1 }).toArray().map(function (t) { return t._id; });
  var wc = db.wallets.findOne({ _id: "W_CONC" }), wd = db.wallets.findOne({ _id: "W_CONC_DEST" });
  var ledger = db.ledger_entries.countDocuments({ txId: { $in: ids } });
  var outbox = db.outbox.countDocuments({ txId: { $in: ids } });
  var minBA = db.ledger_entries.aggregate([{ $match: { walletId: "W_CONC" } }, { $group: { _id: null, min: { $min: "$balanceAfter" } } }]).toArray();
  print("");
  print("virements acceptés en base : " + ids.length + " ; W_CONC = " + wc.balance + " ; W_CONC_DEST = " + wd.balance +
        " ; lignes de ledger = " + ledger + " ; outbox = " + outbox + " ; plus petit balanceAfter de W_CONC = " + (minBA.length ? minBA[0].min : "aucun"));
  verif("exactement 30 virements acceptés (en base, et selon les clients : " + (A.acceptes + B.acceptes) + ")", ids.length === 30 && A.acceptes + B.acceptes === 30);
  verif("20 refus INSUFFICIENT_FUNDS côté clients, aucune erreur", A.refuses + B.refuses === 20 && A.erreurs + B.erreurs === 0);
  verif("solde final jamais négatif : W_CONC = " + wc.balance + ", aucun balanceAfter < 0", wc.balance >= 0 && minBA.length > 0 && minBA[0].min >= 0);
  verif("monnaie conservée : W_CONC + W_CONC_DEST = " + (wc.balance + wd.balance) + " (3000 au départ)", wc.balance + wd.balance === 3000);
  verif("ledger = 2 × virements : " + ledger + " = 2 × " + ids.length, ledger === 2 * ids.length);
  verif("outbox = virements : " + outbox + " = " + ids.length, outbox === ids.length);
  verif("les deux clients ont vraiment travaillé en même temps (conflits réglés par des réessais : " + (A.rejoues + B.rejoues) + ")", A.rejoues + B.rejoues > 0);

  print("");
  var mc = db.wallets.findOne({ _id: "W_MC" }), mcd = db.wallets.findOne({ _id: "W_MC_DEST" });
  print("même clé : A a reçu " + JSON.stringify(A.cleCommune) + " ; B a reçu " + JSON.stringify(B.cleCommune));
  verif("même clé envoyée par 2 clients : 1 seul document transactions", db.transactions.countDocuments({ idempotencyKey: "cle-commune-1" }) === 1);
  verif("W_MC débité une seule fois : " + mc.balance + " (10000 - 500), W_MC_DEST = " + mcd.balance, mc.balance === 9500 && mcd.balance === 500);
  verif("les deux clients ont reçu le même txId", A.cleCommune.txId === B.cleCommune.txId);
  print("");
  print("RÉSULTAT : " + bilan.ok + " vérifications OK, " + bilan.echec + " en échec");
}
