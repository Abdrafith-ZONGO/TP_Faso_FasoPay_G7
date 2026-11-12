# Partie 2 · Enquête : E1 · E2 · E3 · E4

> Brouillon de la section 4 du rapport. Les chiffres viennent de `preuves/02-enquete.txt` ; les pipelines commentés sont dans `code/02-enquete.js`.

Le CTO nous pose quatre questions sur des problèmes réels : des soldes contestés, des clients qui contourneraient leur plafond, la concentration du chiffre d'affaires et des paiements en double. Pour y répondre, nous interrogeons directement nos données, et chaque réponse est chiffrée et vérifiable.

## E1 : wallets dont le solde ne colle pas au ledger

La finance dit que « le ledger ne colle pas aux soldes ». Si c'est vrai, le solde stocké dans certains wallets doit être différent du total de leurs mouvements dans le ledger : c'est ce que nous cherchons.

**Question du CTO.** Quels wallets ont un `balance` différent de la somme signée de leur `ledger_entries` ? Combien, et quel écart total ?

**Méthode.** Pour chaque wallet, somme des lignes de ledger (crédit +, débit −), puis comparaison avec `wallets.balance`. La jointure se fait par `walletId`. Écart = `balance` − somme du ledger. Le `$match` écarte d'abord les 70 054 jambes sans wallet ; le `$group` précède le `$lookup` (2000 jointures au lieu de 71 885).

**Résultat.** 6 wallets sur 2000 (0,3 %) sont incohérents :

| Wallet | Solde stocké | Solde du ledger | Écart | Lignes de ledger |
|---|---|---|---|---|
| W001124 | 249 025 | 278 025 | −29 000 | 7 |
| W001372 | 557 152 | 585 152 | −28 000 | 33 |
| W000967 | 389 447 | 415 447 | −26 000 | 28 |
| W001796 | 949 293 | 960 793 | −11 500 | 49 |
| W000668 | 478 654 | 487 654 | −9 000 | 31 |
| W000769 | 75 692 | 41 192 | +34 500 | 86 |

Écart net : −69 000 FCFA. Écart absolu (somme des valeurs absolues) : 138 000 FCFA. Les écarts se compensent en partie, donc l'écart net sous-estime la taille du problème : on retient 138 000 FCFA comme mesure.

**Rattachement au fingerprint.** Le total des soldes est 832 251 836 (`walletsBalanceTotal`, vérifié en D3). Le total du ledger signé sur les wallets est 832 320 836. La différence est 69 000, égale à l'écart net : les deux chiffres s'expliquent par les 6 wallets, rien d'autre ne diverge. Couverture : 2000 wallets ont des lignes de ledger pour 2000 wallets au total.

**Lecture.** Pour chacun des 6 wallets, la dernière valeur `balanceAfter` du ledger est égale à la somme du ledger : la dernière ligne du ledger est cohérente avec la somme des lignes. C'est le solde stocké qui diverge, pas le ledger. Cinq wallets ont un solde stocké inférieur au ledger, un (W000769) un solde supérieur.
L'écart n'est pas un « faux positif d'ouverture » : les soldes initiaux sont bien dans le ledger (2 000 dépôts d'ouverture, un par wallet, chacun avec un crédit du wallet de 707 172 575 FCFA au total). Ce que l'audit ne dit pas : quand et comment les 6 soldes ont divergé.

**Ce que cela implique.** C'est le risque décrit en Partie 1 : le solde est un cache du ledger, et un cache écrit hors de la transaction qui écrit le ledger diverge. Deux conséquences. D'abord, tout changement de solde doit passer par `transfer.js` (Partie 4), qui écrit ledger et solde ensemble. Ensuite, un contrôle de rapprochement (le pipeline E1) devrait tourner régulièrement. Pour corriger les 6 wallets, on passerait par des écritures d'ajustement dans le ledger plutôt que par une modification directe du solde, afin de garder la trace. E1 détecte les écarts, mais ne dit ni quand ni comment ils sont apparus.

## E2 : clients qui découpent leurs transferts sous le plafond

La conformité soupçonne des clients de découper leurs transferts en plusieurs montants juste sous leur plafond journalier. Il faut d'abord définir ce qu'est un découpage, puis chercher les wallets qui correspondent.

**Question du CTO.** Quels clients « découpent » leurs transferts pour passer sous le plafond journalier ?

**Critère.** Un wallet est suspect un jour donné s'il émet au moins 3 transactions `COMPLETED` de type `P2P` ou `CASH_OUT`, chacune comprise entre 90 % et 100 % de son plafond `dailyLimit`. Le jour est compté en UTC. C'est un choix, que nous justifions ainsi : `P2P` et `CASH_OUT` sont les sorties d'argent vers une personne ou en espèces (un paiement marchand ou une facture n'est pas un transfert) ; la bande 90-100 % décrit un montant choisi pour rester juste sous la limite ; le seuil de 3 évite de signaler une transaction isolée proche du plafond ; seules les transactions abouties comptent, car une transaction échouée n'a rien fait passer.

**Méthode.** Le pipeline filtre d'abord les sorties abouties, puis joint le plafond du wallet émetteur par `walletId`, garde la bande 90-100 %, regroupe par wallet et par jour, et ne retient que les groupes d'au moins 3 transactions. Le premier `$match` précède le `$lookup` pour réduire le nombre de jointures ; le second doit suivre la jointure, parce qu'il compare le montant au plafond.

**Résultat.** 5 wallets sur 2000, soit 23 couples wallet-jour et 121 transactions :

| Wallet | Jours | Transactions | Total | Plafond | Segment | KYC | Ville |
|---|---|---|---|---|---|---|---|
| W000214 | 4 | 25 | 11 834 325 | 500 000 | ETUDIANT | 2 | Ouagadougou |
| W000758 | 4 | 24 | 4 515 025 | 200 000 | COMMERCANT | 1 | Tenkodogo |
| W001070 | 4 | 20 | 9 408 025 | 500 000 | GRAND_PUBLIC | 2 | Ouagadougou |
| W001218 | 6 | 28 | 13 278 875 | 500 000 | GRAND_PUBLIC | 2 | Kaya |
| W001322 | 5 | 24 | 4 598 925 | 200 000 | GRAND_PUBLIC | 1 | Banfora |

Le total de 23 couples ressort de ce résumé (4 + 4 + 4 + 6 + 5 jours).

**Cas détaillé : W000758, le 30 janvier 2026** (plafond 200 000, toutes les transactions `COMPLETED` avec le drapeau `HIGH_AMOUNT`) :

| Heure (UTC) | Transaction | Type | Destinataire | Montant |
|---|---|---|---|---|
| 08:25 | T0010875 | CASH_OUT | - | 191 375 |
| 08:54 | T0010896 | P2P | W000951 | 186 050 |
| 09:20 | T0010909 | CASH_OUT | - | 189 575 |
| 09:41 | T0010920 | P2P | W001312 | 181 850 |
| 10:17 | T0010955 | P2P | W001312 | 191 975 |
| 10:40 | T0010970 | P2P | W000951 | 191 475 |
| 11:21 | T0010983 | CASH_OUT | - | 188 025 |

Sept transactions en moins de 3 heures, espacées de 21 à 41 minutes, chacune entre 181 850 et 191 975, soit 1 320 325 FCFA au total pour un plafond de 200 000 (6,6 fois). Les 4 transferts P2P vont vers deux wallets seulement, W000951 et W001312, deux fois chacun.

**Solidité du critère.**
- Aucune transaction ne dépasse le plafond à elle seule (46 495 sorties, 0 dépassement). Le contournement est donc un problème de cumul, pas de montant.
- Les 121 transactions comprises entre 90 % et 100 % du plafond, tous types et statuts confondus, sont 73 `P2P` et 48 `CASH_OUT`, toutes `COMPLETED`, et appartiennent aux mêmes 5 wallets. Aucun autre wallet n'a de transaction dans cette bande.
- Avec un seuil de 50 % ou de 70 % au lieu de 90 %, on retrouve les mêmes 5 wallets : le résultat ne dépend pas finement du seuil.

**Limites.** Un indice de soupçon n'est pas une preuve de fraude : les données montrent un comportement, pas une intention. Le critère (90 %, 3 transactions, `P2P` et `CASH_OUT` seulement) est un choix ; un découpage plus fin ou sur plusieurs jours ne serait pas vu. Toutes les transactions retenues sont `COMPLETED` : le plafond journalier n'a donc pas bloqué ces cumuls. Reste à confirmer avec l'équipe produit si le contrôle du plafond porte sur chaque transaction ou sur le cumul de la journée, ce que les données seules ne disent pas.

**Ce que cela implique.** Un contrôle cumulatif journalier devrait être ajouté au moment du transfert (Partie 4 et architecture, Partie 7), avec une alerte à instruire par la conformité. Ces 5 wallets sont la liste de départ de leur enquête.

## E3 : marchands qui concentrent le chiffre d'affaires

Le CTO veut savoir si quelques marchands font l'essentiel du chiffre d'affaires : cela change les priorités commerciales, et la façon de répartir les données (Partie 6).

**Question du CTO.** Quels marchands concentrent le CA ? Le top 20 % fait-il 80 % ?

**Définition du CA.** CA d'un marchand = somme des `amount` de ses transactions `MERCHANT_PAY` au statut `COMPLETED`. Les `FAILED` (1 243 paiements, 22 883 125) et `PENDING` (13, 242 250) n'ont rien encaissé ; les `REVERSED` (130, 1 822 900) sont des remboursements ; `fee` est la commission de FasoPay, pas le CA du marchand. En comptant tous les statuts, le total serait 253 998 800 (+10,9 %) : la définition change le chiffre, d'où la nécessité de la fixer.

**Rattachement au fingerprint.** Les montants COMPLETED par type totalisent 1 946 303 325, soit `transactionsAmountCompleted`. Les paiements marchands en représentent 229 050 525 (11,77 %), sur 16 603 transactions.

**Méthode.** `$match` d'abord (16 603 paiements sur 60 000 transactions), `$group` par marchand, `$sort` décroissant. Pour la courbe, `$setWindowFields` calcule le CA cumulé. Le tri se fait sur `ca` seul car `$documentNumber` n'accepte qu'un champ de tri ; contrôle fait : les 150 CA sont tous distincts.

**Résultat.** Trois marchands dominent :

| Rang | Marchand | Catégorie, ville | CA | Part du CA | Paiements |
|---|---|---|---|---|---|
| 1 | M00130 École Paspanga | Éducation, Kaya | 62 325 425 | 27,21 % | 2 079 |
| 2 | M00044 Faso Market Central | Supermarché, Kaya | 41 440 550 | 18,09 % | 4 162 |
| 3 | M00062 Pagne & Mode Liberté | Habillement, Ouagadougou | 21 097 950 | 9,21 % | 1 142 |

Ces trois marchands font 124 863 925, soit 54,51 % du CA.

Courbe de Pareto (part cumulée du CA selon la part des marchands) :

| Marchands | 10 % (15) | 20 % (30) | 30 % (45) | 50 % (75) | 70 % (105) | 100 % (150) |
|---|---|---|---|---|---|---|
| Part du CA | 72,55 % | 81,96 % | 87,62 % | 94,28 % | 97,94 % | 100 % |

**Réponse.** Oui : le top 20 % des marchands (30 sur 150) fait 81,96 % du CA, au-dessus des 80 %. La concentration est même plus forte : 10 % des marchands font 72,55 % du CA, et la moitié des marchands la moins active (75) n'en fait que 5,72 %.

**Lecture.** M00130 domine par le montant moyen (environ 29 979 par paiement) ; M00044 domine par le nombre de paiements : 4 162, soit 25,07 % des 16 603 paiements, pour un montant moyen d'environ 9 957. Ce second marchand correspond au « marchand-hotspot » (environ 25 % du volume marchand) de la Partie 6 : le volume en nombre d'opérations est plus concentré que le CA sur un seul marchand.

## E4 : clés d'idempotence rejouées et incident

Pendant une coupure réseau, un client qui ne reçoit pas de réponse renvoie sa demande avec la même clé d'idempotence. Nous cherchons ces demandes renvoyées et vérifions qu'aucune n'a produit un second paiement.

**Question du CTO.** Quelles `idempotencyKey` ont été rejouées, avec quels écarts de montant ou de statut ? Y a-t-il eu un incident (fenêtre horaire) ?

**Méthode.** Le tableau `attempts` d'une transaction garde chaque tentative : la première est `PROCESSED`, les suivantes `REPLAYED`. `$match` d'abord (21 transactions sur 60 000), `$project` pour compter tentatives, traitées et rejeux, puis `$unwind` pour analyser les tentatives par jour et par heure.

**Résultat.** 21 clés rejouées (0,035 % des transactions) : 9 `MERCHANT_PAY`, 8 `P2P`, 4 `BILL`. Elles totalisent 86 tentatives, dont 21 traitées (exactement une par clé) et 65 rejeux (1 à 5 par clé). Les rejeux arrivent entre 6,9 et 138,2 secondes après la première tentative.

**Écarts de montant et de statut : aucun.** Chaque clé correspond à un seul document : les 60 000 clés sont toutes uniques. Les 21 transactions sont toutes `COMPLETED` et ont 2 ou 3 lignes de ledger (8 et 13), soit le nombre habituel d'un virement simple. Un contrôle des paiements marchands (même wallet, même marchand, même montant, moins de 10 minutes d'écart, clés différentes) ne renvoie aucun doublon. Les rejeux n'ont donc rien exécuté de plus.

**Ce qui aurait pu se passer.** Si chaque rejeu avait été exécuté comme un nouveau paiement, 633 025 FCFA auraient été débités en trop (65 rejeux × le montant de leur transaction).

**Incident.** Le 2026-04-10, de 14:09:05 à 15:36:10 UTC (environ 87 minutes ; UTC est l'heure du Burkina Faso), 10 clés différentes sont rejouées : 46 tentatives, dont 36 rejeux (15 à 14 h, 31 à 15 h), soit 344 775 FCFA exposés. Les 11 autres jours en comptent une seule clé chacun (40 tentatives au total). Cette concentration n'est pas aléatoire : elle est compatible avec la coupure réseau décrite dans le mail du CTO. Les données ne disent pas la cause, seulement qu'il y a eu un pic de rejeux dans cette fenêtre.

**Ce que cela montre.** Dans ce jeu de données, l'idempotence a tenu : 65 rejeux, aucun effet en double. C'est ce que la Partie 3 (index unique sur `idempotencyKey`) et la Partie 4 (`transfer.js`) doivent garantir par construction : la clé unique rend le doublon impossible, même quand la réponse se perd.

**Le contrôle détecte-t-il vraiment ?** Un contrôle qui renvoie 0 n'est une preuve que s'il sait trouver un cas réel. Sur une copie jetable des 17 989 paiements marchands (`fasopay_audit`), il renvoie 0 ; après l'ajout volontaire d'un faux doublon (copie de T0003152, une minute plus tard, avec une autre clé), il renvoie exactement ce document. La base jetable a ensuite été supprimée.

**Fuseau horaire.** E2 et E4 regroupent par jour. Relancées avec `timezone: "Africa/Ouagadougou"`, elles donnent les mêmes résultats (23 couples, 121 transactions, 5 wallets pour E2 ; les mêmes 12 jours pour E4), puisque le Burkina Faso est en UTC+0. Le code fourni utilise ce fuseau explicite.

## Bilan de la Partie 2

| Question | Réponse chiffrée |
|---|---|
| E1 | 6 wallets sur 2000 ont un solde différent du ledger ; écart net −69 000, écart absolu 138 000 ; le total du ledger signé dépasse les soldes de 69 000 |
| E2 | 5 wallets, 23 couples wallet-jour, 121 transactions entre 90 % et 100 % du plafond ; aucune transaction ne dépasse le plafond à elle seule |
| E3 | CA marchand 229 050 525 ; le top 20 % (30 marchands) fait 81,96 % ; M00130 seul fait 27,21 % |
| E4 | 21 clés rejouées, 65 rejeux, aucun doublon ; incident le 2026-04-10 de 14:09 à 15:36 UTC (10 clés) |

**À retenir.** l'argent n'a pas été doublé dans nos données, mais 6 soldes ont divergé du ledger : le risque principal est un chemin d'écriture qui modifie le solde hors de la transaction qui écrit le ledger.
