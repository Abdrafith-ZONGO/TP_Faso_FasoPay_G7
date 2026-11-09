// Partie 2 - Enquête (mongosh, base fasopay_tp). Lectures seules.

// ===== E1 : wallets dont balance != somme signée du ledger =====
// Convention : écart = wallets.balance - somme signée du ledger (CREDIT +, DEBIT -).
var e1 = [
  // 1. $match en premier : on écarte les 70 054 jambes sans wallet (walletId null, champ account),
  //    qui ne concernent aucun solde. On ne traite que les 71 885 jambes de wallet.
  { $match: { walletId: { $ne: null } } },
  // 2. $group avant $lookup : on réduit 71 885 lignes à 2000 wallets, donc 2000 jointures
  //    au lieu de 71 885. On calcule ici le solde signé du ledger de chaque wallet.
  { $group: { _id: "$walletId", soldeLedger: { $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } }, lignes: { $sum: 1 } } },
  // 3. $lookup par walletId (jamais par nom) vers wallets._id, qui est indexé par défaut.
  { $lookup: { from: "wallets", localField: "_id", foreignField: "_id", as: "w" } },
  { $unwind: "$w" },
  // 4. $project : on garde les champs utiles et on calcule l'écart.
  { $project: { _id: 1, balance: "$w.balance", soldeLedger: 1, lignes: 1, ecart: { $subtract: ["$w.balance", "$soldeLedger"] } } },
  // 5. $match sur le calcul : on ne garde que les wallets incohérents (il faut l'écart, donc après $project).
  { $match: { ecart: { $ne: 0 } } },
  // 6. $sort en dernier : sur 6 documents seulement.
  { $sort: { ecart: 1 } }
]
// Liste des wallets incohérents et de leurs écarts
db.ledger_entries.aggregate(e1)
// Nombre de wallets, écart net et écart absolu
db.ledger_entries.aggregate(e1.concat([{ $group: { _id: null, wallets: { $sum: 1 }, ecartNet: { $sum: "$ecart" }, ecartAbsolu: { $sum: { $abs: "$ecart" } } } }]))
// Contrôle de couverture : nombre de wallets ayant au moins une ligne de ledger (attendu : 2000)
db.ledger_entries.aggregate([{ $match: { walletId: { $ne: null } } }, { $group: { _id: "$walletId" } }, { $count: "walletsAvecLedger" }])
// Rattachement au fingerprint : total du ledger signé, et total des soldes (walletsBalanceTotal)
db.ledger_entries.aggregate([{ $match: { walletId: { $ne: null } } }, { $group: { _id: null, totalLedgerSigne: { $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } } } }])
db.wallets.aggregate([{ $group: { _id: null, totalBalances: { $sum: "$balance" } } }])
// Cause : balance comparée à la dernière valeur balanceAfter du ledger du wallet.
// $match d'abord, $sort avant $group pour que $last donne la dernière ligne dans le temps.
db.ledger_entries.aggregate([{ $match: { walletId: { $ne: null } } }, { $sort: { createdAt: 1, _id: 1 } }, { $group: { _id: "$walletId", derniereBalanceAfter: { $last: "$balanceAfter" } } }, { $lookup: { from: "wallets", localField: "_id", foreignField: "_id", as: "w" } }, { $unwind: "$w" }, { $match: { $expr: { $ne: ["$w.balance", "$derniereBalanceAfter"] } } }, { $project: { _id: 1, balance: "$w.balance", derniereBalanceAfter: 1 } }, { $sort: { _id: 1 } }])