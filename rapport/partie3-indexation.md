# Partie 3 : Indexation (explain avant/après)

> Brouillon de la section 5 du rapport. Les chiffres viennent de `preuves/03-explain.txt` ; les commandes sont dans `code/03-index.js`.

Sans index, MongoDB doit lire toute une collection pour trouver quelques documents : sur 60 000 transactions, cela reste rapide, mais à 400 millions par an, chaque recherche deviendrait un parcours complet. Un index joue le rôle d'un sommaire trié : il mène directement aux bons documents. En contrepartie, chaque écriture doit aussi mettre le sommaire à jour, ce qui ralentit les virements. Nous avons donc choisi les trois recherches dont FasoPay a le plus besoin, mesuré leur coût avant et après index, et refusé un index qui coûtait plus qu'il ne rapportait.

## Choix des requêtes critiques
Les deux requêtes viennent de l'audit de la Partie 2 :
- **Q1 : sorties du jour d'un wallet** (cas W000758 du 30 janvier 2026, E2). E2 a montré que 5 wallets dépassent leur plafond journalier en cumulé alors qu'aucune transaction ne le dépasse seule : détecter ce cumul demande la somme des sorties `COMPLETED` d'un wallet sur la journée. C'est une requête de conformité, hors de `transfer.js` : le contrat de la Partie 4 n'autorise pas de refus pour plafond, donc le contrôle est séparé et alimente `fraud_alerts`.
- **Q2 : dernière ligne du ledger d'un wallet** (W000612, 390 lignes). C'est le rapprochement solde / ledger de E1 : on compare `wallets.balance` à `balanceAfter` de la dernière ligne.
- **Q3 : transaction par `idempotencyKey`**, pour l'index unique.

## Q1 : sorties du jour d'un wallet
**Avant (aucun index).** `PROJECTION_SIMPLE > COLLSCAN` : 60 000 documents lus pour 7 renvoyés, `executionTimeMillis` 43 (35 à la deuxième exécution).

**Index.** `{ fromWalletId: 1, status: 1, createdAt: 1, amount: 1 }`. Règle ESR : `fromWalletId` et `status` sont testés par égalité (E), il n'y a pas de tri (S), `createdAt` est testé par plage (R, une journée). `amount` est ajouté en dernier pour que l'index contienne tout ce que la requête lit : c'est un index couvrant.

**Après.** `PROJECTION_COVERED > IXSCAN`, bornes `["W000758", "W000758"]`, `["COMPLETED", "COMPLETED"]` et la journée du 30 janvier : `totalKeysExamined` 7 = `nReturned` 7, **`totalDocsExamined` 0**.

## Q2 : dernière ligne du ledger d'un wallet
**Avant.** `SORT > COLLSCAN` : 141 939 documents lus (tout le ledger) pour 1 renvoyé, 390 lignes du wallet triées en mémoire ; `executionTimeMillis` 79 (54 à la deuxième exécution).

**Index.** `{ walletId: 1, createdAt: -1 }`. ESR : `walletId` en égalité (E), `createdAt` décroissant pour le tri (S), pas de plage. L'ordre de l'index correspond au tri demandé, donc il n'y a plus d'étape de tri.

**Après.** `LIMIT > FETCH > IXSCAN` : `totalKeysExamined` 1, `totalDocsExamined` 1, `nReturned` 1. Le même index sert l'historique complet du wallet : `FETCH > IXSCAN`, 390 entrées lues pour 390 renvoyés, **sans étape `SORT`**.

## Q3 et index unique
**Avant.** `COLLSCAN`, 60 000 documents lus pour 1 renvoyé. **Index.** `{ idempotencyKey: 1 }` avec `unique: true`, prérequis de la Partie 4 ; la création a réussi parce que les 60 000 clés sont toutes distinctes (contrôle de E4). **Après.** `EXPRESS_IXSCAN` : 1 entrée lue, 1 document lu. `EXPRESS_IXSCAN` est le nom que MongoDB 8 donne à une recherche exacte directe dans un index : c'est un parcours d'index. **Preuve du refus :** l'insertion d'un document avec une clé existante échoue avec le code 11000 (`E11000 duplicate key`), la clé en double ne peut donc pas exister.

## Lecture des temps
Les temps sont mesurés sur 3 exécutions, médiane retenue (complément du 9 novembre, 18:46). Le « avant » est mesuré sans supprimer les index, en forçant une lecture complète avec `hint({ $natural: 1 })` : le plan obtenu est le même que celui de la session sans index (03:33), et `nReturned` est identique avant et après.

| Requête | Plan avant → après | Documents lus | Médiane avant | Médiane après |
|---|---|---|---|---|
| Q1 | `PROJECTION_SIMPLE > COLLSCAN` → `PROJECTION_COVERED > IXSCAN` | 60 000 → 0 (7 clés) | 19 ms (23, 19, 19) | 0 ms (3, 0, 0) |
| Q2 | `SORT > COLLSCAN` → `LIMIT > FETCH > IXSCAN` | 141 939 → 1 (1 clé) | 43 ms (50, 41, 43) | 0 ms (0, 0, 0) |
| Q3 | `COLLSCAN` → `EXPRESS_IXSCAN` | 60 000 → 1 (1 clé) | 18 ms (25, 18, 17) | 0 ms (1, 0, 0) |

La toute première exécution après la création d'un index (session de 03:33) était plus lente : 38 ms pour Q1 et 31 ms pour Q2. Elle inclut des coûts ponctuels (pour Q1, `optimizationTimeMillis` vaut 33 ms) ; les exécutions suivantes sont à 0 ms. Les médianes ci-dessus évitent ce biais. Le critère le plus robuste reste le nombre de documents lus. Ce que ces mesures ne prouvent pas : le comportement quand les données ne tiennent plus en mémoire (60 000 transactions tiennent dans le cache) ; c'est la Partie 0 qui traite la cible.

## Coût des index
Avant la Partie 3, seul l'index `_id_` existait. Mesuré : `transactions` passe de 2 514 944 à 5 054 464 octets d'index (+2 539 520, soit 16,7 % de la taille de ses données), `ledger_entries` de 5 316 608 à 7 475 200 (+2 158 592, 11,7 % de ses données). Par index : `idx_sorties_wallet_jour` 1 028 096 octets, `uniq_idempotency_key` 1 511 424, `idx_ledger_wallet_date` 2 158 592.

Coût en écriture : un virement écrit 1 transaction, 2 lignes de ledger et 1 outbox ; avec ces index, il ajoute **4 entrées d'index** (2 pour `transactions`, 2 pour `ledger_entries`) aux 4 entrées `_id` qu'il écrit déjà. Les mises à jour de `wallets` ne coûtent rien de plus : aucun index ne porte sur `balance`, `version` ni `updatedAt`.

## Un cas où l'index n'aide pas
La même recherche que Q1 sans `fromWalletId` (toutes les sorties `COMPLETED` du 30 janvier) ne peut pas utiliser `idx_sorties_wallet_jour` : un index composé se lit à partir de son premier champ (préfixe gauche). Mesuré : `COLLSCAN`, 60 000 documents lus pour 575 renvoyés, médiane 33 ms. Le rapport documents lus / documents renvoyés vaut 104, au-dessus de 100, le seuil à partir duquel nous considérons qu'un index manque (« Query Targeting », chapitre 12). Nous ne créons pas d'index pour cette requête : elle n'est pas un access pattern retenu (Partie 1).

## Index refusé, mesuré : `{ type: 1, status: 1, merchantId: 1, amount: 1 }`
Cet index couvrirait la requête de chiffre d'affaires de E3. Plutôt que de l'écarter sur le papier, nous l'avons créé le temps de la mesure, puis supprimé :

| | Plan de E3 | Lu | Médiane (3 exécutions) |
|---|---|---|---|
| Sans l'index | `GROUP > COLLSCAN` | 60 000 documents | 23 ms (30, 22, 23) |
| Avec l'index | `GROUP > PROJECTION_COVERED > IXSCAN` | 16 603 clés, 0 document | 9 ms (17, 9, 8) |

L'index **aide** : E3 devient environ 2,6 fois plus rapide, avec un gain de 14 ms. Nous le refusons quand même, pour trois raisons :
- **Le coût est payé à chaque écriture :** 610 304 octets sur le POC (4,0 % des données de `transactions`), soit environ 10 octets et une entrée d'index par transaction ; à la cible, 400 millions d'entrées en plus par an (environ 4 Go) et une entrée de plus à chacune des 1 200 transactions par seconde au pic.
- **Le gain est payé par un usage rare :** E3 est un rapport, lancé de temps en temps ; 14 ms gagnés sur un rapport ne justifient pas un coût sur chaque paiement.
- **Le bon outil est ailleurs :** à la cible, la lecture analytique sort de la collection qui reçoit les écritures, avec un read model alimenté par `$merge` et lu sur un secondaire (Partie 7). Un tel mart se lit en quelques millisecondes, là où le pipeline en direct relit toute la collection (chapitre 8).

Nous le réintroduirions si E3 devenait une lecture fréquente en direct (un tableau de bord interrogé en continu) sans read model possible. Après la mesure, `getIndexes()` ne liste plus que `_id_`, `idx_sorties_wallet_jour` et `uniq_idempotency_key`.

Un second index jugé inutile, non mesuré : `{ status: 1 }` seul. Avec 56 204 transactions `COMPLETED` sur 60 000 (93,7 %, E3), il ne sélectionnerait presque rien et coûterait une entrée par écriture.

**À retenir.** avec trois index, les recherches les plus fréquentes passent d'une lecture complète de la collection (60 000 ou 141 939 documents) à 0 ou 1 document lu. Nous n'avons pas indexé tout ce qui pouvait l'être : chaque index ralentit les virements, et nous n'avons gardé que ceux qui servent l'argent.
