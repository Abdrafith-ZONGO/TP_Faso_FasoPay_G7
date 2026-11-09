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
| client ↔ wallet | Référence (`wallets.customerId`) | AP1 | 1 wallet par client (2000 clients, 2000 wallets). Un virement lit et écrit le wallet sans toucher au client : le wallet change à chaque transaction, le client presque jamais. |
| wallet ↔ transactions | Référence | AP1, AP3 | 1939 wallets émettent des transactions, 23,98 en moyenne, maximum 319 ; une transaction concerne deux wallets, elle ne peut pas appartenir à un seul. |
| transaction ↔ ledger | Référence (collection séparée) | AP1, AP3 | 2 à 6 lignes par transaction (2 : 28 111 ; 3 : 28 093 ; 4 : 121 ; 6 : 159). Le virement écrit les lignes (AP1), l'historique les relit par wallet (AP3) : le ledger est append-only et se lit par wallet, pas seulement par transaction. |
| marchand ↔ transactions | Référence | AP4 | 150 marchands, 17 989 paiements, 119,9 en moyenne, maximum 4 479 (24,9 % des paiements marchands) : on les lit par marchand et par période. |
| transaction ↔ `attempts` | Embed | AP2 | Les rejeux d'une même clé se lisent avec la transaction ; seulement 21 transactions en ont, liste courte. |
| transaction ↔ `flags`, marchand ↔ `location` | Embed | aucun dédié | Petits, bornés, toujours lus avec leur document. |
| ledger ↔ solde (`balanceAfter`) | Hybride (copie) | AP3 | Chaque jambe de wallet garde une copie du solde après l'opération : l'historique du wallet se reconstitue sans tout recalculer. | de wallet garde une copie du solde après l'opération : on reconstitue l'historique sans tout recalculer. |

## 1.3 Quatre access patterns, par priorité (fréquence × criticité)

La fréquence est une hypothèse de conception, à rapprocher de la Partie 0.

| Rang | Access pattern | Pourquoi |
|---|---|---|
| 1 | Exécuter un virement : lire deux wallets, écrire la transaction, 2 lignes de ledger et l'outbox | Cœur du service (pic cible 1 200 tx/s), argent, critique. |
| 2 | Retrouver une transaction par `idempotencyKey` | Chaque virement et chaque rejeu y passe : c'est ce qui empêche le doublon. |
| 3 | Historique d'un wallet trié par date | Lecture la plus fréquente côté clients. |
| 4 | Transactions d'un marchand sur une période | Règlement et chiffre d'affaires des marchands. |

## 1.4 Anti-pattern évité : le ledger embarqué dans le wallet

Mettre les lignes de ledger dans un tableau du wallet. Mesuré (`01-validator-rejet.txt` et `01-mesures-modelisation.txt`) : 35,94 lignes par wallet en moyenne (maximum 390), 4 831 octets en moyenne (maximum 52 346 octets), 134,4 octets par ligne. Le document wallet grossirait à chaque virement et serait réécrit en entier, alors que c'est la zone la plus modifiée. Un document est limité à 16 Mo, soit environ 125 000 lignes à 134 octets ; le wallet le plus actif en a déjà 390 sur six mois de données. Décision : ledger séparé, relié par `walletId`. L'extrapolation à la cible de 18 mois relève de la Partie 0.

## 1.5 Partie double, montants entiers, solde en cache

Chaque mouvement écrit au moins deux lignes de même total (un débit, un crédit). Mesuré : sur les 56 484 transactions qui ont un ledger, 0 est déséquilibrée ; total des crédits = total des débits = 1 955 479 314. Les 3 516 transactions FAILED ou PENDING n'ont aucune ligne (56 484 + 3 516 = 60 000).

Les montants sont des entiers en FCFA : pas d'arrondi, un franc ne se divise pas.

Le solde stocké dans `wallets.balance` est un cache du ledger : la vérité est la somme signée des lignes du wallet. Le cache évite de recalculer à chaque lecture. Conséquence : cache et ledger doivent changer ensemble, dans une même transaction multi-documents (Partie 4) ; sinon ils divergent, ce que l'enquête E1 mesure.

Les 70 054 lignes `walletId: null` (champ `account`, valeurs `FEES`, `FLOAT`, `BILLER`, `MERCHANT:…`) sont la contrepartie de l'argent qui ne passe pas par un wallet. Le validateur les accepte.

## 1.6 ADR-001

Voir `adr/ADR-001.md` : « Un transfert écrit combien de documents ? ».