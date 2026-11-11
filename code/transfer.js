// code/transfer.js : TP FasoPay, groupe 07
//
// Ce fichier ne fait que DÉFINIR la fonction transfer() : le charger ne lit ni n'écrit rien.
// Utilisation dans mongosh :
//   load("code/transfer.js")
//   transfer("W1", "W2", 100, "cle-unique")
//
// Réponses possibles (contrat de l'énoncé) :
//   { ok: true, replay: false, txId }          virement fait
//   { ok: true, replay: true, txId, status }   même clé déjà utilisée : même txId, rien de plus
//   { ok: false, error: "..." }                INSUFFICIENT_FUNDS, WALLET_NOT_FOUND_OR_FROZEN,
//                                              INVALID_AMOUNT ou CRASH_SIMULATED
//
// Options (opts) :
//   failAfterFirstWrite: true  -> provoque CRASH_SIMULATED juste après la première écriture (exigé par l'énoncé)
//   onFirstWrite: fonction     -> nos tests : appelée juste après la première écriture, pour prouver qu'elle existe
//   stats: {}                  -> nos tests : reçoit le nombre d'essais utilisés (conflits rejoués)

function transfer(fromWalletId, toWalletId, amount, idempotencyKey, opts) {
  opts = opts || {};
  var base = db;          // la base courante au moment de l'appel (celle du correcteur, ou fasopay_test chez nous)
  var MAX_ESSAIS = 60;    // nombre maximum de tentatives quand MongoDB signale un conflit passager

  // ---------------------------------------------------------------------------
  // 1. Contrôles de départ, sans toucher à la base
  // ---------------------------------------------------------------------------
  // Le montant peut arriver comme un nombre ordinaire ou comme NumberInt / NumberLong : on le ramène à un nombre.
  var n = (typeof amount === "number") ? amount
    : (amount !== null && typeof amount === "object" && typeof amount.toNumber === "function") ? amount.toNumber()
    : (amount !== null && typeof amount === "object" && typeof amount.valueOf === "function") ? Number(amount.valueOf())
    : NaN;
  // Un franc CFA ne se divise pas : le montant doit être un entier strictement positif.
  if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, error: "INVALID_AMOUNT" };
  // Envoyer de l'argent à soi-même n'a pas de sens. Le contrat ne prévoit pas d'erreur dédiée :
  // nous utilisons INVALID_AMOUNT, la plus proche (même chose pour une clé absente).
  if (fromWalletId === toWalletId) return { ok: false, error: "INVALID_AMOUNT" };
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) return { ok: false, error: "INVALID_AMOUNT" };
  // On enregistre le montant comme un ENTIER BSON (int, ou long s'il est très grand), jamais comme un double.
  var montant = (n <= 2147483647) ? NumberInt(n) : NumberLong(String(n));
  var moins = (n <= 2147483647) ? NumberInt(-n) : NumberLong(String(-n));

  // ---------------------------------------------------------------------------
  // 2. La clé a-t-elle déjà servi ? Si oui, c'est un rejeu : on renvoie le même txId, sans rien écrire.
  // ---------------------------------------------------------------------------
  var deja = base.transactions.findOne({ idempotencyKey: idempotencyKey });
  if (deja) return { ok: true, replay: true, txId: deja._id, status: deja.status };

  // ---------------------------------------------------------------------------
  // 3. Les collections utiles doivent exister avant la transaction.
  //    La base du correcteur peut ne contenir que wallets et transactions.
  //    On les crée ici, au moment de l'appel, jamais au chargement du fichier.
  // ---------------------------------------------------------------------------
  ["transactions", "ledger_entries", "outbox"].forEach(function (c) {
    if (base.getCollectionNames().indexOf(c) < 0) {
      try { base.createCollection(c); } catch (e) { if (e.code !== 48) throw e; }   // 48 : un autre client vient de la créer
    }
  });

  // Petits outils : lire l'étiquette d'une erreur MongoDB, et fabriquer une erreur « refus du contrat ».
  var aLabel = function (e, l) {
    return !!e && ((typeof e.hasErrorLabel === "function" && e.hasErrorLabel(l)) ||
      (Array.isArray(e.errorLabels) && e.errorLabels.indexOf(l) >= 0));
  };
  var refus = function (code) { var e = new Error(code); e.refusFasoPay = code; return e; };

  // ---------------------------------------------------------------------------
  // 4. La transaction : tout ou rien. Rejouée si MongoDB signale un conflit passager.
  // ---------------------------------------------------------------------------
  var session = base.getMongo().startSession();
  try {
    for (var essai = 1; essai <= MAX_ESSAIS; essai++) {
      if (opts.stats) opts.stats.essais = essai;
      var s = session.getDatabase(base.getName());   // tout ce qui passe par « s » fait partie de la transaction
      var txId = "T" + new ObjectId().toHexString();
      var maintenant = new Date();
      // w: "majority" exigé par le contrat ; lecture « snapshot » : on voit la base telle qu'au début de la transaction
      session.startTransaction({ readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      try {
        // Première écriture : le document de la transaction.
        // L'index unique sur idempotencyKey empêche qu'une même clé produise deux virements.
        s.transactions.insertOne({ _id: txId, idempotencyKey: idempotencyKey, type: "P2P",
          fromWalletId: fromWalletId, toWalletId: toWalletId, amount: montant, fee: NumberInt(0),
          status: "COMPLETED", channel: "APP", createdAt: maintenant, completedAt: maintenant,
          riskScore: NumberInt(0), flags: [] });
        if (typeof opts.onFirstWrite === "function") opts.onFirstWrite(s, txId);
        if (opts.failAfterFirstWrite === true) throw refus("CRASH_SIMULATED");

        // Débit : seulement si le wallet existe, est ACTIVE et a assez d'argent.
        // La condition et la soustraction se font en une seule opération : le solde ne peut jamais passer en négatif,
        // même si deux clients débitent le même wallet au même moment.
        var src = s.wallets.findOneAndUpdate(
          { _id: fromWalletId, status: "ACTIVE", balance: { $gte: montant } },
          { $inc: { balance: moins, version: NumberInt(1) }, $set: { updatedAt: maintenant } },
          { returnDocument: "after" });
        if (src === null) {
          // Rien n'a été débité : on regarde pourquoi, pour renvoyer la bonne erreur.
          var w = s.wallets.findOne({ _id: fromWalletId });
          throw refus((w && w.status === "ACTIVE") ? "INSUFFICIENT_FUNDS" : "WALLET_NOT_FOUND_OR_FROZEN");
        }

        // Crédit : le destinataire doit exister et être ACTIVE.
        var dst = s.wallets.findOneAndUpdate(
          { _id: toWalletId, status: "ACTIVE" },
          { $inc: { balance: montant, version: NumberInt(1) }, $set: { updatedAt: maintenant } },
          { returnDocument: "after" });
        if (dst === null) throw refus("WALLET_NOT_FOUND_OR_FROZEN");

        // Partie double : une ligne DEBIT et une ligne CREDIT, chacune avec le solde après l'opération.
        s.ledger_entries.insertMany([
          { _id: txId + "-D", txId: txId, walletId: fromWalletId, direction: "DEBIT", amount: montant, balanceAfter: src.balance, createdAt: maintenant },
          { _id: txId + "-C", txId: txId, walletId: toWalletId, direction: "CREDIT", amount: montant, balanceAfter: dst.balance, createdAt: maintenant }
        ]);

        // L'événement à publier (notification), écrit dans la même transaction que l'argent.
        s.outbox.insertOne({ _id: txId, type: "TRANSFER_COMPLETED", txId: txId, status: "PENDING", createdAt: maintenant });
      } catch (e) {
        // Quoi qu'il arrive, on annule : aucune écriture de cette tentative ne doit rester.
        try { session.abortTransaction(); } catch (e2) { }
        if (e.refusFasoPay) return { ok: false, error: e.refusFasoPay };
        if (e.code === 11000) {
          // Clé en double : un autre client vient de faire ce virement avec la même clé. C'est un rejeu.
          var d = base.transactions.findOne({ idempotencyKey: idempotencyKey });
          if (d) return { ok: true, replay: true, txId: d._id, status: d.status };
        }
        if (aLabel(e, "TransientTransactionError") && essai < MAX_ESSAIS) {
          // Conflit passager (par exemple deux clients sur le même wallet) : on attend un peu et on recommence.
          sleep(Math.floor(Math.random() * Math.min(25 * essai, 250)));
          continue;
        }
        throw e;
      }

      // -------------------------------------------------------------------------
      // 5. La validation (commit).
      //    Si MongoDB ne sait pas dire si elle a abouti, on la redemande : il ne l'appliquera pas deux fois.
      //    Si l'erreur est passagère, on rejoue toute la transaction.
      // -------------------------------------------------------------------------
      for (var c = 1; c <= MAX_ESSAIS; c++) {
        try {
          session.commitTransaction();
          return { ok: true, replay: false, txId: txId };
        } catch (e) {
          if (aLabel(e, "UnknownTransactionCommitResult") && c < MAX_ESSAIS) continue;
          if (aLabel(e, "TransientTransactionError")) break;
          throw e;
        }
      }
      sleep(Math.floor(Math.random() * Math.min(25 * essai, 250)));
    }
    throw new Error("transfer : abandon après " + MAX_ESSAIS + " essais (conflits répétés)");
  } finally {
    session.endSession();
  }
}
