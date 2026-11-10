// code/B2-relais.js : bonus B2, relais Outbox par Change Stream (TP FasoPay, groupe 07)
//
// Le relais écoute les insertions dans outbox, « publie » chaque événement dans notifications,
// passe l'événement à SENT, puis sauvegarde le jeton de reprise (resume token).
// Il tourne sans fin : on l'arrête avec kill (voir B2-lancer.sh).
//
// Lancement : mongosh fasopay_b2 --quiet --file B2-relais.js
// Variable facultative : CRASH_APRES=N -> le relais s'arrête brutalement juste APRÈS avoir écrit la N-ième
// notification et AVANT de passer l'événement à SENT et de sauvegarder le jeton (la pire fenêtre possible).

if (db.getName() !== "fasopay_b2") throw new Error("Le relais doit tourner sur fasopay_b2, pas sur " + db.getName());

var ETAT = "relais-notifications";                 // _id du document qui garde le jeton dans relais_etat
var crashApres = parseInt(process.env.CRASH_APRES || "0", 10);
var heure = function () { return new Date().toISOString(); };

// 1. Filtre côté SERVEUR : seules les insertions d'événements PENDING sortent du serveur.
//    Les mises à jour (passage à SENT par le relais lui-même) ne reviennent donc pas au relais.
var filtre = [{ $match: { operationType: "insert", "fullDocument.status": "PENDING" } }];

// 2. Reprise : s'il existe un jeton sauvegardé, on repart juste après le dernier événement traité.
var etat = db.relais_etat.findOne({ _id: ETAT });
var options = etat ? { resumeAfter: etat.token } : {};
var flux = db.outbox.watch(filtre, options);
print(heure() + " relais démarré (pid " + process.pid + ") : " +
  (etat ? "reprise avec resumeAfter, après " + etat.traites + " événements traités" : "premier démarrage, aucun jeton"));

// 3. Au premier démarrage, on sauvegarde tout de suite un jeton : si le relais est tué avant son premier
//    événement, il reprendra quand même au bon endroit, au lieu de « maintenant » (ce qui perdrait des événements).
if (!etat) {
  flux.tryNext();
  db.relais_etat.insertOne({ _id: ETAT, token: flux.getResumeToken(), traites: 0, majA: new Date() });
}
print(heure() + " relais prêt");

var traitesIci = 0, rejeux = 0;
while (true) {
  var ev = flux.tryNext();                         // attend un événement (au plus environ 1 s), sinon null
  if (ev === null) continue;
  var o = ev.fullDocument;

  // a) « Publier » : la notification a le MÊME _id que l'événement outbox. Si elle existe déjà
  //    (événement relivré après un arrêt brutal), upsert + $setOnInsert ne change rien : pas de doublon.
  var r = db.notifications.updateOne(
    { _id: o._id },
    { $setOnInsert: { txId: o.txId, type: o.type, canal: "SMS", creeeA: new Date() } },
    { upsert: true });
  if (r.upsertedCount === 0) {
    rejeux++;
    print(heure() + " événement " + o._id + " déjà notifié : relivraison reconnue, aucune notification en double");
  }

  // Arrêt brutal volontaire (scénario 2) : la notification est écrite, mais ni SENT ni le jeton.
  if (crashApres > 0 && traitesIci + 1 === crashApres) {
    print(heure() + " ARRÊT BRUTAL SIMULÉ après la notification de " + o._id + ", avant SENT et avant le jeton");
    quit(9);
  }

  // b) L'événement passe à SENT (seulement s'il était encore PENDING).
  db.outbox.updateOne({ _id: o._id, status: "PENDING" }, { $set: { status: "SENT", sentAt: new Date() } });

  // c) Sauvegarde du jeton APRÈS le traitement : c'est ce qui donne « au moins une fois ».
  db.relais_etat.updateOne({ _id: ETAT }, { $set: { token: ev._id, majA: new Date() }, $inc: { traites: 1 } });

  traitesIci++;
  if (traitesIci % 100 === 0) print(heure() + " " + traitesIci + " événements traités depuis le démarrage (relivraisons reconnues : " + rejeux + ")");
}
