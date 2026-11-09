// code/04-tests.js : nos tests de transfer() (Partie 4)
//
// Lancement (après 04-base-test.js) : mongosh fasopay_test --quiet --file 04-tests.js
// Chaque test affiche l'état AVANT et APRÈS, puis une ligne OK ou ÉCHEC.

if (db.getName() !== "fasopay_test") throw new Error("Ce script doit être lancé sur fasopay_test, pas sur " + db.getName());

// ----------------------------------------------------------------------------
// Petits outils d'affichage
// ----------------------------------------------------------------------------
var bilan = { ok: 0, echec: 0 };
var titre = function (t) { print(""); print("==================== " + t + " ===================="); };
var verifier = function (libelle, condition) {
  if (condition) bilan.ok++; else bilan.echec++;
  print((condition ? "OK     " : "ÉCHEC  ") + libelle);
};
var solde = function (id) { var x = db.wallets.findOne({ _id: id }); return x ? x.balance : null; };
// Photo de la base : nombre de documents et soldes des wallets des tests simples
var etat = function () {
  return { transactions: db.transactions.countDocuments(), ledger_entries: db.ledger_entries.countDocuments(),
           outbox: db.outbox.countDocuments(), W_A: solde("W_A"), W_B: solde("W_B"), W_PETIT: solde("W_PETIT"), W_GEL: solde("W_GEL") };
};
var memeEtat = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
var typeStocke = function (coll, filtre, champ) {
  var r = db[coll].aggregate([{ $match: filtre }, { $group: { _id: { $type: "$" + champ } } }]).toArray();
  return r.map(function (x) { return x._id; }).join(",");
};
var totalDepart = solde("W_A") + solde("W_B") + solde("W_PETIT") + solde("W_GEL");

// ----------------------------------------------------------------------------
// TEST 0 : charger le fichier ne fait rien
// ----------------------------------------------------------------------------
titre("TEST 0 : le chargement de transfer.js n'a aucun effet");
var avant = etat(), collAvant = JSON.stringify(db.getCollectionNames().sort());
load("/tmp/code/transfer.js");
var apres = etat(), collApres = JSON.stringify(db.getCollectionNames().sort());
print("avant : " + JSON.stringify(avant) + " " + collAvant);
print("après : " + JSON.stringify(apres) + " " + collApres);
verifier("même nombre de documents, mêmes soldes, mêmes collections après load()", memeEtat(avant, apres) && collAvant === collApres);
verifier("la fonction transfer est définie", typeof transfer === "function");

// ----------------------------------------------------------------------------
// TEST 1 : un virement réussi écrit bien ses 6 documents, dans une transaction
// ----------------------------------------------------------------------------
titre("TEST 1 : virement réussi de 1 500 FCFA de W_A vers W_B");
avant = etat();
print("avant : " + JSON.stringify(avant));
var r1 = transfer("W_A", "W_B", 1500, "test-succes-1");
print("réponse : " + JSON.stringify(r1));
apres = etat();
print("après : " + JSON.stringify(apres));
print("document transactions :"); printjson(db.transactions.findOne({ _id: r1.txId }));
print("lignes de ledger :"); db.ledger_entries.find({ txId: r1.txId }).forEach(printjson);
print("document outbox :"); printjson(db.outbox.findOne({ txId: r1.txId }));
print("wallets :"); db.wallets.find({ _id: { $in: ["W_A", "W_B"] } }, { balance: 1, version: 1, updatedAt: 1 }).forEach(printjson);
verifier("réponse { ok: true, replay: false, txId }", r1.ok === true && r1.replay === false && typeof r1.txId === "string");
verifier("+1 transaction, +2 lignes de ledger, +1 outbox", apres.transactions === avant.transactions + 1 && apres.ledger_entries === avant.ledger_entries + 2 && apres.outbox === avant.outbox + 1);
verifier("W_A débité de 1 500 et W_B crédité de 1 500", apres.W_A === avant.W_A - 1500 && apres.W_B === avant.W_B + 1500);
var lD = db.ledger_entries.findOne({ txId: r1.txId, direction: "DEBIT" }), lC = db.ledger_entries.findOne({ txId: r1.txId, direction: "CREDIT" });
verifier("balanceAfter = nouveau solde (débit et crédit)", lD.balanceAfter === apres.W_A && lC.balanceAfter === apres.W_B);
verifier("statut final COMPLETED, outbox TRANSFER_COMPLETED / PENDING", db.transactions.findOne({ _id: r1.txId }).status === "COMPLETED" && db.outbox.findOne({ txId: r1.txId }).status === "PENDING");
print("type BSON stocké : amount (transactions) = " + typeStocke("transactions", { _id: r1.txId }, "amount") + ", amount (ledger) = " + typeStocke("ledger_entries", { txId: r1.txId }, "amount") + ", balance (wallets) = " + typeStocke("wallets", { _id: { $in: ["W_A", "W_B"] } }, "balance"));
verifier("les montants sont stockés en entiers (int), jamais en double", typeStocke("transactions", { _id: r1.txId }, "amount") === "int" && typeStocke("ledger_entries", { txId: r1.txId }, "amount") === "int");

// ----------------------------------------------------------------------------
// TEST 2 : idempotence, la même clé rejouée 3 fois ne produit qu'un seul virement
// ----------------------------------------------------------------------------
titre("TEST 2 : idempotence, 1 appel puis 3 rejeux de la même clé (2 000 FCFA)");
avant = etat();
print("avant : " + JSON.stringify(avant));
var premier = transfer("W_A", "W_B", 2000, "test-rejeu-1");
print("appel 1 : " + JSON.stringify(premier));
var rejeux = [];
for (var i = 2; i <= 4; i++) { var r = transfer("W_A", "W_B", 2000, "test-rejeu-1"); rejeux.push(r); print("appel " + i + " (rejeu) : " + JSON.stringify(r)); }
apres = etat();
print("après : " + JSON.stringify(apres));
verifier("1 seul document transactions pour cette clé", db.transactions.countDocuments({ idempotencyKey: "test-rejeu-1" }) === 1);
verifier("+1 transaction, +2 lignes de ledger, +1 outbox au total (pas 4)", apres.transactions === avant.transactions + 1 && apres.ledger_entries === avant.ledger_entries + 2 && apres.outbox === avant.outbox + 1);
verifier("W_A débité une seule fois (2 000, pas 8 000)", apres.W_A === avant.W_A - 2000);
verifier("les 3 rejeux renvoient la même réponse, avec le même txId que l'appel 1", rejeux.every(function (x) { return JSON.stringify(x) === JSON.stringify(rejeux[0]) && x.ok === true && x.replay === true && x.txId === premier.txId && x.status === "COMPLETED"; }));

// ----------------------------------------------------------------------------
// TEST 3 : les refus ne laissent aucune trace
// ----------------------------------------------------------------------------
titre("TEST 3 : refus, aucune écriture ne doit survivre");
var casRefus = [
  ["montant non entier (12.5)", "W_A", "W_B", 12.5, "INVALID_AMOUNT"],
  ["montant en texte (\"100\")", "W_A", "W_B", "100", "INVALID_AMOUNT"],
  ["montant nul (0)", "W_A", "W_B", 0, "INVALID_AMOUNT"],
  ["montant négatif (-100)", "W_A", "W_B", -100, "INVALID_AMOUNT"],
  ["virement vers soi-même", "W_A", "W_A", 100, "INVALID_AMOUNT"],
  ["wallet émetteur inexistant", "W_ABSENT", "W_B", 100, "WALLET_NOT_FOUND_OR_FROZEN"],
  ["wallet émetteur FROZEN", "W_GEL", "W_B", 100, "WALLET_NOT_FOUND_OR_FROZEN"],
  ["wallet destinataire FROZEN (débit déjà fait, puis annulé)", "W_A", "W_GEL", 100, "WALLET_NOT_FOUND_OR_FROZEN"],
  ["wallet destinataire inexistant (débit déjà fait, puis annulé)", "W_A", "W_ABSENT", 100, "WALLET_NOT_FOUND_OR_FROZEN"],
  ["solde insuffisant (1 000 sur un solde de 500)", "W_PETIT", "W_B", 1000, "INSUFFICIENT_FUNDS"]
];
casRefus.forEach(function (c, k) {
  var cle = "test-refus-" + (k + 1);
  var av = etat();
  var rep = transfer(c[1], c[2], c[3], cle);
  var ap = etat();
  print("- " + c[0] + " : " + JSON.stringify(rep));
  verifier("  refus " + c[4] + ", état identique avant / après, clé absente de transactions",
    rep.ok === false && rep.error === c[4] && memeEtat(av, ap) && db.transactions.countDocuments({ idempotencyKey: cle }) === 0);
});
print("état après tous les refus : " + JSON.stringify(etat()));

// ----------------------------------------------------------------------------
// TEST 4 : abort prouvé, une écriture réelle qui disparaît
// ----------------------------------------------------------------------------
titre("TEST 4 : abort prouvé (failAfterFirstWrite)");
avant = etat();
var compteursAvant = db.serverStatus().transactions;
print("avant : " + JSON.stringify(avant));
print("compteurs du serveur avant : démarrées=" + compteursAvant.totalStarted + ", validées=" + compteursAvant.totalCommitted + ", annulées=" + compteursAvant.totalAborted);
db.setProfilingLevel(2);                  // le profileur du serveur note chaque opération de fasopay_test
var debutProfil = new Date();
var txIdVu = null, vuDedans = null, vuDehors = null;
var rAbort = transfer("W_A", "W_B", 777, "test-abort-1", {
  failAfterFirstWrite: true,
  onFirstWrite: function (s, txId) {
    txIdVu = txId;
    vuDedans = s.transactions.findOne({ _id: txId });   // lecture DANS la transaction
    vuDehors = db.transactions.findOne({ _id: txId });  // lecture HORS de la transaction, au même instant
    print("pendant la transaction, juste après la première écriture :");
    print("  lu DANS la transaction : " + JSON.stringify(vuDedans));
    print("  lu HORS de la transaction : " + JSON.stringify(vuDehors));
  }
});
db.setProfilingLevel(0);
print("réponse : " + JSON.stringify(rAbort));
apres = etat();
var compteursApres = db.serverStatus().transactions;
print("après : " + JSON.stringify(apres));
print("compteurs du serveur après : démarrées=" + compteursApres.totalStarted + ", validées=" + compteursApres.totalCommitted + ", annulées=" + compteursApres.totalAborted);
print("trace du profileur (insertion dans transactions pendant le test) :");
db.system.profile.find({ ns: "fasopay_test.transactions", op: "insert", ts: { $gte: debutProfil } },
  { _id: 0, ts: 1, op: 1, ns: 1, ninserted: 1, keysInserted: 1, "command.txnNumber": 1, "command.startTransaction": 1, "command.autocommit": 1 }).forEach(printjson);
verifier("l'écriture a eu lieu : le document est lu DANS la transaction", vuDedans !== null && vuDedans._id === txIdVu);
verifier("isolation : HORS de la transaction, il est invisible", vuDehors === null);
verifier("réponse { ok: false, error: \"CRASH_SIMULATED\" }", rAbort.ok === false && rAbort.error === "CRASH_SIMULATED");
verifier("après l'abort, le document a disparu", db.transactions.findOne({ _id: txIdVu }) === null && db.transactions.countDocuments({ idempotencyKey: "test-abort-1" }) === 0);
verifier("comptages et soldes identiques avant / après", memeEtat(avant, apres));
verifier("le serveur compte une transaction annulée de plus", compteursApres.totalAborted - compteursAvant.totalAborted >= 1);

// ----------------------------------------------------------------------------
// TEST 5 : la réponse perdue (question de fond)
// ----------------------------------------------------------------------------
titre("TEST 5 : la réponse est perdue, le client réessaie avec la même clé");
avant = etat();
print("avant : " + JSON.stringify(avant));
var reponsePerdue = transfer("W_A", "W_B", 300, "test-perdue-1");   // le virement est fait... mais imaginons que cette réponse n'arrive jamais
print("(réponse que le client n'a pas reçue : " + JSON.stringify(reponsePerdue) + ")");
var reessai = transfer("W_A", "W_B", 300, "test-perdue-1");         // le client ne sait pas : il réessaie avec la même clé
print("réponse au réessai : " + JSON.stringify(reessai));
apres = etat();
print("après : " + JSON.stringify(apres));
verifier("le réessai est reconnu comme un rejeu, avec le même txId", reessai.replay === true && reessai.txId === reponsePerdue.txId);
verifier("W_A débité une seule fois (300)", apres.W_A === avant.W_A - 300 && apres.transactions === avant.transactions + 1);

// ----------------------------------------------------------------------------
// BILAN : documents valides, argent conservé
// ----------------------------------------------------------------------------
titre("BILAN");
["wallets", "transactions", "ledger_entries", "outbox"].forEach(function (n) {
  var schema = db.getCollectionInfos({ name: n })[0].options.validator.$jsonSchema;
  var invalides = db[n].countDocuments({ $nor: [{ $jsonSchema: schema }] });
  verifier(n + " : " + db[n].countDocuments() + " documents, " + invalides + " invalide(s) pour nos validateurs", invalides === 0);
});
var totalFin = solde("W_A") + solde("W_B") + solde("W_PETIT") + solde("W_GEL");
verifier("argent conservé : " + totalDepart + " FCFA au départ, " + totalFin + " à la fin", totalDepart === totalFin);
var desequilibre = db.ledger_entries.aggregate([{ $group: { _id: "$txId", net: { $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } } } }, { $match: { net: { $ne: 0 } } }]).toArray().length;
verifier("partie double : 0 transaction déséquilibrée dans le ledger", desequilibre === 0);
print("");
print("RÉSULTAT : " + bilan.ok + " vérifications OK, " + bilan.echec + " en échec");
