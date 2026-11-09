// code/04-lost-update.js : ce qui arrive SANS transaction ni condition (démonstration du « lost update »)
//
// Ce fichier ne fait que définir des fonctions (voir 04-lancer.sh) :
//   preparer(), puis clientNaif("A") et clientNaif("B") lancés en même temps, puis verifier()
//
// La version naïve fait ce qu'on écrirait spontanément : lire le solde, vérifier qu'il suffit, réécrire le nouveau solde.
// Entre la lecture et l'écriture, l'autre client peut avoir lu le même ancien solde : un des deux débits est perdu.
// Même scénario que la concurrence : W_LU contient 3 000 FCFA, 50 débits de 100 FCFA (25 par client).

var garde = function () {
  if (db.getName() !== "fasopay_test") throw new Error("À lancer sur fasopay_test, pas sur " + db.getName());
};

function preparer() {
  garde();
  db.wallets.replaceOne({ _id: "W_LU" }, { _id: "W_LU", customerId: "C-W_LU", balance: NumberInt(3000), currency: "XOF", status: "ACTIVE",
    dailyLimit: NumberInt(200000), version: NumberInt(0), updatedAt: new Date() }, { upsert: true });
  var depart = new Date(Date.now() + 6000);
  db.banc.deleteMany({ _id: { $regex: "^naif" } });
  db.banc.insertOne({ _id: "naif-depart", at: depart });
  print("préparé : W_LU = 3000 ; départ commun à " + depart.toISOString());
}

function clientNaif(nom) {
  garde();
  var depart = db.banc.findOne({ _id: "naif-depart" }).at;
  while (new Date() < depart) sleep(5);
  var acceptes = 0, refuses = 0;
  for (var i = 1; i <= 25; i++) {
    var w = db.wallets.findOne({ _id: "W_LU" });                  // 1. lire le solde
    if (w.balance >= 100) {                                       // 2. vérifier qu'il suffit
      sleep(2);                                                   //    (le petit temps qu'un vrai serveur d'application passe à travailler)
      db.wallets.updateOne({ _id: "W_LU" }, { $set: { balance: NumberInt(w.balance - 100) } });   // 3. réécrire le solde calculé
      acceptes++;
    } else {
      refuses++;
    }
  }
  print("client naïf " + nom + " : débits acceptés=" + acceptes + ", refusés=" + refuses);
  db.banc.replaceOne({ _id: "naif-" + nom }, { _id: "naif-" + nom, acceptes: acceptes, refuses: refuses }, { upsert: true });
}

function verifier() {
  garde();
  var A = db.banc.findOne({ _id: "naif-A" }), B = db.banc.findOne({ _id: "naif-B" });
  var fin = db.wallets.findOne({ _id: "W_LU" }).balance;
  var acceptes = A.acceptes + B.acceptes;
  var debite = 3000 - fin;
  print("client A : " + JSON.stringify(A));
  print("client B : " + JSON.stringify(B));
  print("débits acceptés par les clients : " + acceptes + ", soit " + (acceptes * 100) + " FCFA promis");
  print("argent réellement retiré de W_LU : 3000 - " + fin + " = " + debite + " FCFA");
  print("écart : " + (acceptes * 100 - debite) + " FCFA de paiements acceptés sans débit correspondant (lost update)");
  print(acceptes * 100 === debite ? "Aucun débit perdu cette fois-ci (la course n'a pas eu lieu)." : "Des débits ont été perdus : la version naïve ne protège pas l'argent.");
}
