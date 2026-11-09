// Partie 1 - Mesures pour la modélisation (preuves/01-mesures-modelisation.txt)
// Base : fasopay_tp. À rejouer dans mongosh.
// (Le terminal peut afficher des mots déformés, ex. "$co$cond" : défaut d'affichage, pas de la commande.)

// Wallets par client
db.wallets.aggregate([{ $group: { _id: "$customerId", n: { $sum: 1 } } }, { $group: { _id: "$n", clients: { $sum: 1 } } }])

// Lignes de ledger par transaction
db.ledger_entries.aggregate([{ $group: { _id: "$txId", n: { $sum: 1 } } }, { $group: { _id: "$n", transactions: { $sum: 1 } } }, { $sort: { _id: 1 } }])

// Transactions avec ledger, et transactions FAILED / PENDING
db.ledger_entries.aggregate([{ $group: { _id: "$txId" } }, { $count: "transactionsAvecLedger" }])
db.transactions.countDocuments({ status: { $in: ["FAILED", "PENDING"] } })

// Partie double : transactions déséquilibrées
db.ledger_entries.aggregate([{ $group: { _id: "$txId", net: { $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } } } }, { $group: { _id: null, transactions: { $sum: 1 }, desequilibrees: { $sum: { $cond: [{ $ne: ["$net", 0] }, 1, 0] } } } }])

// Totaux crédits / débits
db.ledger_entries.aggregate([{ $group: { _id: "$direction", total: { $sum: "$amount" } } }])

// Transactions émises par wallet
db.transactions.aggregate([{ $match: { fromWalletId: { $exists: true } } }, { $group: { _id: "$fromWalletId", n: { $sum: 1 } } }, { $group: { _id: null, wallets: { $sum: 1 }, moyenne: { $avg: "$n" }, maximum: { $max: "$n" } } }])

// Transactions par marchand
db.transactions.aggregate([{ $match: { merchantId: { $exists: true } } }, { $group: { _id: "$merchantId", n: { $sum: 1 } } }, { $group: { _id: null, marchands: { $sum: 1 }, total: { $sum: "$n" }, moyenne: { $avg: "$n" }, maximum: { $max: "$n" } } }])

// Transactions avec tentatives (attempts)
db.transactions.countDocuments({ attempts: { $exists: true } })

// Taille moyenne d'une ligne de ledger de wallet (octets)
db.ledger_entries.aggregate([{ $match: { walletId: { $ne: null } } }, { $group: { _id: null, octetsMoyens: { $avg: { $bsonSize: "$$ROOT" } } } }])

// ===== Complément (session du 9 novembre 2026, 19:15 UTC) : annulations et écriture inverse =====
// Nombre de transactions annulées
db.transactions.countDocuments({ status: "REVERSED" })
// Les transactions à 4 ou 6 lignes de ledger, et leur statut.
// On part du ledger (regroupé par txId) pour joindre transactions par _id, qui est indexé.
db.ledger_entries.aggregate([{ $group: { _id: "$txId", lignes: { $sum: 1 } } }, { $match: { lignes: { $in: [4, 6] } } }, { $lookup: { from: "transactions", localField: "_id", foreignField: "_id", as: "t" } }, { $unwind: "$t" }, { $group: { _id: { statut: "$t.status", lignes: "$lignes" }, transactions: { $sum: 1 } } }, { $sort: { "_id.lignes": 1 } }])
// Exemple détaillé : les lignes de ledger d'une transaction annulée, dans l'ordre chronologique
db.ledger_entries.find({ txId: "T0002044" }, { _id: 0, txId: 1, walletId: 1, account: 1, direction: 1, amount: 1, balanceAfter: 1, createdAt: 1 }).sort({ createdAt: 1 })
