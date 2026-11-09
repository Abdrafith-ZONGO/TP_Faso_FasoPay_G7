#!/bin/sh
# code/04-lancer.sh : lance les tests de la Partie 4 DANS le conteneur et écrit les preuves brutes.
#
# Utilisation (depuis PowerShell) :
#   docker exec mongo-rs1 sh /tmp/code/04-lancer.sh tests        -> /tmp/preuves/04-transaction.txt
#   docker exec mongo-rs1 sh /tmp/code/04-lancer.sh concurrence  -> /tmp/preuves/04-concurrence.txt
#   docker exec mongo-rs1 sh /tmp/code/04-lancer.sh lostupdate   -> /tmp/preuves/04-lost-update.txt
#   docker exec mongo-rs1 sh /tmp/code/04-lancer.sh debit        -> /tmp/preuves/04-debit.txt
# Chaque bloc de preuve contient la commande exacte, la date (date -u) et la sortie brute.

CODE=/tmp/code
OUT=/tmp/preuves
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
      bloc "Partie 4 : préparation de la base de test fasopay_test" "mongosh fasopay_test --quiet --file $CODE/04-base-test.js"
      bloc "Partie 4 : tests de transfer() (chargement, succès, 3 rejeux, refus, abort prouvé, réponse perdue)" "mongosh fasopay_test --quiet --file $CODE/04-tests.js"
    } > "$OUT/04-transaction.txt" 2>&1
    cat "$OUT/04-transaction.txt"
    ;;
  concurrence)
    {
      bloc "Partie 4 : préparation de la base de test fasopay_test" "mongosh fasopay_test --quiet --file $CODE/04-base-test.js"
      bloc "Partie 4 : préparation du test de concurrence" "mongosh fasopay_test --quiet --eval \"load('$CODE/04-concurrence.js'); preparer()\""
      bloc "Partie 4 : deux clients lancés en même temps (deux processus mongosh en parallèle)" \
        "mongosh fasopay_test --quiet --eval \"load('$CODE/04-concurrence.js'); client('A')\" > $OUT/client-A.log 2>&1 & mongosh fasopay_test --quiet --eval \"load('$CODE/04-concurrence.js'); client('B')\" > $OUT/client-B.log 2>&1 & wait"
      echo "--- sortie du client A ---"; cat "$OUT/client-A.log"
      echo "--- sortie du client B ---"; cat "$OUT/client-B.log"
      bloc "Partie 4 : vérification des invariants" "mongosh fasopay_test --quiet --eval \"load('$CODE/04-concurrence.js'); verifier()\""
    } > "$OUT/04-concurrence.txt" 2>&1
    cat "$OUT/04-concurrence.txt"
    ;;
  lostupdate)
    {
      bloc "Partie 4 : préparation de la démonstration du lost update" "mongosh fasopay_test --quiet --eval \"load('$CODE/04-lost-update.js'); preparer()\""
      bloc "Partie 4 : deux clients NAÏFS lancés en même temps (lire, vérifier, réécrire, sans transaction)" \
        "mongosh fasopay_test --quiet --eval \"load('$CODE/04-lost-update.js'); clientNaif('A')\" > $OUT/naif-A.log 2>&1 & mongosh fasopay_test --quiet --eval \"load('$CODE/04-lost-update.js'); clientNaif('B')\" > $OUT/naif-B.log 2>&1 & wait"
      echo "--- sortie du client naïf A ---"; cat "$OUT/naif-A.log"
      echo "--- sortie du client naïf B ---"; cat "$OUT/naif-B.log"
      bloc "Partie 4 : résultat de la version naïve" "mongosh fasopay_test --quiet --eval \"load('$CODE/04-lost-update.js'); verifier()\""
    } > "$OUT/04-lost-update.txt" 2>&1
    cat "$OUT/04-lost-update.txt"
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
