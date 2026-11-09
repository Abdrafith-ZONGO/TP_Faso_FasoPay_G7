// Partie 0 - Mesures de dimensionnement (mongosh, base fasopay_tp). Lectures seules.

// A. Taille BSON moyenne : $bsonSize donne la taille de chaque document ; on mesure toute la collection (donc plus de 1000 documents).
db.transactions.aggregate([{ $group: { _id: null, documents: { $sum: 1 }, octetsMoyens: { $avg: { $bsonSize: "$$ROOT" } }, octetsMax: { $max: { $bsonSize: "$$ROOT" } } } }])
db.ledger_entries.aggregate([{ $group: { _id: null, documents: { $sum: 1 }, octetsMoyens: { $avg: { $bsonSize: "$$ROOT" } }, octetsMax: { $max: { $bsonSize: "$$ROOT" } } } }])
db.wallets.aggregate([{ $group: { _id: null, documents: { $sum: 1 }, octetsMoyens: { $avg: { $bsonSize: "$$ROOT" } }, octetsMax: { $max: { $bsonSize: "$$ROOT" } } } }])
// Même mesure sur un échantillon aléatoire de 1000 documents (exigence du sujet)
db.transactions.aggregate([{ $sample: { size: 1000 } }, { $group: { _id: null, echantillon: { $sum: 1 }, octetsMoyens: { $avg: { $bsonSize: "$$ROOT" } } } }])
db.ledger_entries.aggregate([{ $sample: { size: 1000 } }, { $group: { _id: null, echantillon: { $sum: 1 }, octetsMoyens: { $avg: { $bsonSize: "$$ROOT" } } } }])

// B. Taille des données (size, non compressée), du stockage (storageSize, compressé sur disque) et des index
["transactions", "ledger_entries", "wallets", "customers", "merchants"].forEach(function (n) { var s = db[n].stats(); print(n + " : count=" + s.count + " size=" + s.size + " storageSize=" + s.storageSize + " avgObjSize=" + s.avgObjSize + " totalIndexSize=" + s.totalIndexSize); printjson(s.indexSizes) })

// C. Lignes de ledger par transaction, et jambes de wallet par transaction (= mises à jour de wallet)
print(db.ledger_entries.countDocuments() + " lignes / " + db.transactions.countDocuments() + " transactions = " + (db.ledger_entries.countDocuments() / db.transactions.countDocuments()))
print(db.ledger_entries.countDocuments({ walletId: { $ne: null } }) + " jambes de wallet / " + db.transactions.countDocuments() + " transactions = " + (db.ledger_entries.countDocuments({ walletId: { $ne: null } }) / db.transactions.countDocuments()))

// D. Écritures par type de transaction. $group par (type, transaction) puis par type.
// Le $lookup par txId vers transactions._id utilise l'index _id.
db.ledger_entries.aggregate([{ $lookup: { from: "transactions", localField: "txId", foreignField: "_id", as: "t" } }, { $unwind: "$t" }, { $group: { _id: { type: "$t.type", tx: "$txId" }, lignes: { $sum: 1 }, jambesWallet: { $sum: { $cond: [{ $ne: ["$walletId", null] }, 1, 0] } } } }, { $group: { _id: "$_id.type", transactions: { $sum: 1 }, lignesMoyennes: { $avg: "$lignes" }, jambesWalletMoyennes: { $avg: "$jambesWallet" } } }, { $sort: { _id: 1 } }])

// E. Fenêtre chaude : les 30 derniers jours du jeu (comptés depuis la dernière transaction)
var bornes = db.transactions.aggregate([{ $group: { _id: null, debut: { $min: "$createdAt" }, fin: { $max: "$createdAt" } } }]).toArray()[0]
bornes
var coupe = new Date(bornes.fin.getTime() - 30 * 24 * 3600 * 1000)
coupe
db.transactions.aggregate([{ $match: { createdAt: { $gte: coupe } } }, { $group: { _id: null, transactions: { $sum: 1 }, octets: { $sum: { $bsonSize: "$$ROOT" } } } }])
db.ledger_entries.aggregate([{ $match: { createdAt: { $gte: coupe } } }, { $group: { _id: null, lignes: { $sum: 1 }, octets: { $sum: { $bsonSize: "$$ROOT" } } } }])

// F. Taille d'un document outbox. Object.bsonsize n'existe pas dans mongosh : on utilise $bsonSize dans un pipeline.
db.wallets.aggregate([{ $limit: 1 }, { $project: { _id: 0, octetsOutbox: { $bsonSize: { _id: ObjectId(), type: "TRANSFER_COMPLETED", txId: "T0000001", status: "PENDING", createdAt: new Date() } } } }])