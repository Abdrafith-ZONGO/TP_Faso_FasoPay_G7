# Index des preuves

> Une ligne par fichier de `preuves/` : ce qu'il démontre et dans quelle partie du rapport il est cité. Chaque preuve contient la commande exacte, la date (`date -u`) et la sortie **brute**.

| Fichier | Ce qu'il démontre | Partie |
|---|---|---|
| `00-rs-status-1-noeud.txt` | `rs.status()` : serveur MongoDB 8.0.34 en Replica Set `rs0` à un nœud, état PRIMARY (`myState: 1`) | D1 (section 1 du rapport) |
| `00-import-comptages.txt` | comptages des 5 collections importées dans `fasopay_tp` : 60000 transactions, 2000 customers, 141939 ledger_entries, 150 merchants, 2000 wallets | D2 (section 1 du rapport) |
| `00-fingerprint.txt` | vérification D3 : comptages, trois sommes et cinq empreintes SHA-256 complètes, tous conformes à `fingerprint.json` | D3 (section 1 du rapport) |
| `00-collections.txt` | `getCollectionNames()` : les 7 collections, dont `outbox` et `fraud_alerts` créées vides | D4 (section 1 du rapport) |
| `00-types.txt` | vérification `$type` après import : montants en entiers, dates en vraies dates BSON, seul `feePct` en `double` (un pourcentage) | D2, vérification des types |
| `01-validator-rejet.txt` | 6 validateurs `$jsonSchema` (strict / error) : 0 document invalide dans mes données (2000, 2000, 150, 60000, 141939, 0), un document invalide rejeté par collection (code 121, détail `errInfo`), comptages inchangés, mesure de l'anti-pattern (35,94 lignes et 4 831 octets de ledger par wallet en moyenne ; maximum 390 lignes et 52 346 octets) | Partie 1 |
| `01-mesures-modelisation.txt` | mesures pour la modélisation : 1 wallet par client, 2 à 6 lignes de ledger par transaction, 56484 transactions avec ledger (3516 FAILED/PENDING sans), 0 transaction déséquilibrée, crédits = débits = 1955479314, transactions par wallet et par marchand, 134,4 octets par ligne de ledger | Partie 1 |
| `02-enquete.txt` | enquête de la Partie 2 : E1 : 6 wallets sur 2000 dont `balance` ≠ somme signée du ledger (écart net −69000, écart absolu 138000), total du ledger signé 832320836 contre 832251836 pour les soldes (`walletsBalanceTotal`) ; E2, E3, E4 à venir | Partie 2 |
