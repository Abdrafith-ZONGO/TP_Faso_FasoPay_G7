# Journal de montage - TP FasoPay G7

Ce journal liste, dans l'ordre, les commandes qui construisent nos environnements.
Pour chaque commande : à quoi elle sert, puis la commande exacte telle que tapée.

Environnement : Windows, PowerShell. Les commandes sont exécutées depuis la racine du projet

## 1. Environnement de départ

Objectif : relever les versions des outils et la mémoire totale visible par Docker.

Version de Git :

```powershell
git --version
```

Résultat : git version 2.56.0.windows.1

Version de Docker :

```powershell
docker --version
```

Résultat : Docker version 29.8.0, build 88096ef

Mémoire totale visible par Docker, en octets :

```powershell
docker info --format "{{.MemTotal}}"
```

Résultat : 8170151936 octets (environ 8,17 Go). Cette mémoire totale visible par Docker sera prise en compte pour évaluer la faisabilité du cluster shardé à cinq conteneurs.

Version de MongoDB : voir la section 3 (serveur 8.0.34, shell `mongosh` 2.14.0).

## 2. Données du groupe et vérification

Objectif : placer les fichiers fournis par l'enseignant dans `data/`, puis s'assurer qu'ils sont intacts avant tout import.

Copie manuelle (sans commande) dans le dossier `data/` des 7 fichiers de l'archive du groupe 07 : `customers.ndjson`, `wallets.ndjson`, `merchants.ndjson`, `transactions.ndjson`, `ledger_entries.ndjson`, `fingerprint.json` et `LISEZMOI.txt`. Ces fichiers ne sont jamais modifiés.

Vérification : la commande calcule l'empreinte SHA-256 de chaque fichier NDJSON (8 premiers caractères affichés) et sa taille en octets.

```powershell
Get-ChildItem data\*.ndjson | ForEach-Object {
    "{0}  {1}  {2}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower().Substring(0,8), $_.Name, $_.Length
}
```

Résultat obtenu :

```
1bd39553  customers.ndjson  346207
c1f3a8dd  ledger_entries.ndjson  22763517
4079632f  merchants.ndjson  34094
494012ce  transactions.ndjson  18083557
9a7db7ee  wallets.ndjson  349574
```

Comparaison avec `fingerprint.json` :

| Fichier | Empreinte attendue | Obtenue | Octets attendus | Obtenus |
|---|---|---|---|---|
| customers.ndjson | 1bd39553 | 1bd39553 | 346207 | 346207 |
| wallets.ndjson | 9a7db7ee | 9a7db7ee | 349574 | 349574 |
| merchants.ndjson | 4079632f | 4079632f | 34094 | 34094 |
| transactions.ndjson | 494012ce | 494012ce | 18083557 | 18083557 |
| ledger_entries.ndjson | c1f3a8dd | c1f3a8dd | 22763517 | 22763517 |

Conclusion : les tailles et les huit premiers caractères des empreintes SHA-256 des cinq fichiers NDJSON correspondent aux valeurs indiquées dans `fingerprint.json`.

Note : ce contrôle préliminaire permet de s'assurer que les fichiers fournis n'ont pas été altérés avant leur importation. La vérification complète D3 portera sur les comptages, les sommes des montants et les empreintes SHA-256 complètes. Les résultats seront enregistrés dans `preuves/00-fingerprint.txt`.

## 3. Serveur MongoDB (D1)

Objectif : démarrer un serveur MongoDB 8.0 dans Docker, en mode Replica Set (`--replSet rs0`). Ce mode est obligatoire même avec un seul nœud, car les transactions multi-documents (partie 4) n'existent que sur un Replica Set. Version 8.0 choisie parmi les versions autorisées (7 ou 8).

```powershell
docker run -d --name mongo-rs1 -p 27017:27017 -v mongo-rs1-data:/data/db mongo:8.0 --replSet rs0
```

Rôle de chaque morceau :

| Morceau | Rôle |
|---|---|
| `docker run -d` | lance un conteneur en arrière-plan |
| `--name mongo-rs1` | nom du conteneur, pour le retrouver ensuite |
| `-p 27017:27017` | rend le serveur accessible depuis la machine hôte |
| `-v mongo-rs1-data:/data/db` | volume qui conserve les données si le conteneur est supprimé |
| `mongo:8.0` | image et version de MongoDB |
| `--replSet rs0` | démarre MongoDB en mode Replica Set, nommé `rs0` |

Résultat : l'image `mongo:8.0` n'était pas présente en local, Docker l'a téléchargée (digest `sha256:b9924c33...`), puis le conteneur `mongo-rs1` a démarré. Identifiant du conteneur affiché : `3bd3f8698595...`.

État : le serveur est démarré en mode Replica Set, mais le Replica Set n'est pas encore initialisé. L'initialisation (`rs.initiate`) fait l'objet de la section suivante.

Versions de MongoDB, relevées une fois le conteneur démarré :

Version du serveur :

```powershell
docker exec mongo-rs1 mongod --version
```

Résultat : `db version v8.0.34` (build `51db4515a6597aedcf6188ee4e48a27e65b065ae`, OpenSSL 3.0.13, Ubuntu 24.04, x86_64). L'étiquette `mongo:8.0` correspond donc à la version 8.0.34.

Version du shell :

```powershell
docker exec mongo-rs1 mongosh --version
```

Résultat : `2.14.0`

## 4. Initialisation du Replica Set (D1)

Objectif : transformer le serveur démarré à l'étape précédente en Replica Set `rs0` à un seul membre. Tant que cette commande n'est pas passée, le serveur refuse les transactions. La commande utilise le `mongosh` déjà présent dans le conteneur.

```powershell
docker exec mongo-rs1 mongosh --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]})"
```

Rôle de chaque morceau :

| Morceau | Rôle |
|---|---|
| `docker exec mongo-rs1` | exécute une commande dans le conteneur `mongo-rs1` |
| `mongosh --eval "..."` | lance le shell MongoDB et exécute l'instruction donnée |
| `rs.initiate(...)` | crée le Replica Set |
| `_id: 'rs0'` | nom du Replica Set, identique à `--replSet rs0` de l'étape 3 |
| `members: [{_id: 0, host: 'localhost:27017'}]` | un seul membre, qui s'annonce sous l'adresse `localhost:27017` |

Choix de l'adresse localhost:27017 : cette adresse permet à notre machine hôte de joindre le membre grâce à la publication du port 27017. Cette configuration convient à notre environnement mono-nœud actuel. Pour un Replica Set réparti sur plusieurs conteneurs, il faudra utiliser des adresses réseau accessibles et résolubles par les clients MongoDB.

Résultat : `ok: 1`, le Replica Set `rs0` est créé.

## 5. Vérification du Replica Set (D1)

Objectif : confirmer que le serveur est bien devenu PRIMARY du Replica Set `rs0`. Cette commande ne modifie rien, elle demande seulement l'état au serveur.

```powershell
docker exec mongo-rs1 mongosh --eval "rs.status()"
```

Résultat : `set: 'rs0'`, `myState: 1`, un seul membre `localhost:27017` à l'état `PRIMARY`. Le serveur est prêt à accepter des écritures.

Remarque : `writeMajorityCount: 1`, donc sur un nœud unique `w: "majority"` équivaut à `w: 1`.

### Preuve D1

Objectif : garder la sortie complète de `rs.status()` dans un fichier de preuve, `preuves/00-rs-status-1-noeud.txt`. Il est écrit à la main et contient, dans cet ordre, la commande exacte, la date en UTC, puis la sortie brute.

Commande de la date (exécutée dans le conteneur, car PowerShell ne connaît pas `date -u`) :

```powershell
docker exec mongo-rs1 date -u
```

Commande de l'état du Replica Set (même commande que ci-dessus) :

```powershell
docker exec mongo-rs1 mongosh --eval "rs.status()"
```
Résultat : preuve enregistrée dans `preuves/00-rs-status-1-noeud.txt` (commande, date `Sat Nov  7 19:38:40 UTC 2026`, sortie brute montrant `set: 'rs0'`, `myState: 1` et un membre `PRIMARY`).


## 6. Copie des données dans le conteneur (D2)

Objectif : `mongoimport` s'exécute dans le conteneur `mongo-rs1`, qui ne voit pas les fichiers de notre machine. On copie donc le dossier `data` dans le conteneur, à l'emplacement `/tmp/data`. Les fichiers d'origine ne sont pas modifiés.

```powershell
docker cp data mongo-rs1:/tmp/data
```

Rôle de chaque morceau :

| Morceau | Rôle |
|---|---|
| `docker cp` | copie des fichiers entre notre machine et un conteneur |
| `data` | dossier source, sur notre machine |
| `mongo-rs1:/tmp/data` | destination : le dossier `/tmp/data` dans le conteneur `mongo-rs1` |

Résultat : `Successfully copied 41.6MB (transferred 41.6MB) to mongo-rs1:/tmp/data`. Les fichiers sont maintenant dans le conteneur, dans `/tmp/data`.

## 7. Import des collections (D2)

Objectif : importer les cinq fichiers NDJSON dans la base `fasopay_tp`, une collection par fichier, avec `mongoimport` (outil d'import fourni dans le conteneur). Les dates sont représentées dans les fichiers au format JSON étendu de MongoDB (`{"$date": ...}`). Leur conversion en véritables dates BSON sera vérifiée après l'importation. L'importation est effectuée une seule fois, sans option `--drop`, afin d'éviter toute suppression ou réimportation accidentelle des données.

Première collection, `customers` :

```powershell
docker exec mongo-rs1 mongoimport --db fasopay_tp --collection customers --file /tmp/data/customers.ndjson
```

Rôle de chaque morceau :

| Morceau | Rôle |
|---|---|
| `docker exec mongo-rs1` | exécute la commande dans le conteneur |
| `mongoimport` | outil qui lit un fichier et insère ses documents dans MongoDB |
| `--db fasopay_tp` | base de destination |
| `--collection customers` | collection de destination |
| `--file /tmp/data/customers.ndjson` | fichier source, un document JSON par ligne |

Résultat : `customers` : 2000 documents importés, 0 échec.

Deuxième collection, `wallets` :

```powershell
docker exec mongo-rs1 mongoimport --db fasopay_tp --collection wallets --file /tmp/data/wallets.ndjson
```

Même commande que pour `customers`, seuls la collection et le fichier changent.

Résultat : `wallets` : 2000 documents importés, 0 échec.

Troisième collection, `merchants` :

```powershell
docker exec mongo-rs1 mongoimport --db fasopay_tp --collection merchants --file /tmp/data/merchants.ndjson
```
Résultat : `merchants` : 150 documents importés, 0 échec.

Quatrième collection, `transactions` :

```powershell
docker exec mongo-rs1 mongoimport --db fasopay_tp --collection transactions --file /tmp/data/transactions.ndjson
```
Résultat : `transactions` : 60000 documents importés, 0 échec.

Cinquième collection, `ledger_entries` :

```powershell
docker exec mongo-rs1 mongoimport --db fasopay_tp --collection ledger_entries --file /tmp/data/ledger_entries.ndjson
```
Résultat : `ledger_entries` : 141939 documents importés, 0 échec.

Les cinq importations se sont terminées sans erreur. Les nombres de documents seront vérifiés directement dans MongoDB à l'étape suivante.

## 8. Comptage des collections (preuve D2)

Objectif : vérifier, dans la base elle-même, que les cinq collections sont présentes et que leurs nombres de documents correspondent aux comptages indiqués dans `fingerprint.json`. La commande liste les collections de `fasopay_tp` et affiche, pour chacune, son nombre de documents. La comparaison avec le fingerprint est effectuée séparément.

```powershell
docker exec mongo-rs1 mongosh fasopay_tp --quiet --eval "db.getCollectionNames().forEach(function(c){ print(c + ' : ' + db[c].countDocuments()) })"
```

Rôle de chaque morceau :

| Morceau | Rôle |
|---|---|
| `mongosh fasopay_tp` | ouvre le shell MongoDB directement sur la base `fasopay_tp` |
| `--quiet` | n'affiche pas les messages de démarrage |
| `db.getCollectionNames()` | donne la liste des collections de la base |
| `.forEach(function(c){ ... })` | répète l'instruction pour chaque collection `c` |
| `db[c].countDocuments()` | compte les documents de la collection `c` |
| `print(c + ' : ' + ...)` | affiche le nom de la collection puis son nombre |

Résultat : les cinq collections sont présentes et les nombres de documents obtenus correspondent aux comptages indiqués dans `fingerprint.json`.

### Preuve D2

Objectif : garder les comptages dans un fichier de preuve, `preuves/00-import-comptages.txt`, écrit à la main avec, dans cet ordre, la commande exacte, la date en UTC, puis la sortie brute.

Date en UTC :

```powershell
docker exec mongo-rs1 date -u
```

Comptage des collections (même commande qu'à la section 8) :

```powershell
docker exec mongo-rs1 mongosh fasopay_tp --quiet --eval "db.getCollectionNames().forEach(function(c){ print(c + ' : ' + db[c].countDocuments()) })"
```

Résultat : preuve enregistrée dans `preuves/00-import-comptages.txt` (commande, date `Sat Nov  7 19:54:23 UTC 2026`, 5 comptages conformes au fingerprint).

## 9. Vérification des données (D3)

Objectif : s'assurer que les données importées dans MongoDB correspondent exactement au fichier `fingerprint.json`, en vérifiant d'abord les sommes, puis les empreintes SHA-256 des fichiers.

### 9.1. Somme totale des transactions

Objectif : vérifier que la somme totale de tous les montants dans la collection `transactions` correspond au chiffre `transactionsAmountAll` du fichier `fingerprint.json` (valeur attendue : 2 018 172 375).

Commande :

```powershell
docker exec mongo-rs1 mongosh fasopay_tp --quiet --eval "db.transactions.aggregate([{`$group:{_id:null, total:{`$sum:'`$amount'}}}]).toArray()"
```
Résultat : `[ { _id: null, total: 2018172375 } ]`. Cette valeur correspond exactement au chiffre `transactionsAmountAll` du fichier `fingerprint.json` (2 018 172 375).

### 9.2. Somme des transactions COMPLETED

Objectif : vérifier que la somme des montants des transactions dont le statut est "COMPLETED" correspond au chiffre `transactionsAmountCompleted` du fichier `fingerprint.json` (valeur attendue : 1 946 303 325).

Commande :

```powershell
docker exec mongo-rs1 mongosh fasopay_tp --quiet --eval "db.transactions.aggregate([{`$match:{status:'COMPLETED'}},{`$group:{_id:null, total:{`$sum:'`$amount'}}}]).toArray()"
```

Résultat : [ { _id: null, total: 1946303325 } ]. Cette valeur correspond exactement au chiffre transactionsAmountCompleted du fichier fingerprint.json (1 946 303 325).

### 9.3. Somme des balances des wallets

Objectif : vérifier que la somme de tous les soldes (`balance`) dans la collection `wallets` correspond au chiffre `walletsBalanceTotal` du fichier `fingerprint.json` (valeur attendue : 832 251 836).

Commande :

```powershell
docker exec mongo-rs1 mongosh fasopay_tp --quiet --eval "db.wallets.aggregate([{`$group:{_id:null, total:{`$sum:'`$balance'}}}]).toArray()"
```

Résultat : `[ { _id: null, total: 832251836 } ]`. Cette valeur correspond exactement au chiffre `walletsBalanceTotal` du fichier `fingerprint.json` (832 251 836).

Conclusion : les trois sommes (total des transactions, total des transactions COMPLETED, total des balances) correspondent exactement aux valeurs du fichier `fingerprint.json`. Les données importées sont donc intègres.

### 9.4. Empreintes SHA-256 complètes des fichiers

Objectif : vérifier que les empreintes SHA-256 complètes (64 caractères) des cinq fichiers NDJSON correspondent à celles du fichier `fingerprint.json`.

Commande :

```powershell
Get-ChildItem data\*.ndjson | ForEach-Object { "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name }
```

Résultat obtenu :

```
1bd39553378f7095db29ed2f3a37b039e9d2008a4766f9c658115275b6e06b3f  customers.ndjson
c1f3a8dd43a029cb894932428a2b35ec5fd4e5b75170a98e01660cf5fcf4d35b  ledger_entries.ndjson
4079632f6d721f8d2555a78c32cf9e00d647dbf962853c32b7fd71fdb467a5ef  merchants.ndjson
494012cecd387263210d698bee264a9fe43d0bcd28088b8aecf2ade34c1a4f1d  transactions.ndjson
9a7db7ee92a5f95577fe9fad3bfbd8010bd72c94a2f4ba1f3efdfd6a78467d43  wallets.ndjson
```

Comparaison avec `fingerprint.json` :

| Fichier | Empreinte attendue | Empreinte obtenue | Statut |
|---|---|---|---|
| customers.ndjson | 1bd39553...b6e06b3f | 1bd39553...b6e06b3f | Conforme |
| ledger_entries.ndjson | c1f3a8dd...f5fcf4d35b | c1f3a8dd...f5fcf4d35b | Conforme |
| merchants.ndjson | 4079632f...fdb467a5ef | 4079632f...fdb467a5ef | Conforme |
| transactions.ndjson | 494012ce...e34c1a4f1d | 494012ce...e34c1a4f1d | Conforme |
| wallets.ndjson | 9a7db7ee...6a78467d43 | 9a7db7ee...6a78467d43 | Conforme |

Conclusion : les trois sommes et les cinq empreintes SHA-256 complètes correspondent exactement aux valeurs du fichier `fingerprint.json`. La vérification D3 est terminée et validée.

### 9.5. Preuve D3

Objectif : garder la vérification D3 dans un fichier de preuve, `preuves/00-fingerprint.txt`. Pour chaque commande, le fichier contient la commande exacte, la date en UTC relevée juste avant, puis la sortie brute. La preuve a été refaite le 8 novembre 2026 : les commandes en lecture seule (comptages, trois sommes, empreintes) ont été relancées une par une, chacune avec sa propre date.

Date en UTC, relevée avant chaque commande :

```powershell
docker exec mongo-rs1 date -u
```

Résultat : preuve enregistrée dans `preuves/00-fingerprint.txt` : les 7 comptages (les cinq collections de données conformes au fingerprint, `outbox` et `fraud_alerts` à 0), les trois sommes (2018172375, 1946303325 et 832251836) et les cinq empreintes SHA-256 complètes, tous conformes à `fingerprint.json`. Dates relevées entre `Sun Nov  8 13:36:28 UTC 2026` et `Sun Nov  8 13:40:29 UTC 2026`.

## 10. Création des collections vides (D4)

Objectif : créer les deux collections vides `outbox` et `fraud_alerts` dans la base `fasopay_tp`, puis vérifier leur présence.

Commande :

```powershell
docker exec mongo-rs1 mongosh fasopay_tp --quiet --eval "db.createCollection('outbox')"
docker exec mongo-rs1 mongosh fasopay_tp --quiet --eval "db.createCollection('fraud_alerts')"

docker exec mongo-rs1 mongosh fasopay_tp --quiet --eval "db.getCollectionNames().sort()"
```
Résultat :

Création de `outbox` : `{ ok: 1 }`
Création de `fraud_alerts` : `{ ok: 1 }`
Liste des collections :

```
[
  'customers',
  'fraud_alerts',
  'ledger_entries',
  'merchants',
  'outbox',
  'transactions',
  'wallets'
]
```

Conclusion : les deux collections `outbox` et `fraud_alerts` sont présentes et vides. La base `fasopay_tp` contient désormais les 5 collections de données et les 2 collections de traitement exigées.

### Preuve D4

Objectif : garder dans `preuves/00-collections.txt` la liste des collections renvoyée par `getCollectionNames()`, qui est la preuve attendue pour D4. Le fichier contient la commande exacte, la date en UTC relevée juste avant, puis la sortie brute. Les deux créations de la section 10 avaient été exécutées plus tôt et ne sont pas rejouées : leurs résultats sont dans cette section.

Résultat : preuve enregistrée dans `preuves/00-collections.txt` (date `Sun Nov  8 13:43:07 UTC 2026`, liste des 7 collections dont `outbox` et `fraud_alerts`).

## 11. Vérification des types après l'import

Objectif : vérifier que, dans nos collections, les montants sont des entiers et les dates de vraies dates BSON, et non des chaînes ou des nombres à virgule. On ouvre une session `mongosh` sur la base `fasopay_tp`, qui reste ouverte pendant qu'on tape les requêtes, puis on interroge le type réellement stocké avec `$type`.

Ouverture de la session, après avoir relevé la date avec `docker exec mongo-rs1 date -u` :

```powershell
docker exec -it mongo-rs1 mongosh fasopay_tp
```

Rôle de chaque morceau :

| Morceau | Rôle |
|---|---|
| `docker exec` | exécute une commande dans le conteneur `mongo-rs1` |
| `-it` | garde la session ouverte et interactive |
| `mongosh fasopay_tp` | ouvre le shell MongoDB directement sur la base `fasopay_tp` |


Requêtes tapées dans la session, une par collection :

```js
db.transactions.aggregate([{$group: {_id: {amount: {$type: "$amount"}, createdAt: {$type: "$createdAt"}}, n: {$sum: 1}}}])
db.transactions.aggregate([{$group: {_id: {fee: {$type: "$fee"}, completedAt: {$type: "$completedAt"}}, n: {$sum: 1}}}])
db.wallets.aggregate([{$group: {_id: {balance: {$type: "$balance"}, dailyLimit: {$type: "$dailyLimit"}, version: {$type: "$version"}, updatedAt: {$type: "$updatedAt"}}, n: {$sum: 1}}}])
db.ledger_entries.aggregate([{$group: {_id: {amount: {$type: "$amount"}, balanceAfter: {$type: "$balanceAfter"}, walletId: {$type: "$walletId"}, createdAt: {$type: "$createdAt"}}, n: {$sum: 1}}}])
db.customers.aggregate([{$group: {_id: {kycLevel: {$type: "$kycLevel"}, createdAt: {$type: "$createdAt"}}, n: {$sum: 1}}}])
db.merchants.aggregate([{$group: {_id: {mcc: {$type: "$mcc"}, feePct: {$type: "$feePct"}, location: {$type: "$location"}, createdAt: {$type: "$createdAt"}}, n: {$sum: 1}}}])
```

Chaque requête regroupe les documents selon le type BSON réellement stocké dans les champs contrôlés et compte chaque groupe. La valeur `missing` désigne un champ absent du document.

Résultats :

| Collection | Champs contrôlés | Résultat |
|---|---|---|
| `transactions` | `amount`, `createdAt` | `int` et `date` pour 60000 documents |
| `transactions` | `fee` | `int` pour 60000 documents |
| `transactions` | `completedAt` | `date` pour 56484 documents, absent pour 3516 (transactions `FAILED` et `PENDING`) |
| `wallets` | `balance`, `dailyLimit`, `version` | `int` pour 2000 documents |
| `wallets` | `updatedAt` | `date` pour 2000 documents |
| `ledger_entries` | `amount`, `createdAt` | `int` et `date` pour 141939 documents |
| `ledger_entries` | `walletId`, `balanceAfter` | 71885 jambes avec `walletId` en chaîne et `balanceAfter` en `int` ; 70054 jambes avec `walletId` à `null` et sans `balanceAfter` |
| `customers` | `kycLevel`, `createdAt` | `int` et `date` pour 2000 documents |
| `merchants` | `mcc`, `location`, `createdAt` | `int`, `object` et `date` pour 150 documents |
| `merchants` | `feePct` | `double` pour 150 documents |

Conclusion : aucun montant en FCFA n'est stocké en `double` ni en chaîne, et aucune date n'est une chaîne. Le seul `double` est `feePct`, un pourcentage de commission et non un montant. Les 70054 jambes de ledger sans wallet (`walletId: null`, champ `account`) existent bien : le validateur de la partie 1 devra les accepter.

Résultat : preuve enregistrée dans `preuves/00-types.txt` (une session, date relevée par `date -u` avant l'ouverture : `Sun Nov  8 21:46:44 UTC 2026`).

Remarque : dans la sortie brute conservée, la requête `merchants` s'affiche avec `{$typ$type: "$location"}`. La requête tapée était `{$type: "$location"}` et le serveur a renvoyé un résultat valide (`location: 'object'`).

## 12. Validateurs de la Partie 1

Objectif : appliquer un validateur `$jsonSchema` (`validationLevel: "strict"`, `validationAction: "error"`) aux six collections de données et de traitement (`customers`, `wallets`, `merchants`, `transactions`, `ledger_entries`, `outbox`), puis vérifier que nos données le passent.

Après avoir relevé la date avec `docker exec mongo-rs1 date -u`, ouverture de la session :

```powershell
docker exec -it mongo-rs1 mongosh fasopay_tp
```

Les commandes tapées dans la session (briques, six `collMod`, vérifications, tests de rejet, mesure) sont rangées dans `code/01-validateurs.js`.

Résultat : les six `collMod` répondent `ok: 1`, les options relues sont `strict / error` six fois, 0 document invalide dans nos données, un document invalide rejeté par collection (code 121). Preuve enregistrée dans `preuves/01-validator-rejet.txt` (date `Sun Nov  8 22:23:56 UTC 2026`).

Remarque : dans la sortie brute conservée, certains mots s'affichent déformés (par exemple `fafalse`, `$j$jsonSchema`). C'est un défaut d'affichage du terminal : les commandes tapées étaient correctes et les validateurs enregistrés par le serveur fonctionnent, comme le montrent les rejets. De même, le terminal affiche `code 121 undefined` : 121 est le code `DocumentValidationFailure`, seul son nom n'est pas affiché par mongosh.

## 13. Mesures pour la modélisation (Partie 1)

Objectif : mesurer sur nos données les chiffres qui justifient les choix de modélisation (wallets par client, lignes de ledger par transaction, partie double, transactions par wallet et par marchand, taille d'une ligne de ledger). Aucune donnée n'est modifiée : ce sont des lectures.

Après avoir relevé la date avec `docker exec mongo-rs1 date -u`, ouverture de la session :

```powershell
docker exec -it mongo-rs1 mongosh fasopay_tp
```

Les requêtes tapées dans la session sont rangées dans `code/01-mesures-modelisation.js`.

Résultat : 1 wallet par client (2000 clients) ; 2 à 6 lignes de ledger par transaction ; 56484 transactions avec ledger et 3516 FAILED ou PENDING sans ligne ; 0 transaction déséquilibrée ; total des crédits = total des débits = 1955479314 ; 23,98 transactions émises par wallet en moyenne (maximum 319) ; 150 marchands (maximum 4479 paiements) ; 21 transactions avec tentatives ; 134,4 octets en moyenne par ligne de ledger. Preuve enregistrée dans `preuves/01-mesures-modelisation.txt` (date `Sun Nov  8 23:01:03 UTC 2026`).

Remarque : dans la sortie brute conservée, certains mots s'affichent déformés (par exemple `$co$cond`). C'est un défaut d'affichage du terminal : les requêtes tapées étaient correctes et les résultats sont valides.

## 14. Enquête (Partie 2)

### 14.1 E1 : wallets dont le solde diffère du ledger

Objectif : trouver les wallets dont `balance` diffère de la somme signée de leurs lignes de ledger (crédits en plus, débits en moins), compter ces wallets et mesurer l'écart total. La jointure se fait par `walletId`. Ce sont des lectures : aucune donnée n'est modifiée.

Après avoir relevé la date avec `docker exec mongo-rs1 date -u`, ouverture de la session :

```powershell
docker exec -it mongo-rs1 mongosh fasopay_tp
```

Les requêtes tapées dans la session sont rangées, commentées, dans `code/02-enquete.js`.

Résultat : 6 wallets sur 2000 ont un solde différent du ledger ; écart net −69000, écart absolu 138000 (écart = balance moins ledger). Le ledger signé totalise 832320836 pour les wallets, contre 832251836 pour les soldes (`walletsBalanceTotal` du fingerprint) : la différence est 69000. Pour ces 6 wallets, la dernière valeur `balanceAfter` du ledger est égale à la somme du ledger. Preuve enregistrée dans `preuves/02-enquete.txt` (bloc E1, date `Sun Nov  8 23:27:03 UTC 2026`).

Remarque : dans la sortie brute conservée, certains mots s'affichent déformés dans l'écho des commandes (par exemple `$co$cond`, `liglignes`, `$$count`). C'est un défaut d'affichage du terminal : les requêtes tapées étaient correctes et les résultats portent les bons noms de champs.