#!/bin/sh
# code/06-lancer.sh : commandes de la Partie 6 (cluster shardé), exécutées DANS le conteneur fasopay-mongos.
# Chaque bloc de preuve contient la commande exacte, la date (date -u) et la sortie brute.
#
# Utilisation (depuis PowerShell), après « docker cp code/. fasopay-mongos:/tmp/code/ » :
#   docker exec fasopay-mongos sh /tmp/code/06-lancer.sh cluster       -> /tmp/preuves/06-cluster.txt
#   docker exec fasopay-mongos sh /tmp/code/06-lancer.sh cle NOM       -> /tmp/preuves/06-cle-NOM.txt
#     NOM = date ({ createdAt: 1 }), wallet ({ fromWalletId: 1 }), hash ({ fromWalletId: "hashed" }),
#           composee ({ fromWalletId: 1, createdAt: 1 }), cible ({ walletCle: "hashed" }, après les quatre autres) ; le fichier /tmp/data/transactions.ndjson doit être copié avant
#   docker exec fasopay-mongos sh /tmp/code/06-lancer.sh orphelins     -> /tmp/preuves/06-orphelins.txt

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
  cluster)
    {
      bloc "Partie 6 : les shards déclarés (config.shards)" "mongosh --quiet --eval \"db.getSiblingDB('config').shards.find().forEach(printjson)\""
      bloc "Partie 6 : le mongos et son config server" "mongosh --quiet --eval \"var h = db.hello(); print('ce processus : ' + h.msg + ', version ' + db.version()); print('config server utilisé : ' + db.adminCommand({ getCmdLineOpts: 1 }).parsed.sharding.configDB)\""
      bloc "Partie 6 : sh.status()" "mongosh --quiet --eval \"sh.status()\""
    } > "$OUT/06-cluster.txt" 2>&1
    cat "$OUT/06-cluster.txt"
    ;;
  cle)
    J="load('/tmp/code/06-cles.js')"
    case "$2" in date) COLL=tx_date ;; wallet) COLL=tx_wallet ;; hash) COLL=tx_hash ;; composee) COLL=tx_comp ;; cible) COLL=tx_cible ;; *) echo "clé inconnue : $2"; exit 1 ;; esac
    {
      bloc "Partie 6, clé $2 : création de la collection et sharding AVANT l'import" "mongosh --quiet --eval \"$J; creer('$2')\""
      if [ "$2" = "cible" ]; then
        bloc "Partie 6, clé $2 : chargement des 60 000 transactions, avec le champ walletCle, à travers le mongos" "mongosh --quiet --eval \"$J; charger('$2')\""
      else
        bloc "Partie 6, clé $2 : import des 60 000 transactions à travers le mongos" "mongoimport --host localhost:27017 --db fasopay_shard --collection $COLL --file /tmp/data/transactions.ndjson"
      fi
      bloc "Partie 6, clé $2 : répartition après l'import" "mongosh --quiet --eval \"$J; repartition('$2', 'après import')\""
      if [ "$2" != "hash" ] && [ "$2" != "cible" ]; then
        bloc "Partie 6, clé $2 : correction d'une clé à plages (découpe et déplacement de chunks)" "mongosh --quiet --eval \"$J; corriger('$2')\""
        bloc "Partie 6, clé $2 : répartition après correction" "mongosh --quiet --eval \"$J; repartition('$2', 'après correction')\""
      fi
      bloc "Partie 6, clé $2 : le trafic de demain (3 000 transactions datées d'aujourd'hui)" "mongosh --quiet --eval \"$J; traficNouveau('$2')\""
      bloc "Partie 6, clé $2 : répartition finale" "mongosh --quiet --eval \"$J; repartition('$2', 'finale')\""
      bloc "Partie 6, clé $2 : requêtes ciblées ou dispersées (explain à travers le mongos)" "mongosh --quiet --eval \"$J; expliquer('$2')\""
    } > "$OUT/06-cle-$2.txt" 2>&1
    cat "$OUT/06-cle-$2.txt"
    ;;
  orphelins)
    {
      bloc "Partie 6 : délai avant suppression des orphelins et tâches de suppression en attente, sur chaque shard" \
        "for h in fasopay-shard1 fasopay-shard2 fasopay-shard3; do mongosh --host \$h --quiet --eval \"print('\$h : orphanCleanupDelaySecs = ' + db.adminCommand({ getParameter: 1, orphanCleanupDelaySecs: 1 }).orphanCleanupDelaySecs + ' s ; suppressions en attente : ' + db.getSiblingDB('config').rangeDeletions.countDocuments())\"; done"
      bloc "Partie 6 : documents possédés et orphelins par shard (\$shardedDataDistribution)" "mongosh --quiet --eval \"load('/tmp/code/06-cles.js'); orphelins()\""
    } > "$OUT/06-orphelins.txt" 2>&1
    cat "$OUT/06-orphelins.txt"
    ;;
  *)
    echo "usage : sh 06-lancer.sh cluster | cle date|wallet|hash|composee|cible | orphelins"
    ;;
esac
