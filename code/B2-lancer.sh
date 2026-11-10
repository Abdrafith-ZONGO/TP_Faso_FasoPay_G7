#!/bin/sh
# code/B2-lancer.sh : bonus B2, relais Outbox par Change Stream, exécuté DANS le conteneur mongo-rs1.
# Chaque bloc de preuve contient la commande exacte, la date (date -u) et la sortie brute.
#
#   docker exec mongo-rs1 sh /tmp/code/B2-lancer.sh relais   -> /tmp/preuves/B2-relais-outbox.txt
#
# Scénario 1 : le relais est tué par kill -9 au milieu d'une rafale de 1 000 virements, puis relancé (resumeAfter).
# Scénario 2 : le relais s'arrête juste après une notification, avant SENT et avant le jeton (pire moment).

CODE=/tmp/code
OUT=/tmp/preuves
TMP=/tmp/b2
B2="mongosh fasopay_b2 --quiet"
OUTILS="load('$CODE/transfer.js'); load('$CODE/B2-outils.js');"
mkdir -p "$OUT" "$TMP"

bloc() {
  echo ""
  echo "=== $1 ==="
  echo "Commande : $2"
  echo "Date : $(date -u)"
  sh -c "$2"
}

attendre_vide() {   # attend que plus aucun événement ne soit PENDING (au plus 60 s)
  i=0
  while [ $i -lt 60 ]; do
    n=$($B2 --eval "load('$CODE/B2-outils.js'); print(db.outbox.countDocuments({ status: 'PENDING' }))")
    [ "$n" = "0" ] && return 0
    sleep 1; i=$((i + 1))
  done
  echo "délai dépassé : $n événements encore PENDING"
}

case "$1" in
  relais)
    {
      bloc "Bonus B2 : préparation de la base fasopay_b2" "$B2 --eval \"$OUTILS preparer()\""

      echo ""
      echo "=== Bonus B2, scénario 1 : kill -9 du relais au milieu d'une rafale de 1 000 virements ==="
      echo "Date : $(date -u)"
      echo "Commande : $B2 --file $CODE/B2-relais.js > $TMP/relais-1.log &   (relais n° 1, en arrière-plan)"
      $B2 --file $CODE/B2-relais.js > $TMP/relais-1.log 2>&1 &
      echo $! > $TMP/relais.pid
      sleep 4
      echo "Commande : $B2 --eval \"$OUTILS rafale('A', 1000)\" &   (rafale en arrière-plan)"
      $B2 --eval "$OUTILS rafale('A', 1000)" > $TMP/rafale-A.log 2>&1 &
      RAFALE=$!
      sleep 3
      $B2 --eval "load('$CODE/B2-outils.js'); photo('juste avant kill -9')"
      echo "Commande : kill -9 $(cat $TMP/relais.pid)   (pid du relais n° 1)"
      echo "Date du kill -9 : $(date -u)"
      kill -9 $(cat $TMP/relais.pid)
      sleep 3
      $B2 --eval "load('$CODE/B2-outils.js'); photo('relais mort depuis 3 s, la rafale continue')"
      echo "Commande : $B2 --file $CODE/B2-relais.js > $TMP/relais-2.log &   (relais n° 2 : reprise avec resumeAfter)"
      $B2 --file $CODE/B2-relais.js > $TMP/relais-2.log 2>&1 &
      echo $! > $TMP/relais.pid
      wait $RAFALE
      echo "--- sortie de la rafale ---"; cat $TMP/rafale-A.log
      attendre_vide
      kill $(cat $TMP/relais.pid)
      echo "--- journal du relais n° 1 (tué par kill -9) ---"; cat $TMP/relais-1.log
      echo "--- journal du relais n° 2 (reprise) ---"; cat $TMP/relais-2.log

      bloc "Bonus B2, scénario 1 : vérifications" "$B2 --eval \"$OUTILS verifier()\""

      echo ""
      echo "=== Bonus B2, scénario 2 : arrêt brutal juste après la 5e notification, avant SENT et avant le jeton ==="
      echo "Date : $(date -u)"
      echo "Commande : CRASH_APRES=5 $B2 --file $CODE/B2-relais.js > $TMP/relais-3.log &   (relais n° 3)"
      CRASH_APRES=5 $B2 --file $CODE/B2-relais.js > $TMP/relais-3.log 2>&1 &
      R3=$!
      sleep 4
      echo "Commande : $B2 --eval \"$OUTILS rafale('B', 20)\""
      $B2 --eval "$OUTILS rafale('B', 20)"
      wait $R3
      echo "code de sortie du relais n° 3 : $?"
      $B2 --eval "load('$CODE/B2-outils.js'); photo('après l arrêt brutal du relais n° 3')"
      echo "Commande : $B2 --file $CODE/B2-relais.js > $TMP/relais-4.log &   (relais n° 4 : reprise avec resumeAfter)"
      $B2 --file $CODE/B2-relais.js > $TMP/relais-4.log 2>&1 &
      echo $! > $TMP/relais.pid
      attendre_vide
      kill $(cat $TMP/relais.pid)
      echo "--- journal du relais n° 3 (arrêt brutal simulé) ---"; cat $TMP/relais-3.log
      echo "--- journal du relais n° 4 (reprise) ---"; cat $TMP/relais-4.log

      bloc "Bonus B2, scénario 2 : vérifications (sur les 1 020 virements des deux scénarios)" "$B2 --eval \"$OUTILS verifier()\""
    } > "$OUT/B2-relais-outbox.txt" 2>&1
    cat "$OUT/B2-relais-outbox.txt"
    ;;
  *)
    echo "usage : sh B2-lancer.sh relais"
    ;;
esac
