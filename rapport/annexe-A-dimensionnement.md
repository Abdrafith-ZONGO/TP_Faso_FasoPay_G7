# Feuille de dimensionnement : FasoPay (Annexe A du rapport)

Groupe : 07 · empreinte (`datasetSha256`, début) : 9b0b9a40

Unités : 1 Mo = 1 000 000 octets, 1 Go = 1 000 000 000 octets. Mesures : `preuves/00-dimensionnement.txt` (commandes dans `code/00-dimensionnement.js`).

## Cible à 18 mois (donnée du sujet)
3 000 000 wallets · 400 000 000 transactions/an · pic 1 200 tx/s · disponibilité 99,95 % · RPO 0

## 1. Mesures sur notre jeu (POC)
| Collection | Documents | Taille BSON moyenne (octets) | Données (Mo) | Index (Mo) |
|---|---|---|---|---|
| transactions | 60 000 | 253,02 | 15,18 | 5,05 |
| ledger_entries | 141 939 | 130,19 | 18,48 | 7,48 |
| wallets | 2 000 | 144 | 0,29 | 0,11 |

Les tailles moyennes viennent de `$bsonSize` sur toute la collection ; un échantillon aléatoire de 1 000 documents donne 252,44 (transactions) et 130,30 (ledger). « Données » est la taille BSON non compressée (`size`) ; sur disque, la compression ramène les transactions à 7,98 Mo et le ledger à 9,27 Mo (`storageSize`). Les index sont ceux de la Partie 3 (3 sur `transactions`, 2 sur `ledger_entries`).

Lignes de ledger par transaction (mesuré) : 2,36565 (141 939 / 60 000), dont 1,19808 jambes de wallet (71 885 / 60 000).

Documents écrits par transaction métier (mesuré sur les 56 484 transactions qui ont un ledger) : 1 transaction + 2,513 lignes de ledger + 1,273 soldes de wallet + 1 outbox = 5,79 en moyenne. Par type : P2P 6,03, CASH_IN 5, CASH_OUT 6, BILL 6,02, MERCHANT_PAY 6,03.

## 2. Extrapolation
| Grandeur | Calcul (formule + nombres) | Résultat |
|---|---|---|
| Volume brut/an (données) | 400 M × (253,02 + 2,36565 × 130,19) = 400 M × 561,02 octets | 224,4 Go |
| Facteur d'index retenu (et pourquoi) | (33 661 042 + 12 529 664) / 33 661 042 : données puis index de `transactions` et `ledger_entries`, mesurés après les index de la Partie 3. Ces deux collections portent 98 % des données. | ×1,37 |
| Volume/an avec index | 224,4 Go × 1,3723 | 307,9 Go |
| Écritures/s au pic | 1 200 × 6 documents (1 transaction + 2 lignes de ledger + 2 soldes + 1 outbox, ADR-001) ; en plus 8 entrées d'index par virement (3 sur `transactions`, 4 sur `ledger_entries`, 1 sur `outbox`) | 7 200 documents/s et 9 600 entrées d'index/s |
| Working set (30 jours chauds + index chauds) | 400 M × 30 / 365 = 32,88 M transactions × 561,02 o = 18,44 Go ; index chauds 18,44 × 0,3723 = 6,87 Go ; 3 M wallets × 144 o = 0,43 Go ; index des wallets 3 M × 55,3 o = 0,17 Go | 25,9 Go |
| RAM par nœud (cache WiredTiger ≈ 50 % de (RAM − 1 Go)) | 50 % × (RAM − 1) ≥ 25,9 donc RAM ≥ 2 × 25,9 + 1 = 52,8 Go : nœud de 64 Go (cache 31,5 Go, marge 22 %) | 64 Go |
| Disque par nœud et horizon avant saturation | données sur disque : 224,4 Go × 0,5124 (compression mesurée : 17 248 256 / 33 661 042) = 115,0 Go ; index : 224,4 × 0,3723 = 83,5 Go ; total 198,5 Go/an ; disque utilisable : 2 To × 70 % = 1 400 Go ; 1 400 / 198,5 | 7,1 ans |
| Facteur de pic | moyenne : 400 M ÷ (365 × 86 400 s) = 12,7 tx/s ; pic ÷ moyenne = 1 200 ÷ 12,7 | ×95 : nous dimensionnons sur le pic, pas sur la moyenne |
| Rétention sur 5 ans | sur disque : 5 × 198,5 Go = 0,99 To ; non compressé, avec index : 5 × 307,9 Go = 1,54 To | tient sur 1,4 To utilisables pendant 7 ans, mais entre dans la zone de 1 à 2 To par Replica Set à partir de laquelle on envisage de répartir : nous archivons au-delà de 2 ans |


## 2 bis. Un chiffre qui contredit l'architecture : la taille des index
Mesuré : 12 529 664 octets d'index pour 463 878 entrées (3 index × 60 000 transactions + 2 index × 141 939 lignes), soit **27 octets par entrée**. C'est peu : à 60 000 documents, un index reste plus compact qu'à 400 millions. Une règle de prudence courante compte 40 à 60 octets par entrée (chapitre 11). Nous refaisons donc le calcul avec ces valeurs :

| Hypothèse | Index par transaction métier (7,73 entrées) | Index chauds (30 jours) | Working set | RAM nécessaire |
|---|---|---|---|---|
| Mesuré (27 o) | 209 o | 6,9 Go | 25,9 Go | 52,8 Go : 64 Go suffit |
| Prudence basse (40 o) | 309 o | 10,2 Go | 29,2 Go | 59,4 Go : 64 Go juste |
| Prudence haute (60 o) | 464 o | 15,3 Go | 34,3 Go | 69,6 Go : **64 Go ne suffit plus** |

Le nœud de 64 Go tient tant que les index restent sous **49 octets par entrée** : au-delà, le working set dépasse le cache de 31,5 Go. Nous gardons donc 64 Go comme base, avec un seuil de surveillance : si les index dépassent 45 octets par entrée en production, ou si le working set dépasse 60 % de la RAM, nous passons à des nœuds de 128 Go. C'est une montée en gamme, pas un sharding.

## 3. Verdict (une phrase chacun, avec un SEUIL chiffré)
Nous décidons chaque composant sur trois critères : le volume par Replica Set, la part de la RAM prise par le working set, et la part du débit du primary prise par les écritures. Pour Kafka, ce n'est pas le débit qui compte, mais le nombre de consommateurs indépendants et le besoin de rejeu.

| Question | Réponse | Seuil de bascule (chiffré, avec votre ordre de grandeur) |
|---|---|---|
| Un seul replica set suffit-il ? | Oui à 18 mois : 0,31 To par an non compressé (sous la zone de 1 à 2 To) ; working set de 25,9 Go sur 64 Go, soit 40 % de la RAM (54 % dans l'hypothèse prudente de la section 2 bis) ; les 7 200 écritures par seconde au pic restent à comparer au débit d'un primary, que nous mesurerons en Partie 4. | Working set au-delà de 60 % de la RAM ; ou plus de 1 à 2 To par replica set ; ou écritures au-delà de 50 % du débit mesuré en Partie 4. |
| Sharding ? | Non : aucun des trois critères n'est franchi à 18 mois. Nous ne le déclencherons que sur cette feuille et un test de charge. | Sur des nœuds de 64 Go : entre 490 M tx/an (working set à 50 % de la RAM) et 600 M tx/an (60 %). En volume : 1 To non compressé atteint en 3,2 ans, 2 To en 6,5 ans. |
| Kafka ? | Non au démarrage : un seul consommateur des événements `outbox` (le relais de notifications), qu'un Change Stream avec jeton de reprise suffit à servir. | Dès qu'un **deuxième consommateur indépendant** doit relire les événements au-delà de la fenêtre de l'oplog (par exemple la détection de fraude ou la comptabilité), ou qu'il faut un tampon devant le pic. Probable à la cible : nous le tranchons en Partie 7. |
| Spark / Data Lake ? | Non : 224,4 Go de données par an, soit environ 615 Mo par jour ; un `$merge` quotidien vers un read model suffit. E3 prend 23 ms sur le POC (`03-explain.txt`). | Plusieurs To à transformer par cycle, ou des sources hétérogènes hors MongoDB (opérateurs télécom, banques partenaires). |
| Redis pour le solde ? | Non : les 3 M soldes pèsent 0,43 Go et tiennent dans le cache ; une lecture exacte par index prend 0 ms en médiane (Q3, `03-explain.txt`). Nous n'ajoutons pas de cache sans mesure qui le justifie. | Une lecture de solde au-delà de 20 ms au p99, mesurée sous charge, ou plus de 20 000 lectures de solde par seconde soutenues. |
| Lambda ? | Non : nous n'avons pas de besoin cumulé de temps réel **et** de recalcul historique lourd. | Les deux besoins à la fois, sans qu'un seul moteur puisse les servir. |

## 4. Hypothèses (liste)
**Mesurées sur le POC, puis extrapolées :**
1. Tailles moyennes : 253,02 octets par transaction, 130,19 par ligne de ledger, 144 par wallet ; 2,36565 lignes de ledger par transaction. Nous supposons qu'elles restent les mêmes à 3 M wallets (identifiants de même forme).
2. Compression sur disque (0,5124) et facteur d'index (0,3723), mesurés sur le POC et supposés constants. Le facteur d'index est probablement optimiste : voir la section 2 bis.
3. Écritures par transaction métier : 6 dans le cas le plus lourd, 5,79 en moyenne mesurée.

**Non testées :**
4. Unités décimales : 1 Mo = 10⁶ octets, 1 Go = 10⁹ octets.
5. Fenêtre chaude de 30 jours, trafic réparti sur l'année (30 / 365 du volume annuel). Un pic de 2 h chaque 1er du mois représenterait 8,64 M transactions par mois, soit 26 % du volume : nous supposons qu'il reste dans le mois chaud.
6. Nœud de référence : 64 Go de RAM, disque de 2 To dont 70 % utilisables ; l'oplog n'est pas compté.
7. Les 3 M wallets sont tous dans le working set ; `customers` (0,46 Go) et `merchants` (0,013 Go) n'y sont pas.
8. Les documents `outbox` sont supprimés après envoi : ils n'entrent pas dans le volume annuel (un document pèse 109 octets, mesuré).
9. Volume constant de 400 M tx/an ; archivage des données de plus de 2 ans.
10. Taille des index par entrée : 27 octets mesurés, 40 à 60 en hypothèse prudente (section 2 bis).
11. Débit d'écriture d'un nœud : pas encore mesuré ; il le sera avec `transfer.js` en Partie 4.
