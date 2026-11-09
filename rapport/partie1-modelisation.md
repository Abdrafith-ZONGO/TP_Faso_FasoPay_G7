# Partie 1 : Modélisation (+ ADR-001)

> Brouillon pour la section 3 du rapport. Tous les chiffres viennent de `preuves/01-validator-rejet.txt` et `preuves/01-mesures-modelisation.txt` (mesurés sur `fasopay_tp`, groupe 07).

## 1.1 Schéma et validation

Sept collections dans `fasopay_tp` : `customers`, `wallets`, `merchants`, `transactions`, `ledger_entries` (importées), `outbox` et `fraud_alerts` (créées vides). Six d'entre elles portent un validateur `$jsonSchema` avec `validationLevel: "strict"` et `validationAction: "error"` : `customers`, `wallets`, `merchants`, `transactions`, `ledger_entries`, `outbox`. `fraud_alerts` n'a pas de validateur à ce stade : elle reste vide.

Types BSON retenus : montants en entiers (`int`, `long` admis), dates en `date`, seul `feePct` (pourcentage de commission) en `double`. Les montants ne sont jamais des `double`.

Champs et types BSON par collection (obligatoires sauf mention « optionnel ») :

| Collection | Champs : type BSON, contrainte |
|---|---|
| `customers` | `_id` (string ou objectId) ; `phone` (string, `+226` suivi de 8 chiffres) ; `name` (string non vide) ; `city` (string) ; `kycLevel` (int, 0 à 3) ; `segment` (string : `GRAND_PUBLIC`, `ETUDIANT`, `COMMERCANT`, `FONCTIONNAIRE`) ; `createdAt` (date) |
| `wallets` | `_id` (string ou objectId) ; `customerId` (string) ; `balance` (int ou long, ≥ 0) ; `currency` (string : `XOF`) ; `status` (string : `ACTIVE`, `FROZEN`) ; `dailyLimit` (int ou long, ≥ 1) ; `version` (int, ≥ 0) ; `updatedAt` (date) |
| `merchants` | `_id` (string ou objectId) ; `name` (string non vide) ; `category` (string) ; `mcc` (int, 1000 à 9999) ; `city` (string) ; `location` (objet GeoJSON : `type` = `Point`, `coordinates` = tableau de 2 nombres) ; `feePct` (double, 0 à 100) ; `createdAt` (date) |
| `transactions` | `_id` (string ou objectId) ; `idempotencyKey` (string non vide) ; `type` (string : `P2P`, `MERCHANT_PAY`, `CASH_IN`, `CASH_OUT`, `BILL`) ; `amount` (int ou long, ≥ 1) ; `fee` (int ou long, ≥ 0) ; `status` (string : `COMPLETED`, `FAILED`, `REVERSED`, `PENDING`) ; `channel` (string : `USSD`, `APP`, `QR`) ; `createdAt` (date) ; `riskScore` (int, 0 à 100) ; `flags` (tableau de strings parmi `HIGH_AMOUNT`, `INSUFFICIENT_FUNDS`, `NEW_RECIPIENT`, `NETWORK_ERROR`, `NIGHT`, `SUPPORT_REVERSAL`) ; optionnels : `fromWalletId`, `toWalletId`, `merchantId` (string), `completedAt` (date), `attempts` (tableau d'objets `n` int ≥ 1, `at` date, `result` string `PROCESSED` ou `REPLAYED`) |
| `ledger_entries` | `_id` (string ou objectId) ; `txId` (string) ; `walletId` (string ou null) ; `direction` (string : `DEBIT`, `CREDIT`) ; `amount` (int ou long, ≥ 1) ; `createdAt` (date) ; si `walletId` est une chaîne : `balanceAfter` (int ou long, ≥ 0) obligatoire et pas de `account` ; si `walletId` est null : `account` (string : `FEES`, `FLOAT`, `BILLER` ou `MERCHANT:M` suivi de 5 chiffres) obligatoire et pas de `balanceAfter` |
| `outbox` | `type` (string : `TRANSFER_COMPLETED`) ; `txId` (string) ; `status` (string : `PENDING`, `SENT`) ; optionnels : `_id`, `createdAt` (date), `sentAt` (date) |
| `fraud_alerts` | collection vide, sans schéma défini à ce stade |


Preuves (`01-validator-rejet.txt`) :
- les six `collMod` répondent `ok: 1`, options relues : `strict / error` six fois ;
- les données existantes passent : 0 document invalide (customers 2000, wallets 2000, merchants 150, transactions 60000, ledger_entries 141939, outbox 0) ;
- un document invalide est rejeté dans chaque collection (code 121), avec le détail `errInfo` (par exemple `kycLevel: 'trois'`, `balance: 12.5`, `feePct: 'beaucoup'`, `status: 'INCONNU'`, `type: 'AUTRE_TYPE'`) ;
- les comptages n'ont pas changé après les tests.

Le validateur de `ledger_entries` utilise `oneOf` : soit une jambe de wallet (`walletId` en chaîne, `balanceAfter` obligatoire, pas de `account`), soit une jambe hors wallet (`walletId: null`, `account` obligatoire, pas de `balanceAfter`). Il accepte ainsi les 71 885 jambes avec wallet et les 70 054 sans.

## 1.2 Embed, référence ou hybride, relation par relation

| Relation | Choix | Access pattern | Justification (chiffres) |
|---|---|---|---|
| client ↔ wallet | Référence (`wallets.customerId`) | AP1, AP2 | 1 wallet par client (2000 clients, 2000 wallets). Un virement lit et écrit le wallet sans toucher au client : le wallet change à chaque transaction, le client presque jamais. |
| wallet ↔ transactions | Référence | AP1 | 1939 wallets émettent des transactions, 23,98 en moyenne, maximum 319 ; une transaction concerne deux wallets, elle ne peut pas appartenir à un seul. |
| transaction ↔ ledger | Référence (collection séparée) | AP1, AP3, AP4 | 2 à 6 lignes par transaction (2 : 28 111 ; 3 : 28 093 ; 4 : 121 ; 6 : 159). Le virement écrit les lignes (AP1), l'historique les relit par wallet (AP3) : le ledger est append-only et se lit par wallet, pas seulement par transaction. |
| marchand ↔ transactions | Référence | lecture marchand (hors des 4 prioritaires) | 150 marchands, 17 989 paiements, 119,9 en moyenne, maximum 4 479 (24,9 % des paiements marchands) : on les lit par marchand et par période. |
| transaction ↔ `attempts` | Embed | AP1 (le rejeu) | Les rejeux d'une même clé se lisent avec la transaction ; seulement 21 transactions en ont, liste courte. |
| transaction ↔ `flags`, marchand ↔ `location` | Embed | aucun dédié | Petits, bornés, toujours lus avec leur document. |
| ledger ↔ solde (`balanceAfter`) | Hybride (copie) | AP3, AP4 | Chaque jambe de wallet garde une copie du solde après l'opération : l'historique du wallet se reconstitue sans tout recalculer. |

## 1.3 Quatre access patterns, par priorité (fréquence × criticité)

Les fréquences et les latences cibles sont des hypothèses de conception, que la Partie 0 et le test de charge de la Partie 4 confirmeront ou non.

| Rang | Access pattern | Nature | Fréquence au pic | Latence cible | Cohérence | Collections et index |
|---|---|---|---|---|---|---|
| AP1 | Exécuter un virement ou un paiement (vérification de la clé d'idempotence comprise) | Écriture, transaction multi-documents | jusqu'à 1 200/s | p95 < 300 ms | Forte, idempotente | `transactions` (`uniq_idempotency_key`), `ledger_entries`, `wallets`, `outbox` |
| AP2 | Consulter son solde (USSD, application) | Lecture par clé | plusieurs milliers/s | p95 < 100 ms | Forte (lecture sur le primary) | `wallets._id` |
| AP3 | Historique d'un wallet, trié par date, paginé | Lecture par plage | centaines/s | p95 < 150 ms | Éventuelle acceptable | `ledger_entries` (`idx_ledger_wallet_date`) |
| AP4 | Contrôles de nuit : rapprochement solde / ledger (E1) et plafond journalier (E2) | Lot (batch) | 1 fois par nuit, 3 M wallets | minutes | Photo figée à un instant donné | `ledger_entries` (Q2), `transactions` (`idx_sorties_wallet_jour`, Q1) |

**Priorité.** AP1 est le plus critique : c'est de l'argent, au pic. AP2 est le plus fréquent. AP3 est fréquent mais tolère un léger retard. AP4 est rare, mais c'est lui qui détecte les écarts signalés par le CTO (soldes contestés, découpage sous le plafond). Le contrôle du plafond reste séparé du virement : il alimente `fraud_alerts`. Hors de ces quatre : les transactions d'un marchand sur une période (règlement, chiffre d'affaires), que nous servons par un read model (Partie 7).

## 1.4 Anti-pattern évité : le ledger embarqué dans le wallet

Mettre les lignes de ledger dans un tableau du wallet. Mesuré (`01-validator-rejet.txt` et `01-mesures-modelisation.txt`) : 35,94 lignes par wallet en moyenne (maximum 390), 4 831 octets en moyenne (maximum 52 346 octets), 134,4 octets par ligne. Le document wallet grossirait à chaque virement et serait réécrit en entier, alors que c'est la zone la plus modifiée. Un document est limité à 16 Mo, soit environ 125 000 lignes à 134 octets ; le wallet le plus actif en a déjà 390 sur six mois de données. Décision : ledger séparé, relié par `walletId`. L'extrapolation à la cible de 18 mois relève de la Partie 0.

## 1.5 Partie double, montants entiers, solde en cache

Chaque mouvement écrit au moins deux lignes de même total (un débit, un crédit). Mesuré : sur les 56 484 transactions qui ont un ledger, 0 est déséquilibrée ; total des crédits = total des débits = 1 955 479 314. Les 3 516 transactions FAILED ou PENDING n'ont aucune ligne (56 484 + 3 516 = 60 000).

Les montants sont des entiers en FCFA : pas d'arrondi, un franc ne se divise pas.

Le solde stocké dans `wallets.balance` est un cache du ledger : la vérité est la somme signée des lignes du wallet. Le cache évite de recalculer à chaque lecture. Conséquence : cache et ledger doivent changer ensemble, dans une même transaction multi-documents (Partie 4) ; sinon ils divergent, ce que l'enquête E1 mesure.

Les 70 054 lignes `walletId: null` (champ `account`, valeurs `FEES`, `FLOAT`, `BILLER`, `MERCHANT:…`) sont la contrepartie de l'argent qui ne passe pas par un wallet. Le validateur les accepte.

Le modèle applique les cinq règles d'un grand livre en partie double :
1. **Montants entiers** : FCFA, jamais de `double`.
2. **Partie double** : au moins deux lignes par transaction, débits = crédits ; 0 transaction déséquilibrée sur 56 484.
3. **Ajout seul** : une ligne de ledger n'est jamais modifiée ni supprimée ; une erreur se corrige par une écriture inverse. Nos données le montrent : les 280 transactions `REVERSED` sont exactement celles qui ont 4 lignes (121) ou 6 lignes (159), soit le double des 2 ou 3 lignes d'une transaction normale. Par exemple, le paiement T0002044 (9 325 FCFA chez M00044, frais 196) garde ses 3 lignes d'origine, puis reçoit 38 secondes plus tard 3 lignes inverses de mêmes montants ; le solde de W000344 passe de 171 400 à 180 725 (`preuves/01-mesures-modelisation.txt`, complément).
4. **Le solde est un cache dérivé** : `wallets.balance` = somme des crédits − somme des débits, et chaque ligne de wallet garde `balanceAfter`.
5. **Idempotence** : index unique sur `transactions.idempotencyKey` (Partie 3), pour qu'un rejeu ne débite jamais deux fois.

**Patterns de modélisation.** Le solde du wallet et `balanceAfter` relèvent du **Computed pattern** : une valeur pré-calculée, lue sans recalcul, au prix d'une mise à jour à chaque écriture. **Limite :** aucun document ne porte de champ `schemaVersion` (**Schema Versioning**) ; nous l'ajouterions avant toute évolution du schéma en production, pour migrer progressivement sans interruption.

## 1.6 ADR-001

Voir `adr/ADR-001.md` : « Un transfert écrit combien de documents ? ».
