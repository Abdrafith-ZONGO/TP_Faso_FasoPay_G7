# Partie 6 · Sharding : choisir la clé sur un vrai cluster

> Brouillon de la section 8 du rapport. Montage : journal, section 19 ; code : `code/06-lancer.sh`, `code/06-cles.js` ; preuves : `preuves/06-cluster.txt`, `preuves/06-cle-*.txt`, `preuves/06-orphelins*.txt`.

## 6.1 Le cluster
Nous avons monté un cluster shardé complet, pièce par pièce : un config server (`rs-cfg`, Replica Set `--configsvr`), trois shards (`rs-shard1` à `rs-shard3`, chacun un Replica Set `--shardsvr` d'un nœud) et un routeur `mongos` relié au config server ; les shards sont déclarés par `sh.addShard`. `config.shards` liste les trois shards, et `sh.status()` montre un mongos actif et le balancer activé (`preuves/06-cluster.txt`). Toutes les pièces tournent sur la même machine : le banc mesure la répartition et le routage, pas la performance d'un vrai cluster.

## 6.2 Méthode
Pour chaque clé candidate, une collection de la base `fasopay_shard` est shardée **avant** l'import, puis les 60 000 transactions sont importées **à travers le mongos** (`mongoimport`). Nous mesurons ensuite la répartition par shard et les chunks ; pour une clé à plages, nous corrigeons le déséquilibre ; nous insérons 3 000 transactions datées du jour, copiées d'un échantillon réel (même mélange de types) pour voir où tombe le trafic de demain ; enfin nous lisons les `explain()` des requêtes de l'énoncé, à travers le mongos.

| Nom | Clé | Type |
|---|---|---|
| `date` | `{ createdAt: 1 }` | plages, monotone |
| `wallet` | `{ fromWalletId: 1 }` | plages |
| `hash` | `{ fromWalletId: "hashed" }` | hachée |
| `composee` | `{ fromWalletId: 1, createdAt: 1 }` | plages, composée |
| `cible` | `{ walletCle: "hashed" }` | hachée, clé que nous recommandons (section 6.7) |

## 6.3 Répartition des documents et chunks

| Clé | Après l'import | Correction | Après correction (documents possédés) |
|---|---|---|---|
| `date` | 100 % sur `rs-shard2`, 1 chunk | 2 `sh.splitAt` + 2 `sh.moveChunk` | 20 000 / 20 000 / 20 000 (puis 23 000 sur un shard avec le trafic du jour) |
| `wallet` | 100 % sur `rs-shard2`, 1 chunk | idem | 19 957 / 19 996 / 20 047 |
| `composee` | 100 % sur `rs-shard2`, 1 chunk | idem | 20 000 / 20 000 / 20 000 |
| `hash` | 47,4 % / 25,2 % / 27,4 % | aucune | sans objet |
| `cible` | 32,2 % / 32,6 % / 35,2 % | aucune | sans objet |

**Pourquoi tout tombe sur un seul shard avec une clé à plages.** Une collection shardée vide commence avec un seul chunk, sur un shard. Nos 60 000 transactions pèsent environ 15 Mo, alors qu'un chunk peut atteindre 128 Mo par défaut (aucune taille n'est configurée : `config.settings` ne contient pas de `chunksize`) : le chunk n'a aucune raison d'être découpé, et le balancer, qui équilibre la quantité de données, ne voit pas de déséquilibre suffisant à déplacer. Nous avons corrigé par les commandes d'administration : deux découpes (`sh.splitAt`) au tiers et aux deux tiers des documents triés par la clé, puis deux déplacements (`sh.moveChunk`) vers les deux autres shards. Une alternative aurait été de réduire la taille de chunk (`config.settings`, `chunksize`) et de laisser le balancer répartir, mais plus lentement et de façon moins prévisible pour un banc.

**Un piège de mesure.** Juste après la correction, nos comptages affichaient 100 000 documents au lieu de 60 000 (par exemple 20 000, 60 000 et 20 000 pour la clé `date`). Après un `sh.moveChunk`, le shard de départ garde une copie des documents déplacés (des orphelins), supprimée en arrière-plan après `orphanCleanupDelaySecs` (900 s ici), pour ne pas casser une lecture encore en cours. `$collStats` compte ces copies ; `$shardedDataDistribution` les sépare : 40 000 orphelins sur `rs-shard2` pour chaque clé à plages, avec 6 suppressions en attente (`preuves/06-orphelins.txt`), puis 0 orphelin après le délai (`preuves/06-orphelins-apres.txt`). Les requêtes n'étaient pas faussées : l'étape `SHARDING_FILTER` de chaque shard écarte les orphelins (`chunkSkips` dans les `explain()`), mais leurs nombres de documents examinés sur `rs-shard2` les incluent.

**Pourquoi la clé `hash` est déséquilibrée.** Les 13 505 dépôts (`CASH_IN`, 22,5 % des transactions) n'ont pas de `fromWalletId` : ils ont tous la même valeur de clé, donc le même hachage, et tombent dans le même chunk. Le shard qui le porte a 47,4 % des documents au lieu d'environ 33 %. Les clés `wallet` et `composee` les regroupent de même, en début de plage.

## 6.4 Le trafic de demain (3 000 transactions datées du jour)

| Clé | `rs-shard1` | `rs-shard2` | `rs-shard3` |
|---|---|---|---|
| `date` | 0 % | 0 % | **100 %** |
| `wallet` | 33,1 % | 33,4 % | 33,5 % |
| `hash` | **48,0 %** | 25,4 % | 26,6 % |
| `composee` | 33,1 % | 33,7 % | 33,2 % |
| `cible` | 31,6 % | 34,3 % | 34,1 % |

**Le hotspot de la clé `date` est démontré** : une clé monotone envoie toutes les écritures nouvelles dans le dernier chunk, celui qui couvre « jusqu'à l'infini ». Au pic de 1 200 tx/s, un seul shard recevrait toutes les écritures : le sharding ne servirait à rien pour ce qui le justifie.

La clé `wallet` répartit bien le trafic aujourd'hui, mais par chance : nos points de découpe tombent au tiers des données. Deux faiblesses restent. Les nouveaux wallets reçoivent des identifiants croissants (`W002001`, ...) et iront tous dans le dernier chunk ; et les dépôts, tous sur la même valeur de clé, forment un chunk **qu'on ne peut pas découper** (un chunk se découpe entre deux valeurs de clé différentes). À la cible, 22,5 % de 400 millions de transactions, soit environ 90 millions de dépôts par an, s'accumuleraient dans ce chunk. La clé `hash` a le même défaut (48 % du trafic sur un shard), et la clé `composee` le déplace seulement : les dépôts deviennent découpables grâce à la date, mais arrivent toujours au même endroit, en fin de plage.

## 6.5 Requêtes ciblées ou dispersées
Nombre de shards interrogés, lu dans `explain()` à travers le mongos (`SINGLE_SHARD` = un shard ; `SHARD_MERGE` ou `SHARD_MERGE_SORT` = tous, avec fusion par le mongos) :

| Requête | `date` | `wallet` | `hash` | `composee` | `cible` |
|---|---|---|---|---|---|
| Historique d'un wallet (`fromWalletId`) | 3 | **1** | **1** | **1** | 3 |
| Historique d'un wallet par la clé (`walletCle`) | | | | | **1** |
| Historique complet (`$or` émetteur / destinataire) | 3 | 3 | 3 | 3 | 3 |
| Une transaction par `_id` | 3 | 3 | 3 | 3 | 3 |
| Paiements d'un marchand sur un mois | **1** | 3 | 3 | 3 | 3 |
| Transactions d'un jour | **1** | 3 | 3 | 3 | 3 |
| Tous les paiements de M00044 | 3 | 3 | 3 | 3 | 3 |
| CA par marchand (agrégation) | 3 | 3 | 3 | 3 | 3 |

Une requête n'est ciblée que si elle contient la clé de sharding : la clé `date` cible les requêtes par période, les clés par wallet ciblent l'historique d'un wallet. Avec la clé `cible`, l'historique par `fromWalletId` redevient dispersé : l'application doit interroger par `walletCle` (409 documents examinés pour 409 rendus, sur un seul shard). La recherche par `_id` est dispersée avec toutes les clés, mais chaque shard n'examine que 0 ou 1 document grâce à l'index `_id` : le coût est un aller-retour de plus par shard, pas un parcours.

**Le CA par marchand.** L'agrégation est découpée en deux : chaque shard exécute `$match` puis un `$group` partiel sur ses propres documents (150 marchands au plus par shard) ; le mongos fusionne les résultats partiels (`$mergeCursors`), additionne les sommes de chaque marchand (`$group` final) et trie (`$sort`) ; `mergeType` vaut `mongos`. Chaque shard ne renvoie donc qu'environ 150 lignes, et non ses milliers de paiements.

## 6.6 Le marchand qui fait 25 % du volume (M00044)
Avec une clé par wallet, les paiements de M00044 partent de wallets différents : ils se répartissent sur les trois shards (1 487, 1 522 et 1 673 avec la clé `cible`, soit 31,8 %, 32,5 % et 35,7 %). Il n'y a pas de hotspot en écriture ; en revanche, lire tous ses paiements interroge les trois shards. Cette lecture relève du règlement et du chiffre d'affaires, que nous servirons par un read model (Partie 7), pas par la collection des transactions. À l'inverse, une clé sur `merchantId` concentrerait 25 % des paiements sur une seule valeur de clé : un chunk impossible à découper et un shard qui recevrait un quart des écritures. Nous l'écartons.

## 6.7 Recommandation
**1. Pas de sharding à 18 mois.** La Partie 0 montre qu'un seul Replica Set tient la cible (working set de 25,9 Go pour un nœud de 64 Go, 0,31 To par an). Nous déclencherons le sharding au premier des seuils suivants : entre **490 et 600 millions de transactions par an** sur des nœuds de 64 Go (working set au-delà de 50 à 60 % de la RAM) ; **1 à 2 To** de données par Replica Set (atteint en 3,2 à 6,5 ans à volume constant) ; ou des écritures au-delà de **50 % de la capacité du primary**, mesurée sur le matériel cible (Partie 0, section 2 ter).

**2. Quand ce seuil sera atteint, la clé sera `{ walletCle: "hashed" }`**, avec `walletCle` = `fromWalletId`, ou `toWalletId` quand il n'y a pas d'émetteur. Mesuré : 0 document sans valeur de clé, une répartition de 32 à 35 % par shard sans aucune correction, un trafic du jour réparti de la même façon, et l'historique d'un wallet ciblé sur un seul shard. Elle garde les qualités de la clé `hash` sans son défaut (47 % sur un shard), et évite le hotspot de la clé `date` (100 %).

**3. Ce que nous faisons dès maintenant.** Ajouter le champ `walletCle` à chaque transaction écrite (`transfer()` et les autres flux), pour que le sharding, le jour venu, ne demande pas de réécrire 400 millions de documents. Deux conséquences sont à préparer :
- **L'index unique d'idempotence.** Sur une collection shardée, un index unique doit commencer par la clé de sharding : `{ idempotencyKey: 1 }` seul ne serait plus possible, il deviendrait `{ walletCle: 1, idempotencyKey: 1 }`. L'unicité de la clé d'idempotence serait alors garantie par wallet émetteur, ce qui convient puisque c'est l'émetteur qui génère sa clé.
- **Les lectures dispersées** (par `_id`, par marchand, par jour) restent possibles mais interrogent tous les shards : les lectures fréquentes de ce type passeront par un read model (Partie 7).

**Ce que nos mesures ne montrent pas.** Trois shards d'un nœud sur une même machine et 60 000 transactions : le banc démontre la répartition et le routage, pas le débit. Avec 2 000 wallets, quelques wallets très actifs pèsent encore sur la répartition (35,2 % sur un shard) ; avec 3 millions de wallets, le hachage la lissera davantage. Enfin, la clé `cible` répartit un wallet actif sur un seul shard : un wallet très actif (un agent qui fait des milliers d'opérations par jour) resterait sur un shard, ce que nous surveillerons.
