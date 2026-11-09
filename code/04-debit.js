// code/04-debit.js : mesure du débit de transfer() sur un ordinateur portable (Parties 0 et 4)
//
// Ce fichier ne fait que définir des fonctions (voir 04-lancer.sh, mode « debit »).
// La mesure se fait dans une base à part, fasopay_bench, qui reçoit une COPIE des 2 000 vrais wallets de fasopay_tp
// (fasopay_tp est seulement lue, jamais modifiée) et les mêmes index que fasopay_tp.
// Chaque virement fait 100 FCFA entre deux wallets ACTIVE tirés au hasard, avec une clé unique.
//
//   preparer()            : crée fasopay_bench à partir des wallets de fasopay_tp, puis fixe une heure de départ
//   client("S1", 1000)    : un client qui enchaîne 1 000 virements et note le temps de chacun
//   nouveauDepart()       : nouvelle heure de départ commune pour la série suivante
//   resultat("libellé")   : débit de la série (virements/s, écritures/s), temps de réponse, contrôles

var gardeBench = function () {
  if (db.getName() !== "fasopay_bench") throw new Error("À lancer sur fasopay_bench, pas sur " + db.getName());
};

var centile = function (triees, p) { return triees[Math.min(triees.length - 1, Math.floor(p / 100 * triees.length))]; };

function preparer() {
  gardeBench();
  db.dropDatabase();
  // Copie des 2 000 wallets réels : la base fasopay_tp n'est que lue
  db.getSiblingDB("fasopay_tp").wallets.aggregate([{ $out: { db: "fasopay_bench", coll: "wallets" } }]);
  // Les mêmes index que fasopay_tp (Partie 3) : chaque virement en paie le coût, comme en production
  db.transactions.createIndex({ idempotencyKey: 1 }, { unique: true, name: "uniq_idempotency_key" });
  db.transactions.createIndex({ fromWalletId: 1, status: 1, createdAt: 1, amount: 1 }, { name: "idx_sorties_wallet_jour" });
  db.createCollection("ledger_entries");
  db.ledger_entries.createIndex({ walletId: 1, createdAt: -1 }, { name: "idx_ledger_wallet_date" });
  db.createCollection("outbox");
  var total = db.wallets.aggregate([{ $group: { _id: null, n: { $sum: 1 }, actifs: { $sum: { $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0] } }, solde: { $sum: "$balance" } } }]).toArray()[0];
  print("wallets copiés : " + total.n + " (dont " + total.actifs + " ACTIVE), somme des soldes : " + total.solde + " FCFA");
  nouveauDepart();
}

function nouveauDepart() {
  gardeBench();
  var depart = new Date(Date.now() + 6000);
  db.banc.deleteMany({});
  db.banc.insertOne({ _id: "depart", at: depart });
  print("départ commun à " + depart.toISOString());
}

function client(nom, nb) {
  gardeBench();
  load("/tmp/code/transfer.js");
  var ids = db.wallets.find({ status: "ACTIVE" }, { _id: 1 }).toArray().map(function (x) { return x._id; });
  var depart = db.banc.findOne({ _id: "depart" }).at;
  while (new Date() < depart) sleep(5);
  var temps = [], acceptes = 0, refuses = 0, conflits = 0;
  var debut = Date.now();
  for (var i = 1; i <= nb; i++) {
    var de = ids[Math.floor(Math.random() * ids.length)], vers = de;
    while (vers === de) vers = ids[Math.floor(Math.random() * ids.length)];
    var stats = {};
    var t = Date.now();
    var r = transfer(de, vers, 100, "bench-" + nom + "-" + i, { stats: stats });
    temps.push(Date.now() - t);
    if (r.ok) acceptes++; else refuses++;
    if (stats.essais > 1) conflits++;
  }
  var fin = Date.now();
  temps.sort(function (a, b) { return a - b; });
  var res = { _id: "res-" + nom, nb: nb, acceptes: acceptes, refuses: refuses, conflits: conflits, debut: new Date(debut), fin: new Date(fin),
              duree_s: (fin - debut) / 1000, p50_ms: centile(temps, 50), p95_ms: centile(temps, 95), p99_ms: centile(temps, 99), max_ms: temps[temps.length - 1] };
  print("client " + nom + " : " + JSON.stringify(res));
  db.banc.insertOne(res);
}

function resultat(libelle) {
  gardeBench();
  var res = db.banc.find({ _id: { $regex: "^res-" } }).toArray();
  var nb = 0, acceptes = 0, conflits = 0, debut = null, fin = null, p95 = 0, p99 = 0;
  res.forEach(function (r) {
    nb += r.nb; acceptes += r.acceptes; conflits += r.conflits;
    if (debut === null || r.debut < debut) debut = r.debut;
    if (fin === null || r.fin > fin) fin = r.fin;
    p95 = Math.max(p95, r.p95_ms); p99 = Math.max(p99, r.p99_ms);
  });
  var duree = (fin - debut) / 1000;
  print("");
  print("SÉRIE « " + libelle + " » : " + res.length + " client(s), " + nb + " virements demandés, " + acceptes + " acceptés, " + conflits + " rejoués après un conflit");
  print("durée totale : " + duree.toFixed(2) + " s");
  print("débit : " + (acceptes / duree).toFixed(1) + " virements/s, soit " + (6 * acceptes / duree).toFixed(0) + " écritures de documents/s (6 par virement)");
  print("temps de réponse d'un virement : p95 le plus élevé des clients = " + p95 + " ms, p99 le plus élevé = " + p99 + " ms");
  // Contrôles : l'argent est conservé, chaque virement a ses 2 lignes de ledger et son outbox
  var solde = db.wallets.aggregate([{ $group: { _id: null, s: { $sum: "$balance" } } }]).toArray()[0].s;
  var tx = db.transactions.countDocuments(), led = db.ledger_entries.countDocuments(), out = db.outbox.countDocuments();
  print("contrôles cumulés : somme des soldes = " + solde + " FCFA (832251836 au départ) ; transactions = " + tx + ", ledger = " + led + " (2 × " + tx + "), outbox = " + out);
  print((solde === 832251836 && led === 2 * tx && out === tx) ? "OK     argent conservé, ledger = 2 × virements, outbox = virements" : "ÉCHEC  un contrôle ne passe pas");
}
