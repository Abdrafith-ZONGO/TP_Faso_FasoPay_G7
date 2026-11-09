#!/bin/sh
# code/04-lancer.sh : lance les tests de la Partie 4 DANS le conteneur et écrit les preuves brutes.
#
# Utilisation (depuis PowerShell) :
#   docker exec mongo-rs1 sh /tmp/code/04-lancer.sh tests        -> /tmp/preuves/04-transaction.txt
#   docker exec mongo-rs1 sh /tmp/code/04-lancer.sh concurrence  -> /tmp/preuves/04-concurrence.txt
#   docker exec mongo-rs1 sh /tmp/code/04-lancer.sh lostupdate   -> /tmp/preuves/04-lost-update.txt
#   docker exec mongo-rs1 sh /tmp/code/04-lancer.sh debit        -> /tmp/preuves/04-debit.txt
# Sur le Replica Set à 3 nœuds (Partie 5), depuis le client :
#   docker exec fasopay-client sh /tmp/code/04-lancer.sh tests rs3        -> /tmp/preuves/04-transaction-rs3.txt
#   docker exec fasopay-client sh /tmp/code/04-lancer.sh concurrence rs3  -> /tmp/preuves/04-concurrence-rs3.txt
# Chaque bloc de preuve contient la commande exacte, la date (date -u) et la sortie brute.

CODE=/tmp/code
OUT=/tmp/preuves
# Par défaut, base fasopay_test sur le serveur local (mongo-rs1, un nœud).
# Avec « rs3 » en second argument, la même base sur le Replica Set rs-fasopay à 3 nœuds (Partie 5),
# lancé depuis le conteneur fasopay-client ; les preuves portent alors le suffixe -rs3.
CIBLE="fasopay_test"; SUFFIXE=""
if [ "$2" = "rs3" ]; then
  CIBLE="\"mongodb://fasopay-noeud1:27017,fasopay-noeud2:27017,fasopay-noeud3:27017/fasopay_test?replicaSet=rs-fasopay\""
  SUFFIXE="-rs3"
fi
mkdir -p "$OUT"

bloc() {   # bloc "titre" "commande" : écrit l'en-tête, puis exécute la commande
  echo ""
  echo "=== $1 ==="
  echo "Commande : $2"
  echo "Date : $(date -u)"
  sh -c "$2"
}

case "$1" in
  tests)
    {
      if [ -n "$SUFFIXE" ]; then bloc "Partie 4 sur le Replica Set à 3 nœuds : état des membres pendant le test" "mongosh $CIBLE --quiet --eval \"rs.status().members.forEach(function (m) { print(m.name + ' : ' + m.stateStr) }); print('majorité d écriture : ' + rs.status().writeMajorityCount)\""; fi
      bloc "Partie 4 : préparation de la base de test fasopay_test" "mongosh $CIBLE --quiet --file $CODE/04-base-test.js"
      bloc "Partie 4 : tests de transfer() (chargement, succès, 3 rejeux, refus, abort prouvé, réponse perdue)" "mongosh $CIBLE --quiet --file $CODE/04-tests.js"
    } > "$OUT/04-transaction$SUFFIXE.txt" 2>&1
    cat "$OUT/04-transaction$SUFFIXE.txt"
    ;;
  concurrence)
    {
      if [ -n "$SUFFIXE" ]; then bloc "Partie 4 sur le Replica Set à 3 nœuds : état des membres pendant le test" "mongosh $CIBLE --quiet --eval \"rs.status().members.forEach(function (m) { print(m.name + ' : ' + m.stateStr) }); print('majorité d écriture : ' + rs.status().writeMajorityCount)\""; fi
      bloc "Partie 4 : préparation de la base de test fasopay_test" "mongosh $CIBLE --quiet --file $CODE/04-base-test.js"
      bloc "Partie 4 : préparation du test de concurrence" "mongosh $CIBLE --quiet --eval \"load('$CODE/04-concurrence.js'); preparer()\""
      bloc "Partie 4 : deux clients lancés en même temps (deux processus mongosh en parallèle)" \
        "mongosh $CIBLE --quiet --eval \"load('$CODE/04-concurrence.js'); client('A')\" > $OUT/client-A.log 2>&1 & mongosh $CIBLE --quiet --eval \"load('$CODE/04-concurrence.js'); client('B')\" > $OUT/client-B.log 2>&1 & wait"
      echo "--- sortie du client A ---"; cat "$OUT/client-A.log"
      echo "--- sortie du client B ---"; cat "$OUT/client-B.log"
      bloc "Partie 4 : vérification des invariants" "mongosh $CIBLE --quiet --eval \"load('$CODE/04-concurrence.js'); verifier()\""
    } > "$OUT/04-concurrence$SUFFIXE.txt" 2>&1
    cat "$OUT/04-concurrence$SUFFIXE.txt"
    ;;
  lostupdate)
    {
      bloc "Partie 4 : préparation de la démonstration du lost update" "mongosh $CIBLE --quiet --eval \"load('$CODE/04-lost-update.js'); preparer()\""
      bloc "Partie 4 : deux clients NAÏFS lancés en même temps (lire, vérifier, réécrire, sans transaction)" \
        "mongosh $CIBLE --quiet --eval \"load('$CODE/04-lost-update.js'); clientNaif('A')\" > $OUT/naif-A.log 2>&1 & mongosh $CIBLE --quiet --eval \"load('$CODE/04-lost-update.js'); clientNaif('B')\" > $OUT/naif-B.log 2>&1 & wait"
      echo "--- sortie du client naïf A ---"; cat "$OUT/naif-A.log"
      echo "--- sortie du client naïf B ---"; cat "$OUT/naif-B.log"
      bloc "Partie 4 : résultat de la version naïve" "mongosh $CIBLE --quiet --eval \"load('$CODE/04-lost-update.js'); verifier()\""
    } > "$OUT/04-lost-update$SUFFIXE.txt" 2>&1
    cat "$OUT/04-lost-update$SUFFIXE.txt"
    ;;
  debit)
    {
      bloc "Partie 4 : préparation de fasopay_bench (copie des 2 000 wallets de fasopay_tp, mêmes index)" "mongosh fasopay_bench --quiet --eval \"load('$CODE/04-debit.js'); preparer()\""
      bloc "Partie 4 : débit avec 1 client (1 000 virements à la suite)" "mongosh fasopay_bench --quiet --eval \"load('$CODE/04-debit.js'); client('S1', 1000); resultat('1 client')\""
      bloc "Partie 4 : nouveau départ commun" "mongosh fasopay_bench --quiet --eval \"load('$CODE/04-debit.js'); nouveauDepart()\""
      bloc "Partie 4 : débit avec 4 clients en parallèle (4 × 250 virements)" \
        "for c in P1 P2 P3 P4; do mongosh fasopay_bench --quiet --eval \"load('$CODE/04-debit.js'); client('\$c', 250)\" > $OUT/bench-\$c.log 2>&1 & done; wait"
      for c in P1 P2 P3 P4; do echo "--- client $c ---"; cat "$OUT/bench-$c.log"; done
      bloc "Partie 4 : résultat de la série à 4 clients" "mongosh fasopay_bench --quiet --eval \"load('$CODE/04-debit.js'); resultat('4 clients')\""
    } > "$OUT/04-debit.txt" 2>&1
    cat "$OUT/04-debit.txt"
    ;;
  *)
    echo "usage : sh 04-lancer.sh tests | concurrence | lostupdate | debit"
    ;;
esac
