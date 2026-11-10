// code/07-securite.js : preuve des rôles minimaux (Partie 7, sécurité)
//
// Lancé dans le conteneur de test fasopay-securite, démarré AVEC authentification (--auth).
// Les mots de passe ci-dessous sont des valeurs de TEST, propres à ce conteneur jetable : en production,
// ils viendraient d'un coffre de secrets, jamais du code.
//
// Principe du moindre privilège : chaque programme n'a que les droits dont il a besoin.
//   - l'application (transfer) : lire et écrire les transactions, AJOUTER des lignes de ledger (jamais les modifier
//     ni les supprimer : règle « ajout seul » de la Partie 1), mettre à jour les soldes, ajouter dans l'outbox ;
//   - le relais de l'outbox : lire et marquer les événements de l'outbox, écrire les notifications ;
//   - le tableau de bord : lire le read model, rien d'autre.

var BASE = "fasopay_secu";
var MDP = { app: "test-app-2026", relais: "test-relais-2026", tableau: "test-tableau-2026" };
var bilan = { ok: 0, echec: 0 };
var verifier = function (libelle, condition) { if (condition) bilan.ok++; else bilan.echec++; print((condition ? "OK     " : "ÉCHEC  ") + libelle); };

function preparer() {
  var b = db.getSiblingDB(BASE);
  // On repart de zéro à chaque lancement : utilisateurs, rôles et données de la base de test
  b.dropAllUsers();
  b.dropAllRoles();
  b.dropDatabase();
  ["transactions", "ledger_entries", "wallets", "outbox", "notifications", "ca_marchands"].forEach(function (c) { b.createCollection(c); });
  b.wallets.insertOne({ _id: "W_SECU", balance: NumberInt(1000) });
  b.ledger_entries.insertOne({ _id: "L1", txId: "T1", walletId: "W_SECU", direction: "CREDIT", amount: NumberInt(1000), balanceAfter: NumberInt(1000) });
  b.ca_marchands.insertOne({ _id: "M00044", ca: NumberInt(41440550) });
  b.outbox.insertOne({ _id: "O1", type: "TRANSFER_COMPLETED", txId: "T1", status: "PENDING" });
  var p = function (coll, actions) { return { resource: { db: BASE, collection: coll }, actions: actions }; };
  b.createRole({ role: "fasopay_application", roles: [], privileges: [
    p("transactions", ["find", "insert", "update"]),
    p("ledger_entries", ["find", "insert"]),            // ajout seul : ni update, ni remove
    p("wallets", ["find", "update"]),
    p("outbox", ["insert"])
  ] });
  b.createRole({ role: "fasopay_relais", roles: [], privileges: [
    p("outbox", ["find", "update", "changeStream"]),
    p("notifications", ["find", "insert"])
  ] });
  b.createRole({ role: "fasopay_tableau", roles: [], privileges: [p("ca_marchands", ["find"])] });
  b.createUser({ user: "app_fasopay", pwd: MDP.app, roles: ["fasopay_application"] });
  b.createUser({ user: "relais_fasopay", pwd: MDP.relais, roles: ["fasopay_relais"] });
  b.createUser({ user: "tableau_fasopay", pwd: MDP.tableau, roles: ["fasopay_tableau"] });
  var roles = b.getRoles({ showPrivileges: true });
  roles = Array.isArray(roles) ? roles : roles.roles;   // selon la version de mongosh : tableau, ou { roles: [...] }
  print("rôles créés : " + JSON.stringify(roles.map(function (r) {
    return { role: r.role, droits: r.privileges.map(function (x) { return x.resource.collection + " : " + x.actions.sort().join(", "); }) };
  }), null, 1));
  var users = b.getUsers();
  users = Array.isArray(users) ? users : users.users;
  print("utilisateurs créés : " + JSON.stringify(users.map(function (u) { return u.user + " -> " + u.roles.map(function (r) { return r.role; }).join(", "); })));
}

// Essaie une opération : renvoie « autorisé » ou le nom de l'erreur (Unauthorized = code 13)
var essai = function (f) { try { f(); return "autorisé"; } catch (e) { return (e.codeName || e.name) + " (code " + e.code + ")"; } };
var connexion = function (user, mdp) { return new Mongo("mongodb://" + user + ":" + mdp + "@localhost:27017/" + BASE + "?authSource=" + BASE).getDB(BASE); };

function tester() {
  // Sans identifiants : aucune lecture possible
  var anonyme = new Mongo("mongodb://localhost:27017/" + BASE).getDB(BASE);
  var r = essai(function () { anonyme.transactions.findOne(); });
  print("sans authentification, lire transactions : " + r); verifier("une connexion sans identifiants ne lit rien", r !== "autorisé");

  var app = connexion("app_fasopay", MDP.app);
  print("");
  print("--- utilisateur app_fasopay (rôle fasopay_application) ---");
  var cas = [
    ["insérer une transaction", function () { app.transactions.insertOne({ _id: "T2", amount: NumberInt(100) }); }, true],
    ["ajouter une ligne de ledger", function () { app.ledger_entries.insertOne({ _id: "L2", txId: "T2", walletId: "W_SECU", direction: "DEBIT", amount: NumberInt(100), balanceAfter: NumberInt(900) }); }, true],
    ["mettre à jour un solde", function () { app.wallets.updateOne({ _id: "W_SECU" }, { $inc: { balance: NumberInt(-100) } }); }, true],
    ["ajouter un événement outbox", function () { app.outbox.insertOne({ _id: "O2", type: "TRANSFER_COMPLETED", txId: "T2", status: "PENDING" }); }, true],
    ["MODIFIER une ligne de ledger", function () { app.ledger_entries.updateOne({ _id: "L1" }, { $set: { amount: NumberInt(999999) } }); }, false],
    ["SUPPRIMER une ligne de ledger", function () { app.ledger_entries.deleteOne({ _id: "L1" }); }, false],
    ["supprimer la collection ledger_entries", function () { app.ledger_entries.drop(); }, false],
    ["supprimer un wallet", function () { app.wallets.deleteOne({ _id: "W_SECU" }); }, false],
    ["lire le read model du tableau de bord", function () { app.ca_marchands.findOne(); }, false]
  ];
  cas.forEach(function (c) { var res = essai(c[1]); print(c[0] + " : " + res); verifier("app_fasopay " + (c[2] ? "peut" : "ne peut pas") + " " + c[0], (res === "autorisé") === c[2]); });

  var relais = connexion("relais_fasopay", MDP.relais);
  print("");
  print("--- utilisateur relais_fasopay (rôle fasopay_relais) ---");
  [
    ["marquer un événement outbox comme envoyé", function () { relais.outbox.updateOne({ _id: "O1" }, { $set: { status: "SENT" } }); }, true],
    ["écrire une notification", function () { relais.notifications.insertOne({ _id: "N1", txId: "T1" }); }, true],
    ["modifier un solde", function () { relais.wallets.updateOne({ _id: "W_SECU" }, { $set: { balance: NumberInt(0) } }); }, false],
    ["lire le ledger", function () { relais.ledger_entries.findOne(); }, false]
  ].forEach(function (c) { var res = essai(c[1]); print(c[0] + " : " + res); verifier("relais_fasopay " + (c[2] ? "peut" : "ne peut pas") + " " + c[0], (res === "autorisé") === c[2]); });

  var tableau = connexion("tableau_fasopay", MDP.tableau);
  print("");
  print("--- utilisateur tableau_fasopay (rôle fasopay_tableau) ---");
  [
    ["lire le read model (ca_marchands)", function () { tableau.ca_marchands.findOne(); }, true],
    ["lire les transactions", function () { tableau.transactions.findOne(); }, false],
    ["écrire dans le read model", function () { tableau.ca_marchands.insertOne({ _id: "M99999", ca: NumberInt(1) }); }, false]
  ].forEach(function (c) { var res = essai(c[1]); print(c[0] + " : " + res); verifier("tableau_fasopay " + (c[2] ? "peut" : "ne peut pas") + " " + c[0], (res === "autorisé") === c[2]); });

  print("");
  var l1 = db.getSiblingDB(BASE).ledger_entries.findOne({ _id: "L1" });
  verifier("la ligne de ledger L1 est intacte après les tentatives (montant 1000)", l1 !== null && l1.amount === 1000);
  print("RÉSULTAT : " + bilan.ok + " vérifications OK, " + bilan.echec + " en échec");
}
