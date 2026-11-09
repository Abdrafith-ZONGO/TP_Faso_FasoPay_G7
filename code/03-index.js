// Partie 3 - Indexation et performance (mongosh, base fasopay_tp)

// Q1 : sorties COMPLETED d'un wallet sur une journée (contrôle de conformité du plafond, cas W000758 du 30 janvier, voir E2).
// Projection sur amount seul : l'index peut couvrir la requête.
var q1 = function () { return db.transactions.find({ fromWalletId: "W000758", status: "COMPLETED", createdAt: { $gte: ISODate("2026-01-30T00:00:00Z"), $lt: ISODate("2026-01-31T00:00:00Z") } }, { amount: 1, _id: 0 }) }
// Q2 : dernière ligne du ledger d'un wallet (rapprochement avec wallets.balance, voir E1). W000612 : le wallet le plus actif, 390 lignes.
var q2 = function () { return db.ledger_entries.find({ walletId: "W000612" }).sort({ createdAt: -1 }).limit(1) }
// Q3 : recherche d'une transaction par clé d'idempotence (début de l'incident de E4).
var q3 = function () { return db.transactions.find({ idempotencyKey: "idem-401046a409a4ab48" }) }
// Résumé d'un explain en une ligne : chaîne des stages, nReturned, clés et documents examinés, temps.
var resume = function (e) { var s = e.executionStats, wp = e.queryPlanner.winningPlan, p = wp.queryPlan || wp, r = []; while (p) { r.push(p.stage); p = p.inputStage }; print(r.join(" > ") + " | nReturned=" + s.nReturned + " keys=" + s.totalKeysExamined + " docs=" + s.totalDocsExamined + " ms=" + s.executionTimeMillis) }

// ----- AVANT les index -----
printjson(q1().explain("executionStats")); resume(q1().explain("executionStats"))
printjson(q2().explain("executionStats")); resume(q2().explain("executionStats"))
printjson(q3().explain("executionStats")); resume(q3().explain("executionStats"))

// Coût de E3 sans index (justifie l'index refusé)
var ca = [{ $match: { type: "MERCHANT_PAY", status: "COMPLETED" } }, { $group: { _id: "$merchantId", ca: { $sum: "$amount" }, paiements: { $sum: 1 } } }, { $sort: { ca: -1, _id: 1 } }]
var t0 = Date.now(); db.transactions.aggregate(ca).toArray(); print("E3 sans index : " + (Date.now() - t0) + " ms")
var t1 = Date.now(); db.transactions.aggregate(ca).toArray(); print("E3 sans index, 2e exécution : " + (Date.now() - t1) + " ms")

// ----- CRÉATION des index -----
// Index 1, règle ESR : E = fromWalletId, status (égalité) ; S = aucun tri ; R = createdAt (plage d'une journée).
// amount est ajouté en dernier pour couvrir la requête : MongoDB lit l'index seul, sans lire les documents.
db.transactions.createIndex({ fromWalletId: 1, status: 1, createdAt: 1, amount: 1 }, { name: "idx_sorties_wallet_jour" })
// Index 2, règle ESR : E = walletId (égalité), S = createdAt décroissant (tri de la requête, donc pas d'étape SORT).
db.ledger_entries.createIndex({ walletId: 1, createdAt: -1 }, { name: "idx_ledger_wallet_date" })
// Index 3 : unique sur idempotencyKey, prérequis de la Partie 4 (un doublon devient impossible).
db.transactions.createIndex({ idempotencyKey: 1 }, { unique: true, name: "uniq_idempotency_key" })

// ----- APRÈS les index -----
printjson(q1().explain("executionStats")); resume(q1().explain("executionStats"))
printjson(q2().explain("executionStats")); resume(q2().explain("executionStats"))
printjson(q3().explain("executionStats")); resume(q3().explain("executionStats"))
// Le même index sert l'historique complet du wallet : pas d'étape SORT
resume(db.ledger_entries.find({ walletId: "W000612" }).sort({ createdAt: -1 }).explain("executionStats"))
// L'index unique refuse un doublon (code 11000 attendu)
try { db.transactions.insertOne({ _id: "TEST_DOUBLON", idempotencyKey: "idem-401046a409a4ab48", type: "P2P", amount: 100, fee: 0, status: "PENDING", channel: "APP", createdAt: new Date(), riskScore: 0, flags: [] }); print("ACCEPTE (anormal)"); db.transactions.deleteOne({ _id: "TEST_DOUBLON" }) } catch (e) { print("transactions : code " + e.code); printjson(e.errmsg) }
// Index présents et tailles (utilisés en Partie 0 pour le facteur d'index)
db.transactions.getIndexes()
db.ledger_entries.getIndexes()
["transactions", "ledger_entries"].forEach(function (n) { var s = db[n].stats(); print(n + " : size=" + s.size + " storageSize=" + s.storageSize + " avgObjSize=" + s.avgObjSize + " totalIndexSize=" + s.totalIndexSize); printjson(s.indexSizes) })
// Comptages inchangés
db.getCollectionNames().sort().forEach(function (n) { print(n + " : " + db[n].countDocuments()) })

// ===== Complément (session du 9 novembre 2026, 18:46 UTC) =====
// Checklist du cours (chapitre 8) : 3 exécutions et médiane, taille des index avant/après,
// un cas où l'index n'aide pas, l'index refusé mesuré.
var q1 = function () { return db.transactions.find({ fromWalletId: "W000758", status: "COMPLETED", createdAt: { $gte: ISODate("2026-01-30T00:00:00Z"), $lt: ISODate("2026-01-31T00:00:00Z") } }, { amount: 1, _id: 0 }) }
var q2 = function () { return db.ledger_entries.find({ walletId: "W000612" }).sort({ createdAt: -1 }).limit(1) }
var q3 = function () { return db.transactions.find({ idempotencyKey: "idem-401046a409a4ab48" }) }
// Médiane d'une liste de temps
var med = function (a) { a = a.slice().sort(function (x, y) { return x - y }); return a[Math.floor(a.length / 2)] }
// Lance un explain 3 fois : plan, compteurs, 3 temps et médiane
var trois = function (label, f) { var t = [], e; for (var i = 0; i < 3; i++) { e = f().explain("executionStats"); t.push(e.executionStats.executionTimeMillis) }; var s = e.executionStats, wp = e.queryPlanner.winningPlan, p = wp.queryPlan || wp, r = []; while (p) { r.push(p.stage); p = p.inputStage }; print(label + " | " + r.join(" > ") + " | nReturned=" + s.nReturned + " keys=" + s.totalKeysExamined + " docs=" + s.totalDocsExamined + " | ms=" + t.join(", ") + " | mediane=" + med(t)) }
// « Avant » sans supprimer les index : hint({ $natural: 1 }) force la lecture complète de la collection
trois("Q1 avant (hint $natural)", function () { return q1().hint({ $natural: 1 }) })
trois("Q1 apres (index)", q1)
trois("Q2 avant (hint $natural)", function () { return q2().hint({ $natural: 1 }) })
trois("Q2 apres (index)", q2)
trois("Q3 avant (hint $natural)", function () { return q3().hint({ $natural: 1 }) })
trois("Q3 apres (index)", q3)
// Taille des index : avant la Partie 3, seul _id_ existait (sa taille ne change pas en ajoutant d'autres index)
["transactions", "ledger_entries"].forEach(function (n) { var s = db[n].stats(); var id = s.indexSizes._id_; print(n + " : avant (seul _id_) = " + id + " octets ; apres = " + s.totalIndexSize + " octets ; ajout = " + (s.totalIndexSize - id) + " octets") })
// Cas où l'index n'aide pas : pas de fromWalletId, donc pas de préfixe gauche : COLLSCAN
trois("Sans prefixe fromWalletId", function () { return db.transactions.find({ status: "COMPLETED", createdAt: { $gte: ISODate("2026-01-30T00:00:00Z"), $lt: ISODate("2026-01-31T00:00:00Z") } }) })
// Index refusé mesuré : E3 sans, puis avec l'index, puis suppression de l'index
var ca = [{ $match: { type: "MERCHANT_PAY", status: "COMPLETED" } }, { $group: { _id: "$merchantId", ca: { $sum: "$amount" }, paiements: { $sum: 1 } } }, { $sort: { ca: -1, _id: 1 } }]
var tempsE3 = function (label) { var t = []; for (var i = 0; i < 3; i++) { var t0 = Date.now(); db.transactions.aggregate(ca).toArray(); t.push(Date.now() - t0) }; print(label + " | ms=" + t.join(", ") + " | mediane=" + med(t)) }
// Résumé d'un explain d'agrégation (deux formes possibles selon le moteur d'exécution)
var resumeAgg = function (e) { var x = (e.stages && e.stages[0].$cursor) ? e.stages[0].$cursor : e; var s = x.executionStats, wp = x.queryPlanner.winningPlan, p = wp.queryPlan || wp, r = []; while (p) { r.push(p.stage); p = p.inputStage }; print(r.join(" > ") + " | keys=" + s.totalKeysExamined + " docs=" + s.totalDocsExamined) }
tempsE3("E3 sans l'index refuse")
resumeAgg(db.transactions.explain("executionStats").aggregate(ca))
db.transactions.createIndex({ type: 1, status: 1, merchantId: 1, amount: 1 }, { name: "idx_refuse_ca_marchand" })
tempsE3("E3 avec l'index refuse")
resumeAgg(db.transactions.explain("executionStats").aggregate(ca))
print("taille de l'index refuse : " + db.transactions.stats().indexSizes.idx_refuse_ca_marchand + " octets")
db.transactions.dropIndex("idx_refuse_ca_marchand")
// Vérifications : il ne reste que les 3 index retenus, comptages inchangés
db.transactions.getIndexes().map(function (i) { return i.name })
db.getCollectionNames().sort().forEach(function (n) { print(n + " : " + db[n].countDocuments()) })
