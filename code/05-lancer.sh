#!/bin/sh
# code/05-lancer.sh : commandes de la Partie 5 (Replica Set rs-fasopay à 3 nœuds), exécutées DANS un conteneur
# du réseau reseau-fasopay. Chaque bloc de preuve contient la commande exacte, la date (date -u) et la sortie brute.
#
# Utilisation (depuis PowerShell), après « docker cp code/. <conteneur>:/tmp/code/ » :
#   docker exec fasopay-noeud1 sh /tmp/code/05-lancer.sh status        -> /tmp/preuves/05-rs-status.txt
# Test de panne, depuis le conteneur client fasopay-client (MODE = majority ou w1) :
#   docker exec -d fasopay-client sh /tmp/code/05-lancer.sh boucle MODE    (en arrière-plan, 90 s)
#   docker exec fasopay-client sh /tmp/code/05-lancer.sh primaire          (qui est primary maintenant ?)
#   docker exec fasopay-client sh /tmp/code/05-lancer.sh panne MODE        (note l'heure juste avant docker kill)
#   docker exec fasopay-client sh /tmp/code/05-lancer.sh attendre MODE     (attend la fin de la boucle)
#   docker exec fasopay-client sh /tmp/code/05-lancer.sh analyse MODE      -> /tmp/preuves/05-failover-MODE.txt
# MODE « majority-hb1 » : même test, mais le pilote surveille les nœuds toutes les secondes (heartbeatFrequencyMS=1000)
# Test w: 1, DANS le conteneur du primary (qui sera coupé du réseau), MODE = w1 :
#   docker exec -d <primary> sh /tmp/code/05-lancer.sh boucle-locale w1  (écrit sur le nœud local, 40 s)
#   docker exec <primary> sh /tmp/code/05-lancer.sh panne w1 ; docker network disconnect reseau-fasopay <primary>
#   docker exec <primary> sh /tmp/code/05-lancer.sh attendre w1 ; docker network connect reseau-fasopay <primary>
#   docker exec <primary> sh /tmp/code/05-lancer.sh analyse w1   -> /tmp/preuves/05-failover-w1.txt
#   docker exec <primary> sh /tmp/code/05-lancer.sh rollback w1  -> /tmp/preuves/05-rollback.txt

OUT=/tmp/preuves
URI="mongodb://fasopay-noeud1:27017,fasopay-noeud2:27017,fasopay-noeud3:27017/?replicaSet=rs-fasopay&serverSelectionTimeoutMS=2000"
# Pour le mode « majority-hb1 », le pilote vérifie l'état des nœuds toutes les secondes au lieu de 10 (valeur par défaut)
case "$2" in *hb1*) URI="$URI&heartbeatFrequencyMS=1000" ;; esac
mkdir -p "$OUT"

bloc() {   # bloc "titre" "commande" : écrit l'en-tête, puis exécute la commande
  echo ""
  echo "=== $1 ==="
  echo "Commande : $2"
  echo "Date : $(date -u)"
  sh -c "$2"
}

case "$1" in
  status)
    {
      bloc "Partie 5 : état du Replica Set rs-fasopay (résumé : un membre par ligne)" \
        "mongosh --quiet --host fasopay-noeud1 --eval \"rs.status().members.forEach(function (m) { print(m.name + ' : ' + m.stateStr + ', santé ' + m.health + ', optime ' + m.optimeDate.toISOString()) }); print('set : ' + rs.status().set + ', membres votants : ' + rs.status().votingMembersCount + ', majorité d écriture : ' + rs.status().writeMajorityCount)\""
      bloc "Partie 5 : rs.status() complet" "mongosh --quiet --host fasopay-noeud1 --eval \"rs.status()\""
    } > "$OUT/05-rs-status.txt" 2>&1
    cat "$OUT/05-rs-status.txt"
    ;;
  primaire)
    mongosh "$URI" --quiet --eval "print('primary actuel : ' + db.hello().primary + ' (' + new Date().toISOString() + ')')"
    ;;
  boucle)
    mongosh "$URI" --quiet --eval "load('/tmp/code/05-boucle.js'); boucle('$2', 90)" > "$OUT/05-boucle-$2.log" 2>&1
    ;;
  panne)
    date -u +%Y-%m-%dT%H:%M:%S.%3NZ > "$OUT/panne-$2.txt"
    echo "heure de la panne notée : $(cat "$OUT/panne-$2.txt")"
    ;;
  attendre)
    while ! grep -q "^FIN" "$OUT/05-boucle-$2.log" 2>/dev/null; do sleep 2; done
    echo "boucle $2 terminée : $(grep -c ';ACK;' "$OUT/05-boucle-$2.log") acquittées, $(grep -c ';ECHEC;' "$OUT/05-boucle-$2.log") échouées"
    ;;
  analyse)
    {
      echo "=== Partie 5 : test de panne du primary, mode $2 ==="
      if [ "$2" = "w1" ]; then
        echo "Déroulement : boucle d'écriture w: 1 lancée DANS le primary, sur le nœud local (docker exec -d <primary> sh /tmp/code/05-lancer.sh boucle-locale w1),"
        echo "puis heure notée (sh /tmp/code/05-lancer.sh panne w1) et coupure réseau du primary depuis Windows (docker network disconnect reseau-fasopay <primary>),"
        echo "puis retour du nœud sur le réseau (docker network connect reseau-fasopay <primary>) ; le journal brut de la boucle et l'analyse suivent."
      else
        echo "Déroulement : boucle d'écriture lancée en arrière-plan dans fasopay-client (docker exec -d fasopay-client sh /tmp/code/05-lancer.sh boucle $2),"
        echo "puis heure notée (sh /tmp/code/05-lancer.sh panne $2) et arrêt brutal du primary depuis Windows (docker kill <primary>),"
        echo "puis redémarrage du nœud tué (docker start <nœud>) ; le journal brut de la boucle et l'analyse suivent."
      fi
      bloc "Partie 5 : journal brut de la boucle d'écriture ($2)" "cat $OUT/05-boucle-$2.log"
      bloc "Partie 5 : analyse du journal et comptage en base ($2)" "mongosh \"$URI\" --quiet --eval \"load('/tmp/code/05-boucle.js'); analyser('$2')\""
      bloc "Partie 5 : état du Replica Set après le retour du nœud" "mongosh \"$URI\" --quiet --eval \"rs.status().members.forEach(function (m) { print(m.name + ' : ' + m.stateStr + ', santé ' + m.health + ', optime ' + m.optimeDate.toISOString()) })\""
    } > "$OUT/05-failover-$2.txt" 2>&1
    cat "$OUT/05-failover-$2.txt"
    ;;
  boucle-locale)
    # Connexion directe au nœud local : il reste joignable même coupé du réseau Docker
    mongosh "mongodb://localhost:27017/?directConnection=true&serverSelectionTimeoutMS=2000" --quiet --eval "load('/tmp/code/05-boucle.js'); boucle('$2', 40)" > "$OUT/05-boucle-$2.log" 2>&1
    ;;
  rollback)
    find /data/db/rollback -type f -name "*.bson" -exec bsondump --quiet {} \; > "$OUT/rollback-docs.json" 2>/dev/null
    {
      echo "=== Partie 5 : écritures annulées (rollback) sur l'ancien primary, mode $2 ==="
      bloc "Partie 5 : nœud courant et fichiers de rollback" "hostname; find /data/db/rollback -type f -exec ls -l {} \\;"
      bloc "Partie 5 : les 3 premiers documents annulés (bsondump)" "find /data/db/rollback -type f -name '*.bson' -exec bsondump --quiet {} \\; | head -3"
      bloc "Partie 5 : comparaison avec le journal de la boucle et messages du serveur" "mongosh \"$URI\" --quiet --eval \"load('/tmp/code/05-boucle.js'); analyserRollback('$2')\""
    } > "$OUT/05-rollback.txt" 2>&1
    cat "$OUT/05-rollback.txt"
    ;;
  *)
    echo "usage : sh 05-lancer.sh status | primaire | boucle MODE | boucle-locale MODE | panne MODE | attendre MODE | analyse MODE | rollback MODE"
    ;;
esac
