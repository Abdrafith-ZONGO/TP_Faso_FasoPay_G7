// code/05-boucle.js : boucle d'écriture et analyse de la panne du primary (Partie 5)
//
// Ce fichier ne fait que définir des fonctions (voir 05-lancer.sh). Il est lancé depuis le conteneur client
// fasopay-client, branché sur reseau-fasopay, avec une connexion au Replica Set entier :
//   mongodb://fasopay-noeud1:27017,fasopay-noeud2:27017,fasopay-noeud3:27017/?replicaSet=rs-fasopay&serverSelectionTimeoutMS=2000
// Le pilote suit donc le primary : après une élection, il écrit sur le nouveau.
//
//   boucle("majority", 90)  : écrit pendant 90 s, une écriture toutes les 100 ms, avec w: "majority"
//                             et note chaque écriture : numéro ; heure de début ; ACK ou ECHEC ; durée en ms ; erreur
//   analyser("majority")    : lit ce journal et la base, puis calcule l'interruption, l'élection et les pertes

var ESSAIS = "fasopay_ha";      // base de travail de la Partie 5
var CHEMIN = "/tmp/preuves";

function boucle(mode, duree) {
  var wc = (mode === "w1") ? { w: 1, wtimeout: 3000 } : { w: "majority", wtimeout: 3000 };
  var col = db.getSiblingDB(ESSAIS).journal_ecritures;
  var fin = Date.now() + duree * 1000;
  print("# journal de la boucle : mode " + mode + ", writeConcern " + JSON.stringify(wc) + ", début " + new Date().toISOString());
  print("# numéro;heure de début;résultat;durée (ms);erreur");
  for (var n = 1; Date.now() < fin; n++) {
    var debut = new Date();
    try {
      col.insertOne({ _id: mode + "-" + n, n: n, mode: mode, t: debut }, { writeConcern: wc });
      print(n + ";" + debut.toISOString() + ";ACK;" + (Date.now() - debut.getTime()) + ";");
    } catch (e) {
      print(n + ";" + debut.toISOString() + ";ECHEC;" + (Date.now() - debut.getTime()) + ";" + (e.codeName || e.name) + " " + String(e.message).slice(0, 80));
    }
    sleep(100);
  }
  print("FIN " + new Date().toISOString());
}

function analyser(mode) {
  var fs = require("fs");
  var lignes = fs.readFileSync(CHEMIN + "/05-boucle-" + mode + ".log", "utf8").split("\n")
    .filter(function (l) { return /^[0-9]+;/.test(l); })
    .map(function (l) { var c = l.split(";"); var d = new Date(c[1]); return { n: +c[0], debut: d, fin: new Date(d.getTime() + (+c[3])), res: c[2], ms: +c[3], err: c[4] }; });
  var panne = new Date(fs.readFileSync(CHEMIN + "/panne-" + mode + ".txt", "utf8").trim());
  var acks = lignes.filter(function (x) { return x.res === "ACK"; });
  var echecs = lignes.filter(function (x) { return x.res === "ECHEC"; });

  print("écritures tentées : " + lignes.length + " ; acquittées (ACK) : " + acks.length + " ; échouées : " + echecs.length);
  print("heure de la panne (juste avant docker kill) : " + panne.toISOString());

  // La plus longue interruption : le plus grand écart entre deux acquittements successifs
  var max = 0, avant = null, apres = null;
  for (var i = 1; i < acks.length; i++) {
    var ecart = acks[i].fin - acks[i - 1].fin;
    if (ecart > max) { max = ecart; avant = acks[i - 1]; apres = acks[i]; }
  }
  print("plus longue interruption des écritures acquittées : " + (max / 1000).toFixed(2) + " s, entre l'écriture n° " + avant.n + " (acquittée à " + avant.fin.toISOString() + ") et la n° " + apres.n + " (acquittée à " + apres.fin.toISOString() + ")");
  var dernierAvant = acks.filter(function (x) { return x.fin <= panne; }).pop();
  var premierApres = acks.filter(function (x) { return x.debut >= panne; })[0];
  if (dernierAvant) print("dernière écriture acquittée avant la panne : n° " + dernierAvant.n + " à " + dernierAvant.fin.toISOString());
  if (premierApres) print("première écriture acquittée après la panne : n° " + premierApres.n + " à " + premierApres.fin.toISOString() + ", soit " + ((premierApres.fin - panne) / 1000).toFixed(2) + " s après la panne");

  // L'élection, vue par le nouveau primary
  var st = rs.status();
  var prim = st.members.filter(function (m) { return m.stateStr === "PRIMARY"; })[0];
  var hello = db.hello();
  print("primary actuel : " + hello.primary);
  var conn = new Mongo("mongodb://" + hello.primary + "/?directConnection=true");
  var m = conn.getDB("admin").runCommand({ replSetGetStatus: 1 }).electionCandidateMetrics;
  if (m) {
    print("élection du nouveau primary : raison " + m.lastElectionReason + ", date " + m.lastElectionDate.toISOString() + ", mandat " + m.electionTerm +
          ", soit " + ((m.lastElectionDate - panne) / 1000).toFixed(2) + " s après la panne ; écritures majoritaires possibles à " + m.wMajorityWriteAvailabilityDate.toISOString() +
          " (" + ((m.wMajorityWriteAvailabilityDate - panne) / 1000).toFixed(2) + " s après la panne)");
  }

  // Aucune écriture acquittée perdue ? Comptage en base contre le journal (lecture majoritaire)
  var col = db.getSiblingDB(ESSAIS).journal_ecritures;
  var enBase = {};
  col.find({ mode: mode }, { _id: 1 }).readConcern("majority").forEach(function (d) { enBase[d._id] = true; });
  var perdues = acks.filter(function (x) { return !enBase[mode + "-" + x.n]; });
  var echecsPresents = echecs.filter(function (x) { return enBase[mode + "-" + x.n]; });
  print("documents en base pour ce mode : " + Object.keys(enBase).length);
  print("écritures acquittées absentes de la base : " + perdues.length + (perdues.length ? " (n° " + perdues.map(function (x) { return x.n; }).join(", ") + ")" : ""));
  print("écritures signalées en échec mais présentes en base : " + echecsPresents.length + (echecsPresents.length ? " (n° " + echecsPresents.map(function (x) { return x.n; }).join(", ") + ")" : ""));

  // Chaque nœud a-t-il les mêmes documents ? (le nœud redémarré doit avoir rattrapé son retard)
  ["fasopay-noeud1:27017", "fasopay-noeud2:27017", "fasopay-noeud3:27017"].forEach(function (h) {
    try {
      var c = new Mongo("mongodb://" + h + "/?directConnection=true&readPreference=secondaryPreferred");
      var etat = c.getDB("admin").runCommand({ hello: 1 });
      print("  " + h + " (" + (etat.isWritablePrimary ? "PRIMARY" : (etat.secondary ? "SECONDARY" : "autre")) + ") : " + c.getDB(ESSAIS).journal_ecritures.countDocuments({ mode: mode }) + " documents");
    } catch (e) { print("  " + h + " : injoignable (" + e.message + ")"); }
  });
}

// ---------------------------------------------------------------------------
// Test w: 1 : analyse des écritures annulées (rollback) sur l'ancien primary
// ---------------------------------------------------------------------------
// Après son retour sur le réseau, l'ancien primary annule les écritures que les autres n'ont jamais reçues
// et les range dans des fichiers BSON, sous /data/db/rollback. 05-lancer.sh les convertit en JSON
// (bsondump, une ligne par document) dans /tmp/preuves/rollback-docs.json ; cette fonction les compare au journal.
function analyserRollback(mode) {
  var fs = require("fs");
  var lignes = fs.readFileSync(CHEMIN + "/05-boucle-" + mode + ".log", "utf8").split("\n").filter(function (l) { return /^[0-9]+;/.test(l); });
  var acks = lignes.filter(function (l) { return l.split(";")[2] === "ACK"; }).map(function (l) { return mode + "-" + l.split(";")[0]; });
  var col = db.getSiblingDB(ESSAIS).journal_ecritures;
  var enBase = {};
  col.find({ mode: mode }, { _id: 1 }).readConcern("majority").forEach(function (d) { enBase[d._id] = true; });
  var perdues = acks.filter(function (id) { return !enBase[id]; });
  var texte = fs.existsSync(CHEMIN + "/rollback-docs.json") ? fs.readFileSync(CHEMIN + "/rollback-docs.json", "utf8") : "";
  var annules = texte.split("\n").filter(function (l) { return l.trim().length > 0; }).map(function (l) { return JSON.parse(l)._id; });
  var dansRollback = {};
  annules.forEach(function (id) { dansRollback[id] = true; });
  print("écritures acquittées (w: 1) dans le journal : " + acks.length);
  print("écritures acquittées absentes de la base après le retour du nœud : " + perdues.length + (perdues.length ? " (" + perdues[0] + " à " + perdues[perdues.length - 1] + ")" : ""));
  print("documents trouvés dans les fichiers de rollback : " + annules.length);
  print("écritures perdues retrouvées dans les fichiers de rollback : " + perdues.filter(function (id) { return dansRollback[id]; }).length + " sur " + perdues.length);
  // Ce que CE nœud (l'ancien primary, joint en local) a noté dans son journal au moment du rollback (getLog)
  print("messages du serveur contenant « rollback » (les 12 derniers) :");
  new Mongo("mongodb://localhost:27017/?directConnection=true").getDB("admin").runCommand({ getLog: "global" }).log.filter(function (l) { return /rollback/i.test(l); }).slice(-12).forEach(function (l) {
    try { var j = JSON.parse(l); print("  " + j.t["$date"] + " | " + j.msg + " | " + JSON.stringify(j.attr || {}).slice(0, 160)); } catch (e) { print("  " + l.slice(0, 200)); }
  });
}
