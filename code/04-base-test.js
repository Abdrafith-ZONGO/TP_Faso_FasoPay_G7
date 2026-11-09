// code/04-base-test.js : prépare la base de test de la Partie 4 (fasopay_test)
//
// Lancement : mongosh fasopay_test --quiet --file 04-base-test.js
// La base fasopay_tp (nos données du TP) n'est JAMAIS touchée : tous les tests se font ici.
// Le script repart de zéro à chaque lancement, pour que les tests soient rejouables.

if (db.getName() !== "fasopay_test") throw new Error("Ce script doit être lancé sur fasopay_test, pas sur " + db.getName());

db.dropDatabase();

// --- Les mêmes validateurs que sur fasopay_tp (Partie 1) : les documents écrits par transfer() devront les passer.
var idTexte = { bsonType: ["string", "objectId"] }, dateBson = { bsonType: "date" };
var montant = { bsonType: ["int", "long"], minimum: 0 }, montantPositif = { bsonType: ["int", "long"], minimum: 1 };

db.createCollection("wallets", { validationLevel: "strict", validationAction: "error", validator: { $jsonSchema: {
  bsonType: "object", required: ["_id", "customerId", "balance", "currency", "status", "dailyLimit", "version", "updatedAt"], additionalProperties: false,
  properties: { _id: idTexte, customerId: { bsonType: "string" }, balance: montant, currency: { bsonType: "string", enum: ["XOF"] },
    status: { bsonType: "string", enum: ["ACTIVE", "FROZEN"] }, dailyLimit: montantPositif, version: { bsonType: "int", minimum: 0 }, updatedAt: dateBson } } } });

db.createCollection("transactions", { validationLevel: "strict", validationAction: "error", validator: { $jsonSchema: {
  bsonType: "object", required: ["_id", "idempotencyKey", "type", "amount", "fee", "status", "channel", "createdAt", "riskScore", "flags"], additionalProperties: false,
  properties: { _id: idTexte, idempotencyKey: { bsonType: "string", minLength: 1 }, type: { bsonType: "string", enum: ["P2P", "MERCHANT_PAY", "CASH_IN", "CASH_OUT", "BILL"] },
    fromWalletId: { bsonType: "string" }, toWalletId: { bsonType: "string" }, merchantId: { bsonType: "string" }, amount: montantPositif, fee: montant,
    status: { bsonType: "string", enum: ["COMPLETED", "FAILED", "REVERSED", "PENDING"] }, channel: { bsonType: "string", enum: ["USSD", "APP", "QR"] },
    createdAt: dateBson, completedAt: dateBson, riskScore: { bsonType: "int", minimum: 0, maximum: 100 },
    flags: { bsonType: "array", items: { bsonType: "string", enum: ["HIGH_AMOUNT", "INSUFFICIENT_FUNDS", "NEW_RECIPIENT", "NETWORK_ERROR", "NIGHT", "SUPPORT_REVERSAL"] } },
    attempts: { bsonType: "array", items: { bsonType: "object", required: ["n", "at", "result"], additionalProperties: false,
      properties: { n: { bsonType: "int", minimum: 1 }, at: dateBson, result: { bsonType: "string", enum: ["PROCESSED", "REPLAYED"] } } } } } } } });

db.createCollection("ledger_entries", { validationLevel: "strict", validationAction: "error", validator: { $jsonSchema: {
  bsonType: "object", required: ["_id", "txId", "walletId", "direction", "amount", "createdAt"], additionalProperties: false,
  properties: { _id: idTexte, txId: { bsonType: "string" }, walletId: { bsonType: ["string", "null"] },
    account: { bsonType: "string", pattern: "^(FEES|FLOAT|BILLER|MERCHANT:M[0-9]{5})$" }, direction: { bsonType: "string", enum: ["DEBIT", "CREDIT"] },
    amount: montantPositif, balanceAfter: montant, createdAt: dateBson },
  oneOf: [{ properties: { walletId: { bsonType: "string" } }, required: ["balanceAfter"], not: { required: ["account"] } },
          { properties: { walletId: { bsonType: "null" } }, required: ["account"], not: { required: ["balanceAfter"] } }] } } });

db.createCollection("outbox", { validationLevel: "strict", validationAction: "error", validator: { $jsonSchema: {
  bsonType: "object", required: ["type", "txId", "status"], additionalProperties: false,
  properties: { _id: idTexte, type: { bsonType: "string", enum: ["TRANSFER_COMPLETED"] }, txId: { bsonType: "string" },
    status: { bsonType: "string", enum: ["PENDING", "SENT"] }, createdAt: dateBson, sentAt: dateBson } } } });

// --- L'index unique demandé par le contrat : une clé d'idempotence ne peut exister qu'une fois.
db.transactions.createIndex({ idempotencyKey: 1 }, { unique: true, name: "uniq_idempotency_key" });

// --- Les wallets de test, chacun avec un rôle précis
var w = function (id, solde, statut) {
  return { _id: id, customerId: "C-" + id, balance: NumberInt(solde), currency: "XOF", status: statut,
           dailyLimit: NumberInt(200000), version: NumberInt(0), updatedAt: new Date() };
};
db.wallets.insertMany([
  w("W_A", 100000, "ACTIVE"),      // émetteur des tests simples (succès, rejeux, abort, réponse perdue)
  w("W_B", 0, "ACTIVE"),           // destinataire des tests simples
  w("W_PETIT", 500, "ACTIVE"),     // solde trop faible : refus INSUFFICIENT_FUNDS
  w("W_GEL", 50000, "FROZEN"),     // wallet gelé : refus WALLET_NOT_FOUND_OR_FROZEN
  w("W_CONC", 3000, "ACTIVE"),     // test de concurrence : 3 000 FCFA, 50 virements de 100 demandés
  w("W_CONC_DEST", 0, "ACTIVE"),
  w("W_MC", 10000, "ACTIVE"),      // même clé envoyée par deux clients en même temps
  w("W_MC_DEST", 0, "ACTIVE"),
  w("W_LU", 3000, "ACTIVE")        // démonstration du « lost update » (version naïve, sans transaction)
]);

// --- Ce qui a été préparé
print("base : " + db.getName());
print("collections : " + JSON.stringify(db.getCollectionNames().sort()));
print("index de transactions : " + JSON.stringify(db.transactions.getIndexes().map(function (i) { return i.name; })));
db.wallets.find({}, { balance: 1, status: 1 }).sort({ _id: 1 }).forEach(function (x) { print("  " + x._id + " : " + x.balance + " FCFA, " + x.status); });
