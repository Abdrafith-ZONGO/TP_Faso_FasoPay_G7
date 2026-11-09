# Partie 4 · Transactions : un virement qui ne double ni ne se perd

> Brouillon de la section 6 du rapport. Code : `code/transfer.js` et nos tests (`code/04-*.js`, lancés par `code/04-lancer.sh`) ; sorties brutes : `preuves/04-transaction.txt`, `preuves/04-concurrence.txt`, `preuves/04-lost-update.txt`.

## 4.1 Où se font les tests
Tous les tests tournent sur une base dédiée, `fasopay_test`, recréée à chaque lancement par `code/04-base-test.js`. La base `fasopay_tp` n'est jamais modifiée : nos chiffres des parties 0 à 3 restent ceux du `fingerprint.json`. La base de test reçoit les mêmes validateurs que `fasopay_tp` (Partie 1) et l'index unique sur `transactions.idempotencyKey` (Partie 3) : les documents écrits par `transfer()` doivent donc respecter notre schéma.

## 4.2 Comment `transfer()` fonctionne
1. **Contrôles sans accès à la base.** Le montant doit être un entier strictement positif ; il est ensuite stocké en entier BSON (`int`, ou `long` s'il est très grand), jamais en `double`. Un virement vers soi-même et une clé absente sont refusés avec `INVALID_AMOUNT`, la seule erreur de validation prévue par le contrat.
2. **Rejeu.** Si la clé existe déjà, la fonction renvoie le même `txId` et le statut, sans rien écrire.
3. **Collections.** `ledger_entries` et `outbox` sont créées si elles manquent, au moment de l'appel et jamais au chargement : la base du correcteur ne contient que `wallets` et l'index unique.
4. **Transaction multi-documents**, en `w: "majority"` et lecture `snapshot`. La première écriture est le document `transactions` : l'index unique empêche qu'une même clé produise deux virements. Viennent ensuite le débit **conditionnel** (wallet `ACTIVE` et solde au moins égal au montant, dans la même opération), le crédit, les deux lignes de ledger avec `balanceAfter`, puis l'événement `outbox`. Soit 6 documents (ADR-001).
5. **En cas d'erreur, tout est annulé.** Un refus du contrat renvoie son erreur ; une clé en double (code 11000, un autre client vient de valider la même clé) devient un rejeu ; un conflit passager (`TransientTransactionError`) est rejoué après une courte attente.
6. **Validation.** Si son résultat est inconnu (`UnknownTransactionCommitResult`), elle est redemandée ; si l'erreur est passagère, toute la transaction est rejouée. Le nombre d'essais est limité.

Deux choix à signaler. Un refus n'est pas mémorisé : rien n'étant écrit, la même clé peut être réessayée plus tard (par exemple après un dépôt). Et sur notre Replica Set à un nœud, `w: "majority"` équivaut à `w: 1` : la garantie de majorité ne prend son sens qu'avec trois nœuds (Partie 5).

## 4.3 Ce que nos tests démontrent
Résultat : 36 vérifications OK sur 36 (`preuves/04-transaction.txt`).

| Test | Ce qui est vérifié | Résultat |
|---|---|---|
| Chargement | `load()` ne modifie ni les comptages, ni les soldes, ni la liste des collections | identique avant / après |
| Virement réussi (1 500 FCFA) | 1 transaction, 2 lignes de ledger, 1 outbox ; W_A de 100 000 à 98 500, W_B de 0 à 1 500 ; `balanceAfter` égal au nouveau solde ; `version` passée à 1 | OK ; montants stockés en `int` (vérifié par `$type`) |
| Idempotence | 1 appel puis 3 rejeux de la clé `test-rejeu-1` (2 000 FCFA) | 1 seul document, W_A débité une fois (2 000 et non 8 000), les 3 rejeux renvoient la même réponse et le même `txId` |
| Refus (10 cas) | montant 12,5, texte, 0 ou négatif ; virement vers soi-même ; émetteur absent ou gelé ; destinataire gelé ou absent ; solde insuffisant | la bonne erreur à chaque fois, comptages et soldes identiques, clé absente de `transactions` |
| Réponse perdue | le virement est fait, le client réessaie avec la même clé | rejeu reconnu, même `txId`, un seul débit de 300 FCFA |
| Bilan | nos validateurs sur les 4 collections ; somme des soldes ; équilibre du ledger | 0 document invalide, 150 500 FCFA au départ comme à la fin, 0 transaction déséquilibrée |

Pour 5 des 10 refus (émetteur absent ou gelé, destinataire gelé ou absent, solde insuffisant), la transaction était déjà ouverte : le compteur du serveur affiche 5 transactions annulées avant le test d'abort. Ces refus ont donc bien été annulés côté serveur, et pas seulement évités par un contrôle préalable. Pour les deux refus sur le destinataire, le débit avait même déjà eu lieu avant l'annulation.

**Abort prouvé.** Avec `failAfterFirstWrite`, nous montrons trois choses. D'abord, juste après la première écriture, le document de la transaction est lu **dans** la transaction, alors qu'une lecture **hors** de la transaction renvoie `null` au même instant : l'écriture existe, isolée. Ensuite, le profileur du serveur a enregistré cette insertion (`ninserted: 1`, `txnNumber: 8`, `startTransaction: true`), et le compteur d'annulations du serveur passe de 5 à 6. Enfin, après l'erreur `CRASH_SIMULATED`, le document a disparu, et les comptages comme les soldes sont identiques à ceux d'avant. Ce que ce test ne montre pas : une panne réelle du serveur au milieu de la transaction ; c'est l'objet de la Partie 5.

## 4.4 Concurrence
Résultat : 10 vérifications OK sur 10 (`preuves/04-concurrence.txt`). Deux processus `mongosh` partent à la même heure (19:51:51.883 et 19:51:51.881) et envoient chacun 25 virements de 100 FCFA depuis W_CONC, qui contient 3 000 FCFA. Leurs opérations s'entremêlent à la milliseconde, et MongoDB a signalé 6 conflits d'écriture, tous rejoués par `transfer()`.

| Invariant demandé | Mesuré |
|---|---|
| Exactement 30 virements acceptés | 30 (19 pour le client A, 11 pour le client B), 20 refus `INSUFFICIENT_FUNDS`, 0 erreur |
| Solde jamais négatif | solde final 0, plus petit `balanceAfter` de W_CONC égal à 0 |
| Monnaie conservée | W_CONC + W_CONC_DEST = 0 + 3 000 = 3 000 |
| Ledger = 2 × virements | 60 = 2 × 30 |
| Outbox = virements | 30 = 30 |

La répartition entre les deux clients n'est pas égale, et elle n'a pas à l'être : c'est la condition « solde au moins égal au montant », vérifiée dans la même opération que le débit, qui fixe le total à exactement 30. En plus, les deux clients envoient au même instant le même virement avec la même clé : le premier l'exécute, le second reçoit un rejeu avec le même `txId`, et le wallet n'est débité qu'une fois (10 000 puis 9 500).

## 4.5 Sans transaction : le « lost update »
Pour montrer ce que nos protections évitent, nous avons lancé la version qu'on écrirait spontanément : lire le solde, vérifier qu'il suffit, réécrire le nouveau solde, sans transaction ni condition (`code/04-lost-update.js`). Même scénario : deux clients, 50 débits de 100 FCFA, un wallet de 3 000 FCFA (`preuves/04-lost-update.txt`).

| | Version naïve | `transfer()` |
|---|---|---|
| Débits acceptés | 50 (25 + 25) | 30 |
| Argent promis aux bénéficiaires | 5 000 FCFA | 3 000 FCFA |
| Argent réellement retiré du wallet | 2 500 FCFA (3 000 − 500) | 3 000 FCFA |
| Écart | 2 500 FCFA payés sans débit correspondant | 0 |

Avec la version naïve, les deux clients lisent souvent le même ancien solde et écrivent chacun le même nouveau solde : un des deux débits est perdu. Le wallet n'atteint jamais zéro, et le plafond de 3 000 FCFA est dépassé de 2 000 FCFA. C'est exactement le « lost update » : il explique, entre autres causes possibles, comment des soldes peuvent diverger du ledger (E1). Notre `transfer()` l'évite par la condition dans la mise à jour et par la transaction.

## 4.6 Combien de virements par seconde ?
Pour compléter la Partie 0, nous avons mesuré le débit de `transfer()` (`code/04-debit.js`, `preuves/04-debit.txt`). La mesure se fait sur une copie des 2 000 vrais wallets (`fasopay_bench`), avec les mêmes index que `fasopay_tp` ; chaque virement fait 100 FCFA entre deux wallets tirés au hasard.

| Série | Virements acceptés | Durée | Débit | Écritures de documents/s | p95 | p99 |
|---|---|---|---|---|---|---|
| 1 client | 1 000 | 7,98 s | 125,3 /s | 752 /s | 10 ms | 12 ms |
| 4 clients en parallèle | 999 | 3,03 s | 329,7 /s | 1 978 /s | 17 ms | 35 ms |

Avec 4 clients, le débit est multiplié par 2,6 : le serveur n'était pas saturé par un seul client, qui attend la réponse de chaque virement avant d'envoyer le suivant. Les 6 conflits ont tous été rejoués, et la somme des soldes reste égale à 832 251 836 FCFA. Le seul refus est un `INSUFFICIENT_FUNDS` : un wallet réel tiré au hasard avait moins de 100 FCFA.

**Ce que cette mesure ne prouve pas.** Elle a été faite sur un ordinateur portable (8 Go visibles par Docker), avec les clients sur la même machine que le serveur, sur un Replica Set à un nœud (où `w: "majority"` équivaut à `w: 1`). Le chiffre est donc un ordre de grandeur, pas la capacité d'un serveur de production. Il ne permet ni de valider ni de rejeter la cible de 1 200 virements/s : c'est le point le plus fragile de notre dimensionnement (annexe A, section 2 ter).

## 4.7 Question de fond : pourquoi la transaction ne suffit pas si le client ne reçoit pas la réponse
Une transaction multi-documents garantit le « tout ou rien » : les 6 écritures d'un virement sont toutes appliquées, ou aucune. Elle ne dit rien au client qui n'a pas reçu la réponse : la coupure peut survenir avant l'exécution, pendant, ou après la validation. Le client ne sait pas lequel de ces cas s'est produit, et son seul réflexe est de réessayer. Sans protection, ce réessai crée un second virement : c'est exactement la « rafale de paiements en double pendant une coupure réseau » décrite par le CTO.

Trois mécanismes complètent la transaction :
- **La clé d'idempotence**, protégée par un index unique. Le réessai porte la même clé ; il est reconnu et reçoit la réponse du premier virement, avec le même `txId`, sans second débit. C'est ce que montre notre test « réponse perdue », et c'est ce qui a protégé les 65 rejeux de l'incident du 10 avril (E4).
- **Les écritures rejouables** (retryable writes, activées par défaut par les pilotes MongoDB) : une opération simple interrompue par une coupure ou une élection est renvoyée automatiquement une fois, et le serveur reconnaît qu'il l'a déjà appliquée.
- **Les deux étiquettes d'erreur des transactions**, que `transfer()` traite explicitement. `TransientTransactionError` : la transaction a échoué sans rien appliquer (conflit, élection) ; on peut la rejouer entièrement. `UnknownTransactionCommitResult` : la validation a peut-être abouti ; on redemande la validation elle-même, que le serveur n'applique qu'une fois.

Ce qu'aucun de ces mécanismes ne fait : protéger un client qui réessaie avec une **nouvelle** clé. La clé doit donc être fixée par le client (l'application ou le terminal USSD) avant le premier envoi, et réutilisée à chaque réessai.
