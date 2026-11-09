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

// ===== E2 : clients qui découpent leurs transferts sous le plafond journalier =====
// Critère (choix assumé) : un wallet est suspect un jour donné s'il émet au moins 3 transactions
// COMPLETED de type P2P ou CASH_OUT, chacune comprise entre 90 % et 100 % de son plafond dailyLimit.
// Le jour est compté en UTC (le Burkina Faso est à UTC+0).
// seuil : part minimale du plafond (0.9 pour 90 %) ; minTx : nombre minimal de transactions dans la journée.
var e2 = function (seuil, minTx) {
  return [
    // 1. $match en premier : on ne garde que les sorties d'argent abouties (COMPLETED, P2P ou CASH_OUT).
    //    Le $lookup suivant se fait une fois par document restant : plus on réduit tôt, moins il coûte.
    { $match: { status: "COMPLETED", type: { $in: ["P2P", "CASH_OUT"] }, fromWalletId: { $exists: true } } },
    // 2. $lookup par fromWalletId vers wallets._id (indexé par défaut) pour récupérer le plafond de l'émetteur.
    { $lookup: { from: "wallets", localField: "fromWalletId", foreignField: "_id", as: "w" } },
    { $unwind: "$w" },
    // 3. Deuxième $match, forcément après le $lookup : il compare le montant à un champ d'un autre
    //    document (le plafond). Il garde la bande [seuil x plafond ; plafond].
    { $match: { $expr: { $and: [{ $gte: ["$amount", { $multiply: ["$w.dailyLimit", seuil] }] }, { $lte: ["$amount", "$w.dailyLimit"] }] } } },
    // 4. $group par wallet et par jour : on compte les transactions proches du plafond et on cumule leur total.
    { $group: { _id: { wallet: "$fromWalletId", jour: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } } }, transactions: { $sum: 1 }, total: { $sum: "$amount" }, plafond: { $first: "$w.dailyLimit" } } },
    // 5. $match après le $group : le nombre de transactions n'existe qu'après le regroupement.
    { $match: { transactions: { $gte: minTx } } },
    // 6. $sort en dernier : il ne porte plus que sur quelques groupes.
    { $sort: { "_id.wallet": 1, "_id.jour": 1 } }
  ]
}
// Couples wallet-jour suspects (seuil 90 %, au moins 3 transactions)
// .toArray() affiche les 23 couples d'un coup : sans lui, mongosh s'arrête à 20 documents
db.transactions.aggregate(e2(0.9, 3)).toArray()
// Résumé par wallet : jours suspects, transactions et montant total
db.transactions.aggregate(e2(0.9, 3).concat([{ $group: { _id: "$_id.wallet", jours: { $sum: 1 }, transactions: { $sum: "$transactions" }, total: { $sum: "$total" }, plafond: { $first: "$plafond" } } }, { $sort: { _id: 1 } }]))
// Qui sont ces clients : $match sur 5 wallets avant le $lookup vers customers
db.wallets.aggregate([{ $match: { _id: { $in: ["W000214", "W000758", "W001070", "W001218", "W001322"] } } }, { $lookup: { from: "customers", localField: "customerId", foreignField: "_id", as: "c" } }, { $unwind: "$c" }, { $project: { customerId: 1, dailyLimit: 1, segment: "$c.segment", kycLevel: "$c.kycLevel", city: "$c.city" } }, { $sort: { _id: 1 } }])
// Cas détaillé : W000758 le 2026-01-30, transaction par transaction
db.wallets.findOne({ _id: "W000758" })
db.transactions.find({ fromWalletId: "W000758", createdAt: { $gte: ISODate("2026-01-30T00:00:00Z"), $lt: ISODate("2026-01-31T00:00:00Z") } }, { type: 1, amount: 1, status: 1, toWalletId: 1, createdAt: 1, flags: 1 }).sort({ createdAt: 1 })
// Contrôle 1 : aucune sortie ne dépasse le plafond à elle seule (tous statuts)
db.transactions.aggregate([{ $match: { fromWalletId: { $exists: true } } }, { $lookup: { from: "wallets", localField: "fromWalletId", foreignField: "_id", as: "w" } }, { $unwind: "$w" }, { $group: { _id: null, sorties: { $sum: 1 }, depassantLePlafond: { $sum: { $cond: [{ $gt: ["$amount", "$w.dailyLimit"] }, 1, 0] } } } }])
// Contrôle 2 : qui a des montants entre 90 % et 100 % du plafond (tous types et statuts)
db.transactions.aggregate([{ $match: { fromWalletId: { $exists: true } } }, { $lookup: { from: "wallets", localField: "fromWalletId", foreignField: "_id", as: "w" } }, { $unwind: "$w" }, { $match: { $expr: { $and: [{ $gte: ["$amount", { $multiply: ["$w.dailyLimit", 0.9] }] }, { $lte: ["$amount", "$w.dailyLimit"] }] } } }, { $group: { _id: { type: "$type", status: "$status" }, n: { $sum: 1 }, wallets: { $addToSet: "$fromWalletId" } } }])
// Contrôle 3 : le seuil change-t-il le résultat ? Nombre de wallets à 50 % puis à 70 %
db.transactions.aggregate(e2(0.5, 3).concat([{ $group: { _id: "$_id.wallet" } }, { $count: "wallets" }]))
db.transactions.aggregate(e2(0.7, 3).concat([{ $group: { _id: "$_id.wallet" } }, { $count: "wallets" }]))

// ===== E3 : marchands qui concentrent le CA, courbe de Pareto =====
// Définition : CA d'un marchand = somme des amount des MERCHANT_PAY au statut COMPLETED.
// FAILED/PENDING : rien encaissé ; REVERSED : remboursements ; fee : commission de FasoPay, pas le CA du marchand.

// Justification de la définition : paiements marchands par statut
db.transactions.aggregate([{ $match: { type: "MERCHANT_PAY" } }, { $group: { _id: "$status", paiements: { $sum: 1 }, montant: { $sum: "$amount" } } }, { $sort: { _id: 1 } }])
// Rattachement au fingerprint : la somme des montants COMPLETED par type vaut transactionsAmountCompleted (1 946 303 325)
db.transactions.aggregate([{ $match: { status: "COMPLETED" } }, { $group: { _id: "$type", transactions: { $sum: 1 }, montant: { $sum: "$amount" } } }, { $sort: { _id: 1 } }])

var ca = [
  // 1. $match en premier : on ne garde que les 16 603 paiements marchands COMPLETED sur 60 000 transactions.
  { $match: { type: "MERCHANT_PAY", status: "COMPLETED" } },
  // 2. $group par marchand : CA et nombre de paiements.
  { $group: { _id: "$merchantId", ca: { $sum: "$amount" }, paiements: { $sum: 1 } } },
  // 3. $sort décroissant ; _id départage les égalités pour un résultat reproductible.
  { $sort: { ca: -1, _id: 1 } }
]
// Dix premiers marchands : $limit AVANT $lookup, donc 10 jointures au lieu de 150.
db.transactions.aggregate(ca.concat([{ $limit: 10 }, { $lookup: { from: "merchants", localField: "_id", foreignField: "_id", as: "m" } }, { $unwind: "$m" }, { $project: { ca: 1, paiements: 1, nom: "$m.name", categorie: "$m.category", ville: "$m.city" } }, { $sort: { ca: -1, _id: 1 } }]))
// Contrôle : les 150 CA sont tous différents (attendu : 150). Cela justifie un tri sur ca seul ci-dessous.
db.transactions.aggregate(ca.concat([{ $group: { _id: "$ca" } }, { $count: "caDistincts" }]))
// Courbe de Pareto : $documentNumber exige un sortBy à un seul champ, d'où sortBy: { ca: -1 }.
// caCumule : somme glissante du début au marchand courant ; totalCA et marchands : fenêtre complète.
// On garde le rang 1 puis un rang sur 15 (10 %, 20 %, ... 100 % des marchands).
db.transactions.aggregate(ca.concat([{ $setWindowFields: { sortBy: { ca: -1 }, output: { rang: { $documentNumber: {} }, caCumule: { $sum: "$ca", window: { documents: ["unbounded", "current"] } }, totalCA: { $sum: "$ca", window: { documents: ["unbounded", "unbounded"] } }, marchands: { $sum: 1, window: { documents: ["unbounded", "unbounded"] } } } } }, { $match: { $expr: { $or: [{ $eq: ["$rang", 1] }, { $eq: [{ $mod: ["$rang", 15] }, 0] }] } } }, { $project: { _id: 0, rang: 1, marchands: 1, partMarchandsPct: { $round: [{ $multiply: [{ $divide: ["$rang", "$marchands"] }, 100] }, 1] }, caCumule: 1, totalCA: 1, partCaPct: { $round: [{ $multiply: [{ $divide: ["$caCumule", "$totalCA"] }, 100] }, 2] } } }]))

// ===== E4 : clés d'idempotence rejouées et incident =====
// attempts : tableau de tentatives { n, at, result } ; result = PROCESSED (1re tentative) ou REPLAYED (rejeu).

var e4 = [
  // 1. $match en premier : seules les 21 transactions qui ont un tableau attempts sont gardées (sur 60 000).
  { $match: { attempts: { $exists: true } } },
  // 2. $project : une ligne par clé. $filter compte les tentatives traitées et rejouées ;
  //    $min / $max sur attempts.at donnent la première et la dernière tentative.
  { $project: { idempotencyKey: 1, type: 1, amount: 1, status: 1, createdAt: 1, tentatives: { $size: "$attempts" }, traitees: { $size: { $filter: { input: "$attempts", as: "a", cond: { $eq: ["$$a.result", "PROCESSED"] } } } }, rejeux: { $size: { $filter: { input: "$attempts", as: "a", cond: { $eq: ["$$a.result", "REPLAYED"] } } } }, premier: { $min: "$attempts.at" }, dernier: { $max: "$attempts.at" } } },
  // 3. $addFields après $project, car il utilise les champs calculés :
  //    durée entre première et dernière tentative, et montant qui serait payé en double si chaque rejeu était exécuté.
  { $addFields: { dureeSecondes: { $round: [{ $divide: [{ $subtract: ["$dernier", "$premier"] }, 1000] }, 1] }, montantExpose: { $multiply: ["$amount", "$rejeux"] } } },
  // 4. $sort en dernier : sur 21 documents seulement.
  { $sort: { createdAt: 1 } }
]
// Liste des 21 clés rejouées. .toArray() : sans lui, mongosh s'arrête à 20 documents.
db.transactions.aggregate(e4).toArray()
// Totaux : clés, tentatives, traitées, rejeux, montant exposé
db.transactions.aggregate(e4.concat([{ $group: { _id: null, cles: { $sum: 1 }, tentatives: { $sum: "$tentatives" }, traitees: { $sum: "$traitees" }, rejeux: { $sum: "$rejeux" }, montantExpose: { $sum: "$montantExpose" } } }]))
// Par jour : $unwind éclate le tableau en une ligne par tentative, puis $group par jour (UTC = heure du Burkina Faso).
// cles : nombre de clés distinctes ce jour-là.
db.transactions.aggregate([{ $match: { attempts: { $exists: true } } }, { $unwind: "$attempts" }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$attempts.at" } }, tentatives: { $sum: 1 }, rejeux: { $sum: { $cond: [{ $eq: ["$attempts.result", "REPLAYED"] }, 1, 0] } }, cles: { $addToSet: "$idempotencyKey" } } }, { $project: { tentatives: 1, rejeux: 1, cles: { $size: "$cles" } } }, { $sort: { _id: 1 } }])
// Fenêtre exacte de l'incident (2026-04-10) : $match sur la date après $unwind, car la date est dans chaque tentative.
db.transactions.aggregate([{ $match: { attempts: { $exists: true } } }, { $unwind: "$attempts" }, { $match: { "attempts.at": { $gte: ISODate("2026-04-10T00:00:00Z"), $lt: ISODate("2026-04-11T00:00:00Z") } } }, { $group: { _id: null, debut: { $min: "$attempts.at" }, fin: { $max: "$attempts.at" }, tentatives: { $sum: 1 }, rejeux: { $sum: { $cond: [{ $eq: ["$attempts.result", "REPLAYED"] }, 1, 0] } }, cles: { $addToSet: "$idempotencyKey" } } }, { $project: { _id: 0, debut: 1, fin: 1, tentatives: 1, rejeux: 1, cles: { $size: "$cles" } } }])
// Répartition par heure de ce jour
db.transactions.aggregate([{ $match: { attempts: { $exists: true } } }, { $unwind: "$attempts" }, { $match: { "attempts.at": { $gte: ISODate("2026-04-10T00:00:00Z"), $lt: ISODate("2026-04-11T00:00:00Z") } } }, { $group: { _id: { $hour: "$attempts.at" }, tentatives: { $sum: 1 } } }, { $sort: { _id: 1 } }])
// Contrôle 1 : chaque idempotencyKey n'apparaît qu'une fois (attendu : 60000 clés avec n = 1)
db.transactions.aggregate([{ $group: { _id: "$idempotencyKey", n: { $sum: 1 } } }, { $group: { _id: "$n", cles: { $sum: 1 } } }])
// Contrôle 2 : lignes de ledger des 21 transactions rejouées (attendu : 2 ou 3, pas de ligne en double).
// Le $lookup par txId parcourt le ledger (pas d'index sur txId) : acceptable pour 21 transactions.
db.transactions.aggregate([{ $match: { attempts: { $exists: true } } }, { $lookup: { from: "ledger_entries", localField: "_id", foreignField: "txId", as: "l" } }, { $group: { _id: { $size: "$l" }, transactions: { $sum: 1 } } }, { $sort: { _id: 1 } }])
// Contrôle 3 : paiements marchands en double avec des clés différentes (même wallet, marchand, montant, moins de 10 minutes).
// $shift lit la transaction précédente dans la même partition. Attendu : aucun résultat.
db.transactions.aggregate([{ $match: { type: "MERCHANT_PAY" } }, { $setWindowFields: { partitionBy: { w: "$fromWalletId", m: "$merchantId", a: "$amount" }, sortBy: { createdAt: 1 }, output: { precedent: { $shift: { output: "$createdAt", by: -1 } } } } }, { $match: { precedent: { $ne: null }, $expr: { $lt: [{ $subtract: ["$createdAt", "$precedent"] }, 600000] } } }, { $count: "paiementsEnDoubleSous10min" }])

// ===== Compléments (session du 9 novembre 2026, 18:24 UTC) =====

// (1) Dépôts d'ouverture : transactions avant le 1er janvier 2026, puis leurs lignes de ledger.
// Sert à montrer que E1 n'a pas de « faux positif d'ouverture » : les soldes initiaux sont dans le ledger.
db.transactions.aggregate([{ $match: { createdAt: { $lt: ISODate("2026-01-01T00:00:00Z") } } }, { $group: { _id: { type: "$type", status: "$status" }, transactions: { $sum: 1 }, montant: { $sum: "$amount" }, wallets: { $addToSet: "$toWalletId" } } }, { $project: { transactions: 1, montant: 1, walletsDistincts: { $size: "$wallets" } } }])
var ouverture = db.transactions.find({ createdAt: { $lt: ISODate("2026-01-01T00:00:00Z") } }, { _id: 1 }).toArray().map(function (t) { return t._id })
db.ledger_entries.aggregate([{ $match: { txId: { $in: ouverture } } }, { $group: { _id: { direction: "$direction", jambeWallet: { $ne: ["$walletId", null] } }, lignes: { $sum: 1 }, montant: { $sum: "$amount" } } }, { $sort: { "_id.direction": 1 } }])

// (2) Fuseau horaire explicite dans $dateToString (piège du cours, chapitre 7).
// Le Burkina Faso est en UTC+0 : le résultat est identique, mais le code est juste quel que soit le serveur.
var e2tz = function (seuil, minTx) { return [{ $match: { status: "COMPLETED", type: { $in: ["P2P", "CASH_OUT"] }, fromWalletId: { $exists: true } } }, { $lookup: { from: "wallets", localField: "fromWalletId", foreignField: "_id", as: "w" } }, { $unwind: "$w" }, { $match: { $expr: { $and: [{ $gte: ["$amount", { $multiply: ["$w.dailyLimit", seuil] }] }, { $lte: ["$amount", "$w.dailyLimit"] }] } } }, { $group: { _id: { wallet: "$fromWalletId", jour: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Africa/Ouagadougou" } } }, transactions: { $sum: 1 }, total: { $sum: "$amount" }, plafond: { $first: "$w.dailyLimit" } } }, { $match: { transactions: { $gte: minTx } } }] }
db.transactions.aggregate(e2tz(0.9, 3).concat([{ $group: { _id: null, couples: { $sum: 1 }, transactions: { $sum: "$transactions" }, wallets: { $addToSet: "$_id.wallet" } } }, { $project: { _id: 0, couples: 1, transactions: 1, wallets: { $size: "$wallets" } } }]))
db.transactions.aggregate([{ $match: { attempts: { $exists: true } } }, { $unwind: "$attempts" }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$attempts.at", timezone: "Africa/Ouagadougou" } }, tentatives: { $sum: 1 }, rejeux: { $sum: { $cond: [{ $eq: ["$attempts.result", "REPLAYED"] }, 1, 0] } } } }, { $sort: { _id: 1 } }])

// (3) Le contrôle des doublons détecte-t-il vraiment ? Test sur une copie jetable : fasopay_tp n'est pas modifiée.
var audit = db.getSiblingDB("fasopay_audit")
db.transactions.aggregate([{ $match: { type: "MERCHANT_PAY" } }, { $out: { db: "fasopay_audit", coll: "paiements" } }])
audit.paiements.countDocuments()
var controle = [{ $setWindowFields: { partitionBy: { w: "$fromWalletId", m: "$merchantId", a: "$amount" }, sortBy: { createdAt: 1 }, output: { precedent: { $shift: { output: "$createdAt", by: -1 } } } } }, { $match: { precedent: { $ne: null }, $expr: { $lt: [{ $subtract: ["$createdAt", "$precedent"] }, 600000] } } }, { $project: { fromWalletId: 1, merchantId: 1, amount: 1, createdAt: 1, precedent: 1, idempotencyKey: 1 } }]
audit.paiements.aggregate(controle).toArray()   // attendu : []
var orig = audit.paiements.findOne({ _id: "T0003152" }); orig._id = "FAUX_DOUBLON"; orig.idempotencyKey = "idem-faux-doublon"; orig.createdAt = new Date(orig.createdAt.getTime() + 60000); audit.paiements.insertOne(orig)
audit.paiements.aggregate(controle).toArray()   // attendu : exactement 1 résultat, FAUX_DOUBLON
audit.dropDatabase()
db.getCollectionNames().sort().forEach(function (n) { print(n + " : " + db[n].countDocuments()) })