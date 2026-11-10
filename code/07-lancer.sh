#!/bin/sh
# code/07-lancer.sh : preuves de la Partie 7, exécutées DANS le conteneur de test fasopay-securite (démarré avec --auth).
# Chaque bloc de preuve contient la commande exacte, la date (date -u) et la sortie brute.
#
#   docker exec fasopay-securite sh /tmp/code/07-lancer.sh securite   -> /tmp/preuves/07-securite.txt
#
# Le compte administrateur « admin-test » et son mot de passe sont des valeurs de TEST, fixées au démarrage du conteneur.

OUT=/tmp/preuves
mkdir -p "$OUT"
ADMIN="mongosh --quiet -u admin-test -p test-admin-2026 --authenticationDatabase admin"

bloc() {
  echo ""
  echo "=== $1 ==="
  echo "Commande : $2"
  echo "Date : $(date -u)"
  sh -c "$2"
}

case "$1" in
  securite)
    {
      bloc "Partie 7 : le serveur exige l'authentification (options de démarrage, lues par l'administrateur)" "$ADMIN --eval \"print(JSON.stringify(db.adminCommand({ getCmdLineOpts: 1 }).parsed.security))\""
      bloc "Partie 7 : création des rôles minimaux et des utilisateurs (par l'administrateur)" "$ADMIN --eval \"load('/tmp/code/07-securite.js'); preparer()\""
      bloc "Partie 7 : chaque utilisateur essaie ce qu'il doit pouvoir faire, et ce qu'il ne doit pas pouvoir faire" "$ADMIN --eval \"load('/tmp/code/07-securite.js'); tester()\""
    } > "$OUT/07-securite.txt" 2>&1
    cat "$OUT/07-securite.txt"
    ;;
  *)
    echo "usage : sh 07-lancer.sh securite"
    ;;
esac
