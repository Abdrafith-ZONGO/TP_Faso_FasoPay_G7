// code/06-cles.js : évaluation des clés de sharding sur nos transactions (Partie 6)
//
// Ce fichier ne fait que définir des fonctions (voir 06-lancer.sh, mode « cle »). Il est lancé dans le conteneur
// fasopay-mongos : toutes les commandes passent par le routeur, comme le ferait une application.
// Chaque clé a sa propre collection dans la base fasopay_shard, shardée AVANT l'import des 60 000 transactions.

var BASE = "fasopay_shard";
var CLES = {
  date:     { coll: "tx_date",   cle: { createdAt: 1 },                  plages: true  },
  wallet:   { coll: "tx_wallet", cle: { fromWalletId: 1 },               plages: true  },
  hash:     { coll: "tx_hash",   cle: { fromWalletId: "hashed" },        plages: false },
  composee: { coll: "tx_comp",   cle: { fromWalletId: 1, createdAt: 1 }, plages: true  },
  // Clé recommandée, évaluée après les quatre premières : un champ toujours présent, haché.
  // walletCle = fromWalletId, ou toWalletId quand il n'y a pas d'émetteur (dépôts CASH_IN).
  cible:    { coll: "tx_cible",  cle: { walletCle: "hashed" },           plages: false }
};
var base = function () { return db.getSiblingDB(BASE); };
var ns = function (nom) { return BASE + "." + CLES[nom].coll; };

// 1. Créer la collection vide et la sharder sur sa clé, AVANT tout import
function creer(nom) {
  var c = CLES[nom];
  base().getCollection(c.coll).drop();
  printjson(sh.shardCollection(ns(nom), c.cle));
  var info = db.getSiblingDB("config").collections.findOne({ _id: ns(nom) });
  print("collection " + ns(nom) + " shardée sur " + JSON.stringify(info.key) + (info.unique ? " (unique)" : ""));
}

// 2. Répartition : documents par shard ($collStats, vu par le mongos) et chunks par shard (config.chunks)
function compter(nom) {
  var r = {};
  base().getCollection(CLES[nom].coll).aggregate([{ $collStats: { count: {} } }]).forEach(function (x) { r[x.shard] = x.count; });
  return r;
}
function repartition(nom, libelle) {
  var uuid = db.getSiblingDB("config").collections.findOne({ _id: ns(nom) }).uuid;
  var chunks = {};
  db.getSiblingDB("config").chunks.find({ uuid: uuid }).forEach(function (ch) { chunks[ch.shard] = (chunks[ch.shard] || 0) + 1; });
  var docs = compter(nom), total = 0;
  Object.keys(docs).forEach(function (s) { total += docs[s]; });
  print("répartition « " + libelle + " » : " + total + " documents");
  ["rs-shard1", "rs-shard2", "rs-shard3"].forEach(function (s) {
    var n = docs[s] || 0;
    print("  " + s + " : " + n + " documents (" + (total ? (100 * n / total).toFixed(1) : "0.0") + " %), " + (chunks[s] || 0) + " chunk(s)");
  });
  if (nom === "cible") {
    print("  documents sans walletCle : " + base().getCollection(CLES[nom].coll).countDocuments({ walletCle: { $exists: false } }) + " ; dépôts CASH_IN (sans fromWalletId) : " + base().getCollection(CLES[nom].coll).countDocuments({ fromWalletId: { $exists: false } }) + ", qui ont chacun le walletCle de leur destinataire");
  } else if (nom !== "date") {
    var sansCle = base().getCollection(CLES[nom].coll).countDocuments({ fromWalletId: { $exists: false } });
    print("  documents sans fromWalletId (dépôts CASH_IN) : " + sansCle + " ; ils ont tous la même valeur de clé (absente)");
  }
}

// 3. Clé à plages : tout tient dans un seul chunk. Correction par les commandes d'administration :
//    découper (sh.splitAt) aux tiers des données, puis déplacer (sh.moveChunk) deux morceaux vers les autres shards.
function corriger(nom) {
  var c = CLES[nom], col = base().getCollection(c.coll);
  var n = col.countDocuments();
  var champs = Object.keys(c.cle);
  var tri = {}; champs.forEach(function (f) { tri[f] = 1; });
  var point = function (rang) {
    var d = col.find({}, tri).sort(tri).skip(rang).limit(1).toArray()[0];
    var p = {}; champs.forEach(function (f) { p[f] = (d[f] === undefined) ? null : d[f]; });
    return p;
  };
  var p1 = point(Math.floor(n / 3)), p2 = point(Math.floor(2 * n / 3));
  print("taille de chunk configurée : " + JSON.stringify(db.getSiblingDB("config").settings.findOne({ _id: "chunksize" })) + " (absente = valeur par défaut, 128 Mo)");
  print("points de découpe (au tiers et aux deux tiers des documents triés par la clé) : " + JSON.stringify(p1) + " et " + JSON.stringify(p2));
  printjson(sh.splitAt(ns(nom), p1));
  printjson(sh.splitAt(ns(nom), p2));
  var proprio = db.getSiblingDB("config").chunks.findOne({ uuid: db.getSiblingDB("config").collections.findOne({ _id: ns(nom) }).uuid }).shard;
  var autres = ["rs-shard1", "rs-shard2", "rs-shard3"].filter(function (s) { return s !== proprio; });
  print("shard qui détenait tout : " + proprio + " ; déplacements vers " + autres.join(" et "));
  printjson(sh.moveChunk(ns(nom), p1, autres[0]));
  printjson(sh.moveChunk(ns(nom), p2, autres[1]));
}

// 4. Le trafic de demain : 3 000 transactions nouvelles, datées d'aujourd'hui, copiées d'un échantillon réel
//    (même mélange de types, dont les dépôts sans fromWalletId) ; on mesure sur quel shard elles tombent.
function traficNouveau(nom) {
  var col = base().getCollection(CLES[nom].coll);
  var avant = compter(nom);
  var maintenant = Date.now();
  var nouveaux = col.aggregate([{ $sample: { size: 3000 } }]).toArray().map(function (d, i) {
    d._id = "NEW-" + i; d.idempotencyKey = "new-" + nom + "-" + i;
    d.createdAt = new Date(maintenant + i); if (d.completedAt) d.completedAt = new Date(maintenant + i);
    return d;
  });
  col.insertMany(nouveaux);
  var apres = compter(nom);
  print("3 000 transactions nouvelles insérées, datées du " + new Date(maintenant).toISOString() + " :");
  ["rs-shard1", "rs-shard2", "rs-shard3"].forEach(function (s) {
    var n = (apres[s] || 0) - (avant[s] || 0);
    print("  " + s + " : " + n + " nouvelles (" + (100 * n / 3000).toFixed(1) + " %)");
  });
}

// 5. Ciblée ou dispersée ? Lecture des explain() des requêtes de l'énoncé, à travers le mongos
var resumeFind = function (libelle, e) {
  var wp = e.queryPlanner.winningPlan, st = e.executionStats;
  var shards = (st.executionStages.shards || []);
  print(libelle + " | stage " + wp.stage + " | " + shards.length + " shard(s) interrogé(s) | " +
        shards.map(function (s) { return s.shardName + " : " + s.totalDocsExamined + " documents examinés, " + s.nReturned + " rendus"; }).join(" ; ") +
        " | total rendu : " + st.nReturned);
};
function expliquer(nom) {
  var col = base().getCollection(CLES[nom].coll);
  var W = "W000612";
  var requetes = [
    ["historique d'un wallet (fromWalletId = " + W + ")", function () { return col.find({ fromWalletId: W }).sort({ createdAt: -1 }); }],
    ["historique complet d'un wallet ($or émetteur / destinataire)", function () { return col.find({ $or: [{ fromWalletId: W }, { toWalletId: W }] }).sort({ createdAt: -1 }); }],
    ["une transaction par _id (T0002044)", function () { return col.find({ _id: "T0002044" }); }],
    ["paiements du marchand M00044 en mars 2026", function () { return col.find({ merchantId: "M00044", createdAt: { $gte: ISODate("2026-03-01T00:00:00Z"), $lt: ISODate("2026-04-01T00:00:00Z") } }); }],
    ["toutes les transactions du 30 janvier 2026", function () { return col.find({ createdAt: { $gte: ISODate("2026-01-30T00:00:00Z"), $lt: ISODate("2026-01-31T00:00:00Z") } }); }],
    ["tous les paiements du marchand M00044 (cas du marchand qui fait 25 % du volume)", function () { return col.find({ merchantId: "M00044" }); }]
  ];
  if (nom === "cible") requetes.splice(1, 0, ["historique d'un wallet par la clé (walletCle = " + W + ")", function () { return col.find({ walletCle: W }).sort({ createdAt: -1 }); }]);
  var details = [];
  requetes.forEach(function (q) { var e = q[1]().explain("executionStats"); resumeFind(q[0], e); details.push([q[0], e]); });

  // CA par marchand : que fait chaque shard, que fait le mongos ?
  var pipeline = [{ $match: { type: "MERCHANT_PAY", status: "COMPLETED" } }, { $group: { _id: "$merchantId", ca: { $sum: "$amount" } } }, { $sort: { ca: -1 } }];
  var ea = col.explain("executionStats").aggregate(pipeline);
  var etapes = function (part) { return (part || []).map(function (x) { return Object.keys(x)[0]; }).join(" > "); };
  print("CA par marchand (agrégation) | fusion : " + ea.mergeType + " | chaque shard exécute : " + etapes(ea.splitPipeline && ea.splitPipeline.shardsPart) +
        " | le mongos (ou le shard de fusion) exécute : " + etapes(ea.splitPipeline && ea.splitPipeline.mergerPart) +
        " | shards interrogés : " + Object.keys(ea.shards || {}).join(", "));
  details.push(["CA par marchand (agrégation)", ea]);

  print("");
  print("---- explain() complets (JSON) ----");
  details.forEach(function (d) { print(""); print("## " + d[0]); printjson(d[1]); });
}

// 6. Documents « possédés » et documents orphelins, par shard (étape ajoutée après les quatre évaluations).
//    Après un sh.moveChunk, le shard de départ garde une copie des documents déplacés (des orphelins) jusqu'à
//    ce que le nettoyage en arrière-plan les supprime. $collStats les compte ; $shardedDataDistribution les sépare.
function orphelins() {
  db.getSiblingDB("admin").aggregate([{ $shardedDataDistribution: {} }, { $match: { ns: { $regex: "^fasopay_shard\\." } } }, { $sort: { ns: 1 } }]).forEach(function (c) {
    print(c.ns);
    c.shards.sort(function (a, b) { return a.shardName < b.shardName ? -1 : 1; }).forEach(function (s) {
      print("  " + s.shardName + " : " + s.numOwnedDocuments + " documents possédés, " + s.numOrphanedDocs + " orphelins");
    });
  });
}

// 7. Chargement de la collection de la clé recommandée : les 60 000 transactions d'origine, avec le champ walletCle,
//    écrites à travers le mongos par lots de 1 000 (comme le ferait l'application), dans la collection déjà shardée.
//    Source : tx_date, sans les 3 000 transactions ajoutées par le test du trafic de demain (_id « NEW-… »).
function charger(nom) {
  var dest = base().getCollection(CLES[nom].coll), lot = [], n = 0;
  base().tx_date.find({ _id: { $not: /^NEW-/ } }).forEach(function (d) {
    d.walletCle = (d.fromWalletId !== undefined && d.fromWalletId !== null) ? d.fromWalletId : d.toWalletId;
    lot.push(d);
    if (lot.length === 1000) { dest.insertMany(lot); n += lot.length; lot = []; }
  });
  if (lot.length) { dest.insertMany(lot); n += lot.length; }
  print(n + " transactions écrites dans " + ns(nom) + " avec le champ walletCle");
}
