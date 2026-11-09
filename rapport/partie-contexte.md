# 1. Contexte et problématique

## Mon jeu de données (groupe 07)
Paramètres : 2000 clients, 150 marchands, 60 000 transactions, du 2026-01-01 sur 181 jours. Empreinte du jeu (`datasetSha256`, début) : `9b0b9a40…`.

| Grandeur | Attendu (`fingerprint.json`) | Obtenu (`preuves/00-fingerprint.txt`) |
|---|---|---|
| customers | 2000 | 2000 |
| wallets | 2000 | 2000 |
| merchants | 150 | 150 |
| transactions | 60000 | 60000 |
| ledger_entries | 141939 | 141939 |
| somme de tous les `amount` des transactions | 2 018 172 375 | 2 018 172 375 |
| somme des `amount` des transactions COMPLETED | 1 946 303 325 | 1 946 303 325 |
| somme des `balance` des wallets | 832 251 836 | 832 251 836 |

Les cinq empreintes SHA-256 complètes des fichiers NDJSON sont conformes à `fingerprint.json` (`preuves/00-fingerprint.txt`). Les types ont été vérifiés après l'import (`preuves/00-types.txt`) : montants en `int`, dates en `date`, seul `feePct` en `double` (un pourcentage).

## Mon environnement
Windows, Docker 29.8.0, MongoDB 8.0.34 (image `mongo:8.0`), mongosh 2.14.0. Mémoire visible par Docker : 8 170 151 936 octets (environ 8,17 Go). Replica Set `rs0` à un nœud, PRIMARY (`preuves/00-rs-status-1-noeud.txt`). Commandes complètes en annexe B.

## Pourquoi un Replica Set, même à un nœud
Les transactions multi-documents (Partie 4) n'existent que sur un Replica Set : elles s'appuient sur l'oplog. Un serveur MongoDB seul les refuse. Le mode Replica Set est donc obligatoire dès les parties 0 à 4, même avec un seul membre (`writeMajorityCount: 1`, donc `w: "majority"` équivaut ici à `w: 1`).