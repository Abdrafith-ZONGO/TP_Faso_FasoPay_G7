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

### 13.1 Complément : annulations et écriture inverse

Objectif : vérifier comment nos données représentent une annulation. Les transactions à 4 et 6 lignes de ledger sont-elles les transactions `REVERSED`, et leurs lignes d'origine sont-elles conservées, avec des lignes inverses ajoutées ? Ce sont des lectures : aucune donnée n'est modifiée.

Après avoir relevé la date avec `docker exec mongo-rs1 date -u`, ouverture de la session :

```powershell
docker exec -it mongo-rs1 mongosh fasopay_tp
```

Les requêtes tapées dans la session sont rangées, commentées, dans `code/01-mesures-modelisation.js` (bloc Complément).

Résultat : 280 transactions `REVERSED` ; les transactions à 4 lignes (121) et à 6 lignes (159) sont toutes `REVERSED`, et aucun autre statut n'a 4 ou 6 lignes. Exemple T0002044 (paiement marchand de 9325 FCFA, frais 196) : les 3 lignes d'origine (débit du wallet W000344, crédit du marchand M00044 de 9129, crédit des frais de 196) sont conservées, puis 3 lignes inverses de mêmes montants sont ajoutées 38 secondes plus tard ; le solde du wallet passe de 171400 à 180725 (+9325). Preuve : dernier bloc de `preuves/01-mesures-modelisation.txt` (date `Mon Nov  9 19:15:21 UTC 2026`).

Remarque : dans la sortie brute conservée, l'écho des commandes affiche `ffrom` et `creacreatedAt` ; c'est le défaut d'affichage habituel du terminal, les résultats sont corrects.

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

### 14.2 E2 : clients qui découpent leurs transferts sous le plafond

Objectif : repérer les wallets qui contournent leur plafond journalier `dailyLimit` en découpant leurs sorties d'argent en plusieurs transactions juste en dessous. Critère retenu : un wallet est suspect un jour donné (UTC) s'il émet au moins 3 transactions `COMPLETED` de type `P2P` ou `CASH_OUT`, chacune comprise entre 90 % et 100 % de son plafond. Ce sont des lectures : aucune donnée n'est modifiée.

Après avoir relevé la date avec `docker exec mongo-rs1 date -u`, ouverture de la session :

```powershell
docker exec -it mongo-rs1 mongosh fasopay_tp
```

Les requêtes tapées dans la session sont rangées, commentées, dans `code/02-enquete.js` (bloc E2) : couples wallet-jour suspects, résumé par wallet, identité des clients, cas détaillé de W000758 le 30 janvier 2026, puis trois contrôles de solidité du critère.

Résultat : 5 wallets (W000214, W000758, W001070, W001218, W001322) totalisent 23 couples wallet-jour suspects et 121 transactions. Cas détaillé : W000758 le 2026-01-30, 7 transactions entre 08:25 et 11:21 UTC, de 181850 à 191975, soit 1320325 pour un plafond de 200000. Contrôles : sur 46495 sorties, aucune ne dépasse le plafond à elle seule ; les 121 transactions comprises entre 90 % et 100 % du plafond, tous types et statuts confondus, sont 73 `P2P` et 48 `CASH_OUT`, toutes `COMPLETED`, et appartiennent aux mêmes 5 wallets ; avec un seuil de 50 % ou de 70 %, on retrouve les mêmes 5 wallets. Preuve enregistrée dans `preuves/02-enquete.txt` (bloc E2, date `Mon Nov  9 02:47:20 UTC 2026`).

Remarque : dans la sortie brute conservée, certains mots s'affichent déformés dans l'écho des commandes (par exemple `$g$gte`, `cucustomerId`, `$$lt`). C'est un défaut d'affichage du terminal : les requêtes tapées étaient correctes et les résultats portent les bons noms de champs.

### 14.3 E3 : marchands qui concentrent le CA (Pareto)

Objectif : mesurer la concentration du chiffre d'affaires par marchand et vérifier si le top 20 % des marchands fait 80 % du CA. Définition retenue : CA d'un marchand = somme des `amount` de ses transactions `MERCHANT_PAY` au statut `COMPLETED` (les `FAILED` et `PENDING` n'ont rien encaissé, les `REVERSED` sont des remboursements, et `fee` est la commission de FasoPay). Ce sont des lectures : aucune donnée n'est modifiée.

Après avoir relevé la date avec `docker exec mongo-rs1 date -u`, ouverture de la session :

```powershell
docker exec -it mongo-rs1 mongosh fasopay_tp
```

Les requêtes tapées dans la session sont rangées, commentées, dans `code/02-enquete.js` (bloc E3) : paiements marchands par statut, montants COMPLETED par type (rattachement au fingerprint), CA par marchand, dix premiers marchands, contrôle des CA distincts, courbe de Pareto.

Note : une première session E3 s'était arrêtée sur la requête de Pareto (erreur `$documentNumber must be specified with a top level sortBy expression with exactly one element`, tri sur deux champs). La session a été refaite en entier avec la requête corrigée (tri sur `ca` seul, après contrôle que les 150 CA sont distincts) ; seule la session refaite est conservée comme preuve.

Résultat : CA total 229050525 sur 16603 paiements COMPLETED et 150 marchands. Les montants COMPLETED par type totalisent 1946303325, soit `transactionsAmountCompleted` du fingerprint. Le marchand M00130 (École Paspanga) fait 62325425, soit 27,21 % du CA ; les 15 premiers marchands (10 %) font 72,55 % ; les 30 premiers (20 %) font 81,96 %. Preuve enregistrée dans `preuves/02-enquete.txt` (bloc E3, date `Mon Nov  9 03:12:03 UTC 2026`).

Remarque : dans la sortie brute conservée, certains mots s'affichent déformés dans l'écho des commandes (par exemple `$doc$documentNumber`, `docdocuments`, `$r$round`). C'est un défaut d'affichage du terminal : les requêtes tapées étaient correctes et les résultats portent les bons noms de champs.

### 14.4 E4 : clés d'idempotence rejouées et incident

Objectif : identifier les transactions dont la clé d'idempotence a été rejouée (tableau `attempts` : une tentative `PROCESSED`, puis des `REPLAYED`), mesurer les écarts de montant et de statut, et repérer un éventuel incident dans une fenêtre horaire. Ce sont des lectures : aucune donnée n'est modifiée.

Après avoir relevé la date avec `docker exec mongo-rs1 date -u`, ouverture de la session :

```powershell
docker exec -it mongo-rs1 mongosh fasopay_tp
```

Les requêtes tapées dans la session sont rangées, commentées, dans `code/02-enquete.js` (bloc E4) : une ligne par clé rejouée, totaux, tentatives par jour, fenêtre exacte et répartition horaire de l'incident, puis trois contrôles (unicité des clés, lignes de ledger des transactions rejouées, paiements marchands en double avec des clés différentes).

Résultat : 21 clés rejouées sur 60000, soit 86 tentatives dont 21 traitées et 65 rejeux. Chaque transaction rejouée a une seule tentative `PROCESSED` et un seul document, de statut `COMPLETED` : aucun écart de montant ou de statut. Les 60000 clés sont toutes uniques. Les 21 transactions ont 2 ou 3 lignes de ledger (8 et 13). Le contrôle des paiements marchands en double (même wallet, même marchand, même montant, moins de 10 minutes, clés différentes) ne renvoie aucun résultat. Incident le 2026-04-10, de 14:09:05.877 à 15:36:10.115 UTC (environ 87 minutes) : 10 clés, 46 tentatives dont 36 rejeux (15 tentatives à 14 h, 31 à 15 h), alors que les 11 autres jours en comptent une seule chacun. Le montant qui aurait été payé en double si chaque rejeu avait été exécuté est 633025 (dont 344775 le 10 avril). Preuve enregistrée dans `preuves/02-enquete.txt` (bloc E4, date `Mon Nov  9 03:20:39 UTC 2026`).

Remarque : dans la sortie brute conservée, certains mots s'affichent déformés dans l'écho des commandes (par exemple `amouamount`, `$$group`, `$e$eq`, `dedebut`, `rerejeux`). C'est un défaut d'affichage du terminal : les requêtes tapées étaient correctes et les résultats portent les bons noms de champs. La dernière requête (contrôle des doublons) n'affiche aucune ligne : aucun résultat.


### 14.5 Compléments de l'enquête

Objectif : trois vérifications ajoutées après relecture du cours. (1) Les dépôts d'ouverture du 2025-12-31 sont-ils dans le ledger ? (2) E2 et E4 regroupent par jour avec `$dateToString` sans fuseau : le résultat change-t-il avec `timezone: "Africa/Ouagadougou"` ? (3) Le contrôle des doublons de E4 a renvoyé 0 : détecte-t-il vraiment un doublon ? `fasopay_tp` n'est pas modifiée.

Après avoir relevé la date avec `docker exec mongo-rs1 date -u`, ouverture de la session :

```powershell
docker exec -it mongo-rs1 mongosh fasopay_tp
```

Pour le test de détection, les paiements marchands sont copiés dans une base jetable `fasopay_audit`, un faux doublon y est ajouté, puis la base est supprimée :

```js
db.transactions.aggregate([{ $match: { type: "MERCHANT_PAY" } }, { $out: { db: "fasopay_audit", coll: "paiements" } }])
db.getSiblingDB("fasopay_audit").dropDatabase()
```

Les requêtes tapées dans la session sont rangées, commentées, dans `code/02-enquete.js` (bloc Compléments).

Résultat : 2000 dépôts d'ouverture `CASH_IN` `COMPLETED` le 2025-12-31, un par wallet, pour 707172575 FCFA, avec 2000 crédits de wallet et 2000 débits hors wallet du même montant dans le ledger. Avec le fuseau `Africa/Ouagadougou`, E2 donne toujours 23 couples, 121 transactions et 5 wallets, et E4 les mêmes 12 jours (UTC+0). Le contrôle des doublons renvoie 0 résultat sur les 17989 paiements copiés, puis exactement 1 (`FAUX_DOUBLON`) après l'ajout d'un faux doublon une minute après T0003152 avec une autre clé. La base jetable est supprimée et les comptages de `fasopay_tp` sont inchangés. Preuve : dernier bloc de `preuves/02-enquete.txt` (date `Mon Nov  9 18:24:32 UTC 2026`).


## 15. Index et explain (Partie 3)

Objectif : mesurer avec `explain("executionStats")` trois requêtes critiques avant création d'index, créer les index, puis mesurer à nouveau. Les requêtes sont : Q1, les sorties `COMPLETED` d'un wallet sur une journée (contrôle du plafond journalier), Q2, la dernière ligne du ledger d'un wallet (rapprochement avec le solde), Q3, la recherche d'une transaction par `idempotencyKey`. La session mesure aussi le temps de la requête de CA (E3) sans index, pour justifier un index refusé.

Après avoir relevé la date avec `docker exec mongo-rs1 date -u`, ouverture de la session :

```powershell
docker exec -it mongo-rs1 mongosh fasopay_tp
```

Création des trois index, commandes exactes tapées dans la session :

```js
db.transactions.createIndex({ fromWalletId: 1, status: 1, createdAt: 1, amount: 1 }, { name: "idx_sorties_wallet_jour" })
db.ledger_entries.createIndex({ walletId: 1, createdAt: -1 }, { name: "idx_ledger_wallet_date" })
db.transactions.createIndex({ idempotencyKey: 1 }, { unique: true, name: "uniq_idempotency_key" })
```

Les requêtes, la fonction de résumé des `explain` et les commandes de mesure sont rangées, commentées, dans `code/03-index.js`.

Résultat : les trois index sont créés. Q1 passe de `COLLSCAN` (60000 documents lus) à `PROJECTION_COVERED > IXSCAN` (7 entrées, 0 document lu), Q2 de `SORT > COLLSCAN` (141939 documents lus) à `LIMIT > FETCH > IXSCAN` (1 entrée, 1 document), Q3 de `COLLSCAN` (60000) à `EXPRESS_IXSCAN` (1 entrée, 1 document). Un doublon d'`idempotencyKey` est refusé (code 11000). Tailles des index : `idx_sorties_wallet_jour` 1028096 octets, `uniq_idempotency_key` 1511424, `idx_ledger_wallet_date` 2158592. Les comptages n'ont pas changé. Preuve enregistrée dans `preuves/03-explain.txt` (date `Mon Nov  9 03:33:59 UTC 2026`).

### 15.1 Complément de la Partie 3

Objectif : compléter les mesures selon la checklist du cours (chapitre 8) : temps sur 3 exécutions avec la médiane, avant et après index ; taille des index avant et après ; un cas où l'index n'aide pas ; l'index refusé mesuré au lieu d'être seulement argumenté. Le « avant » est mesuré sans supprimer les index, en forçant une lecture complète avec `hint({ $natural: 1 })`.

Après avoir relevé la date avec `docker exec mongo-rs1 date -u`, ouverture de la session :

```powershell
docker exec -it mongo-rs1 mongosh fasopay_tp
```

L'index refusé est créé le temps de la mesure, puis supprimé ; commandes exactes tapées dans la session :

```js
db.transactions.createIndex({ type: 1, status: 1, merchantId: 1, amount: 1 }, { name: "idx_refuse_ca_marchand" })
db.transactions.dropIndex("idx_refuse_ca_marchand")
```

Les autres commandes sont rangées, commentées, dans `code/03-index.js` (bloc Complément).

Résultat : médianes sur 3 exécutions, avant puis après : Q1 19 puis 0 ms, Q2 43 puis 0 ms, Q3 18 puis 0 ms, avec les mêmes plans et compteurs que la session du 9 novembre à 03:33 et le même `nReturned`. Index : `transactions` 2514944 octets avant (seul `_id_`) et 5054464 après, `ledger_entries` 5316608 puis 7475200. Une requête sans `fromWalletId` (premier champ de l'index) reste en `COLLSCAN` : 60000 documents lus pour 575 renvoyés. L'index refusé fait passer E3 de `GROUP > COLLSCAN` (60000 documents, médiane 23 ms) à `GROUP > PROJECTION_COVERED > IXSCAN` (16603 clés, 0 document, médiane 9 ms) pour 610304 octets ; il est ensuite supprimé, et `getIndexes()` ne liste plus que `_id_`, `idx_sorties_wallet_jour` et `uniq_idempotency_key`. Les comptages sont inchangés. Preuve : dernier bloc de `preuves/03-explain.txt` (date `Mon Nov  9 18:46:07 UTC 2026`).

Remarque : dans la sortie brute conservée, l'écho de la commande des tailles affiche `seul_id_` ; la sortie, elle, affiche bien `seul _id_`. C'est le défaut d'affichage habituel du terminal.

## 16. Mesures de dimensionnement (Partie 0)

Objectif : mesurer sur nos données les grandeurs de la feuille de dimensionnement : taille BSON moyenne des documents, taille des données et des index de chaque collection (après les index de la Partie 3), lignes de ledger par transaction, écritures par type de transaction, volume des 30 derniers jours. Ce sont des lectures : aucune donnée n'est modifiée.

Après avoir relevé la date avec `docker exec mongo-rs1 date -u`, ouverture de la session :

```powershell
docker exec -it mongo-rs1 mongosh fasopay_tp
```

Les requêtes tapées dans la session sont rangées, commentées, dans `code/00-dimensionnement.js`.

Résultat : taille moyenne 253,02 octets (transactions), 130,19 (ledger), 144 (wallets), sur les collections entières et sur des échantillons de 1000 documents (252,44 et 130,30). Données : 15181339 octets (transactions) et 18479703 (ledger) ; index : 5054464 et 7475200. 2,36565 lignes de ledger et 1,19808 jambes de wallet par transaction. Fenêtre de 30 jours : 9635 transactions et 22728 lignes de ledger. Preuve enregistrée dans `preuves/00-dimensionnement.txt` (date `Mon Nov  9 14:50:22 UTC 2026`).

La dernière commande de cette session (`Object.bsonsize`) a échoué : cette fonction n'existe pas dans mongosh 2.14.0. La mesure de la taille d'un document `outbox` a été refaite dans une seconde session, avec `$bsonSize` dans un pipeline (deuxième bloc de la preuve).

Remarque : dans la sortie brute conservée, certains mots s'affichent déformés dans l'écho des commandes (par exemple `$bso$bsonSize`, `$gro$group`). C'est un défaut d'affichage du terminal : les requêtes tapées étaient correctes et les résultats portent les bons noms de champs.
## 17. Base de test et tests des transactions (Partie 4)

Objectif : tester `code/transfer.js` sans jamais modifier `fasopay_tp`. Les tests tournent dans une base dédiée, `fasopay_test`, recréée à chaque lancement avec nos validateurs, l'index unique sur `transactions.idempotencyKey` et 9 wallets de test (`code/04-base-test.js`). Les tests sont lancés par le script `code/04-lancer.sh`, exécuté dans le conteneur : il écrit lui-même chaque preuve (commande, date `date -u`, sortie brute) et lance les deux clients du test de concurrence comme deux processus `mongosh` en parallèle.

Création des dossiers de travail dans le conteneur, puis copie du dossier `code` (à refaire après chaque modification du code) :

```powershell
docker exec mongo-rs1 mkdir -p /tmp/code /tmp/preuves
docker cp code/. mongo-rs1:/tmp/code/
```

Rôle de chaque morceau :

| Morceau | Rôle |
|---|---|
| `mkdir -p /tmp/code /tmp/preuves` | crée, dans le conteneur, le dossier du code et celui où s'écrivent les preuves |
| `docker cp code/. mongo-rs1:/tmp/code/` | copie le contenu du dossier `code` dans `/tmp/code` du conteneur, où `load("/tmp/code/transfer.js")` le trouve |

Lancement des trois séries de tests, puis récupération de chaque preuve dans `preuves/` :

```powershell
docker exec mongo-rs1 sh /tmp/code/04-lancer.sh tests
docker cp mongo-rs1:/tmp/preuves/04-transaction.txt preuves/04-transaction.txt
docker exec mongo-rs1 sh /tmp/code/04-lancer.sh concurrence
docker cp mongo-rs1:/tmp/preuves/04-concurrence.txt preuves/04-concurrence.txt
docker exec mongo-rs1 sh /tmp/code/04-lancer.sh lostupdate
docker cp mongo-rs1:/tmp/preuves/04-lost-update.txt preuves/04-lost-update.txt
```

Résultat :
- `tests` (`04-base-test.js` puis `04-tests.js`) : 36 vérifications OK, 0 en échec (chargement sans effet, virement réussi, 1 appel et 3 rejeux, 10 refus, abort prouvé, réponse perdue, documents valides, argent conservé). Preuve : `preuves/04-transaction.txt` (date `Wed Nov 11 20:48:31 UTC 2026`).
- `concurrence` (`04-concurrence.js`) : 10 vérifications OK, 0 en échec : 30 virements acceptés sur 50 (17 pour le client A, 13 pour le client B), solde final 0, monnaie conservée, 60 lignes de ledger, 30 outbox, 9 conflits rejoués ; la même clé envoyée par les deux clients ne produit qu'un virement. Preuve : `preuves/04-concurrence.txt` (date `Wed Nov 11 20:48:56 UTC 2026`).
- `lostupdate` (`04-lost-update.js`) : la version naïve sans transaction accepte 50 débits de 100 FCFA (5000 promis) alors que seuls 2500 FCFA sont retirés du wallet. Preuve : `preuves/04-lost-update.txt` (date `Mon Nov  9 19:53:08 UTC 2026`).

Relance du 11 novembre 2026 : lors d'une relecture, un essai avec 8 clients simultanés sur le même wallet (hors preuves) a montré que `transfer()` pouvait épuiser ses 10 essais et lever l'erreur de conflit au lieu de répondre. Nous avons porté la limite à 60 essais, avec une attente qui grandit à chaque essai (`code/transfer.js`), recopié le code dans le conteneur (`docker cp code/. mongo-rs1:/tmp/code/`), puis refait les preuves `tests` et `concurrence` ci-dessus avec cette version. Les autres preuves qui utilisent `transfer()` (`04-debit.txt`, `04-transaction-rs3.txt`, `04-concurrence-rs3.txt`, `B2-relais-outbox.txt`) datent de la version précédente, dont seules cette limite et cette attente diffèrent.

La base `fasopay_tp` n'est pas touchée par ces tests ; `fasopay_test` reste en place et peut être recréée à tout moment par `04-base-test.js`.

### 17.1 Mesure du débit de `transfer()`

Objectif : mesurer combien de virements par seconde `transfer()` réalise sur notre machine. La mesure se fait dans une troisième base, `fasopay_bench`, qui reçoit une copie des 2 000 wallets de `fasopay_tp` (lue seulement, jamais modifiée) et les mêmes index que la Partie 3 (`code/04-debit.js`). Chaque virement fait 100 FCFA entre deux wallets `ACTIVE` tirés au hasard.

Copie du code mis à jour, mesure, puis récupération de la preuve :

```powershell
docker cp code/. mongo-rs1:/tmp/code/
docker exec mongo-rs1 sh /tmp/code/04-lancer.sh debit
docker cp mongo-rs1:/tmp/preuves/04-debit.txt preuves/04-debit.txt
```

Résultat : avec 1 client, 1 000 virements en 7,98 s, soit 125,3 virements/s (752 écritures de documents/s), p95 à 10 ms. Avec 4 clients en parallèle, 999 virements acceptés sur 1 000 en 3,03 s, soit 329,7 virements/s (1 978 écritures/s), p95 à 17 ms et p99 à 35 ms, 6 conflits rejoués. La somme des soldes reste égale à 832251836 FCFA. Preuve : `preuves/04-debit.txt` (date `Mon Nov  9 19:59:57 UTC 2026`).

## 18. Replica Set à 3 nœuds (Partie 5)

Objectif : monter un second environnement, distinct de `mongo-rs1` (qui garde `fasopay_tp` et les preuves des parties 0 à 4) : un Replica Set `rs-fasopay` de trois nœuds, chacun dans son conteneur, sur un réseau Docker dédié. Aucun port n'est publié vers Windows : le client qui écrit pendant les tests tournera lui aussi dans un conteneur de ce réseau (voir plus bas, « Résolution des noms »).

### 18.1 Réseau et nœuds

Création du réseau :

```powershell
docker network create reseau-fasopay
```

Démarrage des trois nœuds :

```powershell
docker run -d --name fasopay-noeud1 --network reseau-fasopay -v fasopay-noeud1-data:/data/db mongo:8.0 --replSet rs-fasopay --bind_ip_all --wiredTigerCacheSizeGB 0.25
docker run -d --name fasopay-noeud2 --network reseau-fasopay -v fasopay-noeud2-data:/data/db mongo:8.0 --replSet rs-fasopay --bind_ip_all --wiredTigerCacheSizeGB 0.25
docker run -d --name fasopay-noeud3 --network reseau-fasopay -v fasopay-noeud3-data:/data/db mongo:8.0 --replSet rs-fasopay --bind_ip_all --wiredTigerCacheSizeGB 0.25
```

Rôle de chaque morceau :

| Morceau | Rôle |
|---|---|
| `docker network create reseau-fasopay` | réseau privé où chaque conteneur est joignable par son nom (`fasopay-noeud1`, etc.) |
| `--network reseau-fasopay` | branche le conteneur sur ce réseau |
| `-v fasopay-noeudX-data:/data/db` | un volume par nœud : chacun garde sa propre copie des données, même si le conteneur est supprimé |
| `--replSet rs-fasopay` | démarre `mongod` en mode Replica Set, avec le même nom sur les trois nœuds |
| `--bind_ip_all` | accepte les connexions venant des autres conteneurs du réseau |
| `--wiredTigerCacheSizeGB 0.25` | limite le cache à 0,25 Go par nœud, pour que les conteneurs tiennent dans la mémoire donnée à Docker |

Les noms désignent un nœud, pas un rôle : après une panne, le primary change de nœud, un nom comme « primary » deviendrait faux.

Vérification :

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Networks}}"
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}"
```

Résultat : `fasopay-noeud1`, `fasopay-noeud2` et `fasopay-noeud3` sont « Up » sur `reseau-fasopay`, à côté de `mongo-rs1`. Chaque nœud occupe environ 100 Mo au démarrage (93,6 à 102,3 Mo) sur 7,6 Go visibles par Docker.

### 18.2 Initialisation du Replica Set et preuve des trois membres

Initialisation, avec les trois membres annoncés par leur nom sur le réseau Docker (et non `localhost`, comme pour `mongo-rs1`, puisque les nœuds doivent se joindre entre eux) :

```powershell
docker exec fasopay-noeud1 mongosh --quiet --eval "rs.initiate({_id: 'rs-fasopay', members: [{_id: 0, host: 'fasopay-noeud1:27017'}, {_id: 1, host: 'fasopay-noeud2:27017'}, {_id: 2, host: 'fasopay-noeud3:27017'}]})"
```

Résultat : `ok: 1`.

Copie du code dans le nœud 1, puis écriture de la preuve par le script `code/05-lancer.sh` (mode `status`), et récupération :

```powershell
docker cp code/. fasopay-noeud1:/tmp/code/
docker exec fasopay-noeud1 sh /tmp/code/05-lancer.sh status
docker cp fasopay-noeud1:/tmp/preuves/05-rs-status.txt preuves/05-rs-status.txt
```

Résultat : `fasopay-noeud1` PRIMARY, `fasopay-noeud2` et `fasopay-noeud3` SECONDARY, tous en santé 1 et au même optime ; 3 membres votants, majorité d'écriture de 2 (`writeMajorityCount: 2`, contre 1 sur `mongo-rs1`) ; élection du premier primary à 20:50:52 (`electionTimeoutMillis` de 10 000 ms). Preuve : `preuves/05-rs-status.txt` (date `Mon Nov  9 20:51:05 UTC 2026`).

### 18.3 Panne du primary avec `w: "majority"`

Objectif : écrire en continu pendant 90 s (une écriture toutes les 100 ms, `w: "majority"`), tuer brutalement le primary pendant la boucle, le redémarrer, puis vérifier qu'aucune écriture acquittée n'a été perdue.

**Résolution des noms (indice `ENOTFOUND` de l'énoncé).** Les membres s'annoncent par leur nom sur le réseau Docker (`fasopay-noeud1:27017`, etc.), que Windows ne sait pas résoudre. Nous avons choisi de lancer le client dans un conteneur à part, `fasopay-client`, branché sur `reseau-fasopay` : il résout les noms grâce au DNS interne de Docker, il survit à la panne du primary puisqu'il ne tourne sur aucun nœud, et rien n'est modifié sur la machine Windows. L'autre solution, ajouter les trois noms au fichier `hosts` de Windows et publier un port par nœud, demande des droits administrateur et modifie la machine.

Création du client, copie du code, puis déroulement du test :

```powershell
docker run -d --name fasopay-client --network reseau-fasopay mongo:8.0 sleep infinity
docker cp code/. fasopay-client:/tmp/code/
docker exec fasopay-client sh /tmp/code/05-lancer.sh primaire
docker exec -d fasopay-client sh /tmp/code/05-lancer.sh boucle majority
docker exec fasopay-client sh /tmp/code/05-lancer.sh panne majority; docker kill fasopay-noeud1
docker exec fasopay-client sh /tmp/code/05-lancer.sh attendre majority
docker start fasopay-noeud1
docker exec fasopay-client sh /tmp/code/05-lancer.sh analyse majority
docker cp fasopay-client:/tmp/preuves/05-failover-majority.txt preuves/05-failover.txt
```

Rôle de chaque morceau :

| Morceau | Rôle |
|---|---|
| `docker run ... mongo:8.0 sleep infinity` | conteneur client qui ne lance pas de serveur : il attend nos commandes, avec `mongosh` disponible |
| `docker exec -d ...` | lance la boucle en arrière-plan : la main revient tout de suite pour pouvoir provoquer la panne |
| `05-lancer.sh panne majority` | note l'heure exacte (UTC, à la milliseconde) juste avant la panne |
| `docker kill fasopay-noeud1` | arrêt brutal du primary (signal KILL, sans arrêt propre) |
| `docker start fasopay-noeud1` | redémarre le nœud tué, qui revient comme secondary et rattrape son retard |

Résultat : 637 écritures tentées, 627 acquittées, 10 échouées (erreurs de sélection de serveur pendant l'absence de primary). Panne notée à 20:56:09.053 ; `fasopay-noeud3` élu primary à 20:56:20.375, soit 11,32 s après ; plus longue interruption des écritures acquittées : 21,17 s (entre les écritures n° 93 et n° 104). 0 écriture acquittée absente de la base, 0 écriture en échec présente en base ; après le retour de `fasopay-noeud1` (SECONDARY), les trois nœuds ont chacun 627 documents. Preuve : `preuves/05-failover.txt` (date `Mon Nov  9 20:57:49 UTC 2026`).

### 18.4 Même panne, client qui surveille les nœuds toutes les secondes

Objectif : vérifier pourquoi l'interruption (21,2 s) a duré près du double de l'élection (11,3 s). Hypothèse : le driver du client ne vérifie l'état des nœuds que toutes les 10 s par défaut (`heartbeatFrequencyMS`) et découvre donc le nouveau primary avec retard. Même test, avec `heartbeatFrequencyMS=1000` ajouté à la chaîne de connexion (mode `majority-hb1` de `05-lancer.sh`) ; le primary était alors `fasopay-noeud3`.

```powershell
docker cp code/. fasopay-client:/tmp/code/
docker exec fasopay-client sh /tmp/code/05-lancer.sh primaire
docker exec -d fasopay-client sh /tmp/code/05-lancer.sh boucle majority-hb1
docker exec fasopay-client sh /tmp/code/05-lancer.sh panne majority-hb1; docker kill fasopay-noeud3
docker exec fasopay-client sh /tmp/code/05-lancer.sh attendre majority-hb1
docker start fasopay-noeud3
docker exec fasopay-client sh /tmp/code/05-lancer.sh analyse majority-hb1
docker cp fasopay-client:/tmp/preuves/05-failover-majority-hb1.txt preuves/05-failover-hb1.txt
```

Résultat : 742 écritures tentées, 737 acquittées, 5 échouées ; `fasopay-noeud2` élu 10,31 s après la panne ; plus longue interruption 10,62 s, la première écriture acquittée arrivant 0,44 s après l'élection (contre près de 10 s au premier test). L'hypothèse est confirmée. 0 écriture acquittée perdue ; 737 documents sur chacun des trois nœuds. Preuve : `preuves/05-failover-hb1.txt` (date `Mon Nov  9 21:05:32 UTC 2026`).

### 18.5 Coupure réseau du primary avec `w: 1` : écritures acquittées puis annulées (rollback)

Objectif : montrer ce qu'on peut perdre avec `w: 1`. La boucle écrit avec `w: 1` directement sur le primary (alors `fasopay-noeud2`), depuis son propre conteneur, pour rester joignable même coupé du réseau. Le primary n'est pas tué : il est débranché du réseau, si bien qu'il continue un moment à acquitter des écritures que personne ne recopie, pendant que les deux autres nœuds élisent un nouveau primary. Puis il est rebranché.

```powershell
docker cp code/. fasopay-noeud2:/tmp/code/
docker cp code/. fasopay-client:/tmp/code/
docker exec fasopay-client sh /tmp/code/05-lancer.sh primaire
docker exec -d fasopay-noeud2 sh /tmp/code/05-lancer.sh boucle-locale w1
docker exec fasopay-noeud2 sh /tmp/code/05-lancer.sh panne w1; docker network disconnect reseau-fasopay fasopay-noeud2
docker exec fasopay-noeud2 sh /tmp/code/05-lancer.sh attendre w1
docker network connect reseau-fasopay fasopay-noeud2
docker exec fasopay-noeud2 sh /tmp/code/05-lancer.sh analyse w1
docker exec fasopay-noeud2 sh /tmp/code/05-lancer.sh rollback w1
docker cp fasopay-noeud2:/tmp/preuves/05-failover-w1.txt preuves/05-failover-w1.txt
docker cp fasopay-noeud2:/tmp/preuves/05-rollback.txt preuves/05-rollback.txt
```

Rôle des nouvelles commandes :

| Morceau | Rôle |
|---|---|
| `05-lancer.sh boucle-locale w1` | boucle `w: 1` connectée directement au nœud local (`localhost`, `directConnection=true`) |
| `docker network disconnect reseau-fasopay fasopay-noeud2` | coupe le primary du réseau sans l'arrêter : il se croit encore primary |
| `docker network connect reseau-fasopay fasopay-noeud2` | le rebranche : il découvre le nouveau primary et annule ses écritures non recopiées |
| `05-lancer.sh rollback w1` | liste les fichiers de `/data/db/rollback`, les lit avec `bsondump` et les compare au journal de la boucle |

Résultat : coupure notée à 21:09:43.457. L'ancien primary acquitte encore les écritures jusqu'à la n° 182 (21:09:53.5), puis refuse (`NotWritablePrimary`) à partir de 21:09:53.6, soit environ 10 s après la coupure ; `fasopay-noeud3` est élu à 21:09:54.433 (10,98 s après). Sur 182 écritures acquittées, 97 (n° 86 à 182) sont absentes de la base après le retour du nœud ; les 97 se trouvent dans le fichier `/data/db/rollback/441d9fa9-0ec8-4ff6-b071-ddd54aaed8b4/removed.2026-11-09T21-10-18.0.bson` (5 030 octets) de `fasopay-noeud2`, et le journal du serveur indique « Operations reverted by rollback » avec 97 insertions, puis le retour en SECONDARY. Les trois nœuds ont 85 documents de ce mode. Preuves : `preuves/05-failover-w1.txt` (date `Mon Nov  9 21:10:27 UTC 2026`) et `preuves/05-rollback.txt` (date `Mon Nov  9 21:10:36 UTC 2026`).

Remarque : l'en-tête « Déroulement » de `05-failover-w1.txt` reprend le texte générique du test `docker kill` ; pour ce test, le déroulement réel est celui décrit ci-dessus (coupure réseau). Le script `05-lancer.sh` a été corrigé ensuite pour écrire le bon déroulement en mode `w1`.

### 18.6 Tests de la Partie 4 rejoués sur le Replica Set à 3 nœuds

Objectif : rejouer les tests de `transfer()` là où `w: "majority"` attend réellement deux nœuds (sur `mongo-rs1`, à un nœud, il équivaut à `w: 1`). Le script `04-lancer.sh` accepte pour cela l'option `rs3` : la base `fasopay_test` est alors créée sur `rs-fasopay`, depuis le conteneur client, et chaque preuve commence par l'état des membres.

```powershell
docker cp code/. fasopay-client:/tmp/code/
docker exec fasopay-client sh /tmp/code/04-lancer.sh tests rs3
docker exec fasopay-client sh /tmp/code/04-lancer.sh concurrence rs3
docker cp fasopay-client:/tmp/preuves/04-transaction-rs3.txt preuves/04-transaction-rs3.txt
docker cp fasopay-client:/tmp/preuves/04-concurrence-rs3.txt preuves/04-concurrence-rs3.txt
```

Résultat : pendant les deux séries, `fasopay-noeud3` est PRIMARY, les deux autres SECONDARY, majorité d'écriture de 2. Tests du contrat : 36 vérifications OK sur 36. Concurrence : 10 vérifications OK sur 10 (30 virements acceptés, 13 pour le client A et 17 pour le client B, solde final 0, monnaie conservée, ledger = 60, outbox = 30, 5 conflits rejoués ; même clé envoyée par les deux clients : un seul virement). Preuves : `preuves/04-transaction-rs3.txt` (date `Mon Nov  9 21:35:44 UTC 2026`) et `preuves/04-concurrence-rs3.txt` (date `Mon Nov  9 21:35:53 UTC 2026`).

## 19. Cluster shardé (Partie 6)

Objectif : monter un troisième environnement, un cluster shardé complet : un config server, trois shards et un routeur `mongos`, sur un réseau Docker dédié. Chaque pièce est un Replica Set d'un seul nœud (un nœud par shard suffit pour ce banc, d'après l'énoncé). Le Replica Set de la Partie 5 a été arrêté (`docker stop`) une fois ses preuves faites, pour laisser la mémoire au cluster ; ses volumes sont conservés.

### 19.1 Réseau, config server et shards

```powershell
docker network create reseau-cluster
docker run -d --name fasopay-cfg --network reseau-cluster -v fasopay-cfg-data:/data/configdb mongo:8.0 --configsvr --replSet rs-cfg --port 27017 --bind_ip_all --wiredTigerCacheSizeGB 0.25
docker run -d --name fasopay-shard1 --network reseau-cluster -v fasopay-shard1-data:/data/db mongo:8.0 --shardsvr --replSet rs-shard1 --port 27017 --bind_ip_all --wiredTigerCacheSizeGB 0.25
docker run -d --name fasopay-shard2 --network reseau-cluster -v fasopay-shard2-data:/data/db mongo:8.0 --shardsvr --replSet rs-shard2 --port 27017 --bind_ip_all --wiredTigerCacheSizeGB 0.25
docker run -d --name fasopay-shard3 --network reseau-cluster -v fasopay-shard3-data:/data/db mongo:8.0 --shardsvr --replSet rs-shard3 --port 27017 --bind_ip_all --wiredTigerCacheSizeGB 0.25
```

Rôle des nouvelles options :

| Option | Rôle |
|---|---|
| `--configsvr` | serveur de configuration : garde la carte du cluster (quels chunks sur quels shards) |
| `--shardsvr` | shard : garde une partie des données |
| `--replSet rs-cfg`, `rs-shard1`, ... | chaque pièce est un Replica Set (exigé par MongoDB), ici d'un seul nœud |
| `--port 27017` | sans cette option, un config server écoute sur 27019 et un shard sur 27018 ; nous imposons 27017 partout pour simplifier les adresses |
| `-v fasopay-cfg-data:/data/configdb` | un config server range ses données dans `/data/configdb` |

Vérification :

```powershell
docker ps --format "table {{.Names}}	{{.Status}}	{{.Networks}}"
docker stats --no-stream --format "table {{.Name}}	{{.MemUsage}}"
```

Résultat : `fasopay-cfg`, `fasopay-shard1`, `fasopay-shard2` et `fasopay-shard3` « Up » sur `reseau-cluster`, de 94 à 101 Mo chacun au démarrage.

### 19.2 Initialisation, routeur mongos et déclaration des shards

Initialisation des quatre Replica Sets (le config server est déclaré comme tel par `configsvr: true`) :

```powershell
docker exec fasopay-cfg mongosh --quiet --eval "rs.initiate({_id: 'rs-cfg', configsvr: true, members: [{_id: 0, host: 'fasopay-cfg:27017'}]})"
docker exec fasopay-shard1 mongosh --quiet --eval "rs.initiate({_id: 'rs-shard1', members: [{_id: 0, host: 'fasopay-shard1:27017'}]})"
docker exec fasopay-shard2 mongosh --quiet --eval "rs.initiate({_id: 'rs-shard2', members: [{_id: 0, host: 'fasopay-shard2:27017'}]})"
docker exec fasopay-shard3 mongosh --quiet --eval "rs.initiate({_id: 'rs-shard3', members: [{_id: 0, host: 'fasopay-shard3:27017'}]})"
```

Démarrage du routeur, relié au config server, puis déclaration des trois shards :

```powershell
docker run -d --name fasopay-mongos --network reseau-cluster mongo:8.0 mongos --configdb rs-cfg/fasopay-cfg:27017 --bind_ip_all --port 27017
docker exec fasopay-mongos mongosh --quiet --eval "printjson(sh.addShard('rs-shard1/fasopay-shard1:27017')); printjson(sh.addShard('rs-shard2/fasopay-shard2:27017')); printjson(sh.addShard('rs-shard3/fasopay-shard3:27017'))"
```

| Morceau | Rôle |
|---|---|
| `configsvr: true` | dans `rs.initiate`, déclare ce Replica Set comme config server |
| `mongo:8.0 mongos` | lance le routeur `mongos` au lieu d'un `mongod` : il ne stocke rien, il aiguille les requêtes vers les shards |
| `--configdb rs-cfg/fasopay-cfg:27017` | indique au mongos où trouver la carte du cluster |
| `sh.addShard('rs-shard1/fasopay-shard1:27017')` | ajoute un shard, désigné par son Replica Set et son adresse |

Copie du code dans le mongos, preuve (mode `cluster` de `code/06-lancer.sh`) et récupération :

```powershell
docker cp code/. fasopay-mongos:/tmp/code/
docker exec fasopay-mongos sh /tmp/code/06-lancer.sh cluster
docker cp fasopay-mongos:/tmp/preuves/06-cluster.txt preuves/06-cluster.txt
```

Résultat : `ok: 1` pour les quatre initialisations ; `shardAdded` pour `rs-shard1`, `rs-shard2` et `rs-shard3`. `config.shards` liste les trois shards (état 1) ; le mongos (`isdbgrid`, version 8.0.34) utilise le config server `rs-cfg/fasopay-cfg:27017` ; `sh.status()` montre les trois shards, un mongos actif et le balancer activé. Preuve : `preuves/06-cluster.txt` (date `Mon Nov  9 22:03:51 UTC 2026`).

### 19.3 Évaluation des quatre clés de sharding

Objectif : pour chaque clé candidate, une collection de la base `fasopay_shard`, shardée AVANT l'import, puis les 60 000 transactions importées à travers le mongos ; mesure de la répartition, correction d'une clé à plages, trafic de demain, et lecture des `explain()`. Tout est enchaîné par le mode `cle` de `code/06-lancer.sh` (fonctions dans `code/06-cles.js`).

| Nom | Collection | Clé |
|---|---|---|
| `date` | `tx_date` | `{ createdAt: 1 }` |
| `wallet` | `tx_wallet` | `{ fromWalletId: 1 }` |
| `hash` | `tx_hash` | `{ fromWalletId: "hashed" }` |
| `composee` | `tx_comp` | `{ fromWalletId: 1, createdAt: 1 }` |

Copie des transactions et du code dans le mongos :

```powershell
docker exec fasopay-mongos mkdir -p /tmp/data
docker cp data/transactions.ndjson fasopay-mongos:/tmp/data/transactions.ndjson
docker cp code/. fasopay-mongos:/tmp/code/
```

Évaluation des quatre clés, puis récupération des preuves :

```powershell
docker exec fasopay-mongos sh /tmp/code/06-lancer.sh cle date
docker exec fasopay-mongos sh /tmp/code/06-lancer.sh cle wallet
docker exec fasopay-mongos sh /tmp/code/06-lancer.sh cle hash
docker exec fasopay-mongos sh /tmp/code/06-lancer.sh cle composee
docker cp fasopay-mongos:/tmp/preuves/06-cle-date.txt preuves/06-cle-date.txt
docker cp fasopay-mongos:/tmp/preuves/06-cle-wallet.txt preuves/06-cle-wallet.txt
docker cp fasopay-mongos:/tmp/preuves/06-cle-hash.txt preuves/06-cle-hash.txt
docker cp fasopay-mongos:/tmp/preuves/06-cle-composee.txt preuves/06-cle-composee.txt
```

Pour chaque clé, le script exécute, dans l'ordre : `sh.shardCollection` sur la collection vide ; `mongoimport --host localhost:27017 --db fasopay_shard --collection <collection> --file /tmp/data/transactions.ndjson` ; la répartition par shard (`$collStats`) et les chunks par shard (`config.chunks`) ; pour les clés à plages, deux découpes (`sh.splitAt`) au tiers et aux deux tiers des documents, puis deux déplacements (`sh.moveChunk`) ; l'insertion de 3 000 transactions datées du jour, copiées d'un échantillon réel ; enfin les `explain("executionStats")` des requêtes de l'énoncé, à travers le mongos.

Résultat :
- Les quatre imports : 60 000 documents, 0 échec.
- Clés à plages (`date`, `wallet`, `composee`) : après l'import, 100 % des documents sur `rs-shard2`, en un seul chunk ; après découpe et déplacement, un chunk par shard.
- Clé `hash` : répartie dès l'import (47,4 %, 25,2 %, 27,4 %), sans correction ; les 13 505 dépôts sans `fromWalletId` ont tous la même valeur de clé.
- Trafic de demain : clé `date`, 100 % des 3 000 nouvelles transactions sur `rs-shard3` ; clé `wallet`, 33,1 %, 33,4 %, 33,5 % ; clé `hash`, 48,0 %, 25,4 %, 26,6 % ; clé `composee`, 33,1 %, 33,7 %, 33,2 %.
- Preuves : `preuves/06-cle-date.txt` (date `Mon Nov  9 23:17:45 UTC 2026`), `preuves/06-cle-wallet.txt` (23:17:55), `preuves/06-cle-hash.txt` (23:18:08), `preuves/06-cle-composee.txt` (23:18:21).

Remarque : pour les clés à plages, la répartition « après correction » affiche 100 000 documents au lieu de 60 000 (par exemple 20 000, 60 000 et 20 000 pour la clé `date`). `$collStats` compte aussi les copies que le shard de départ garde après un `sh.moveChunk` (documents orphelins), en attendant leur suppression en arrière-plan. Les requêtes ne sont pas faussées (l'étape `SHARDING_FILTER` des `explain()` écarte ces copies : voir `chunkSkips`), mais le comptage l'est. La section 19.4 mesure les documents possédés et orphelins par shard.

### 19.4 Documents possédés et documents orphelins

Objectif : expliquer les 100 000 documents comptés après correction des clés à plages. Après un `sh.moveChunk`, le shard de départ garde une copie des documents déplacés ; MongoDB ne la supprime qu'après un délai (`orphanCleanupDelaySecs`), pour ne pas gêner les lectures encore en cours sur l'ancien emplacement. Le mode `orphelins` de `code/06-lancer.sh` lit ce délai et les suppressions en attente sur chaque shard, puis la répartition par shard avec `$shardedDataDistribution`, qui sépare les documents possédés des orphelins.

```powershell
docker cp code/. fasopay-mongos:/tmp/code/
docker exec fasopay-mongos sh /tmp/code/06-lancer.sh orphelins
docker cp fasopay-mongos:/tmp/preuves/06-orphelins.txt preuves/06-orphelins.txt
```

Résultat (23:22:43, moins de 15 minutes après les déplacements de 23:17:49) : délai de 900 s sur les trois shards ; 6 suppressions en attente sur `rs-shard2` (2 par collection à plages). Documents possédés : `tx_date` 20 000, 20 000 et 23 000 ; `tx_wallet` 20 950, 20 999 et 21 051 ; `tx_comp` 20 994, 21 011 et 20 995 ; `tx_hash` 29 892, 15 883 et 17 225. Orphelins : 40 000 (40 004 pour `tx_wallet`) sur `rs-shard2` pour chaque collection à plages, 0 ailleurs. La correction a donc bien réparti un tiers des documents par shard ; les comptages « après correction » des preuves `06-cle-*` comptaient en plus les orphelins. Preuve : `preuves/06-orphelins.txt` (date `Mon Nov  9 23:22:42 UTC 2026`).

Même mesure, relancée après la fin du délai de 900 s :

```powershell
docker exec fasopay-mongos sh /tmp/code/06-lancer.sh orphelins
docker cp fasopay-mongos:/tmp/preuves/06-orphelins.txt preuves/06-orphelins-apres.txt
```

Résultat (23:36:16) : plus aucune suppression en attente, 0 orphelin sur les trois shards ; les documents possédés sont inchangés. MongoDB a supprimé seul les copies, une fois le délai écoulé. Preuve : `preuves/06-orphelins-apres.txt` (date `Mon Nov  9 23:36:16 UTC 2026`).

### 19.5 Évaluation de la clé recommandée : `{ walletCle: "hashed" }`

Objectif : les quatre premières évaluations montrent que les 13 505 dépôts (`CASH_IN`) n'ont pas de `fromWalletId`, donc partagent une même valeur de clé. Nous évaluons une cinquième clé, hachée sur un champ toujours présent : `walletCle` = `fromWalletId`, ou `toWalletId` quand il n'y a pas d'émetteur. La collection `tx_cible` est shardée avant d'être remplie ; les 60 000 transactions d'origine (lues dans `tx_date`, sans les 3 000 ajoutées par le test du trafic de demain) y sont écrites à travers le mongos, par lots de 1 000, avec le champ `walletCle` (fonction `charger` de `code/06-cles.js`). `mongoimport` n'est pas utilisable ici, puisque le fichier d'origine ne contient pas ce champ ; le fichier `data/transactions.ndjson` n'est pas modifié.

```powershell
docker cp code/. fasopay-mongos:/tmp/code/
docker exec fasopay-mongos sh /tmp/code/06-lancer.sh cle cible
docker cp fasopay-mongos:/tmp/preuves/06-cle-cible.txt preuves/06-cle-cible.txt
```

Résultat : 60 000 transactions écrites ; 0 document sans `walletCle` ; répartition 32,2 %, 32,6 % et 35,2 % sans aucune correction ; trafic du jour 31,6 %, 34,3 % et 34,1 % ; l'historique d'un wallet par `walletCle` est ciblé sur un seul shard (`SINGLE_SHARD`, 409 documents examinés pour 409 rendus). Preuve : `preuves/06-cle-cible.txt` (date `Mon Nov  9 23:44:47 UTC 2026`).

## 20. Sécurité : rôles minimaux (Partie 7)

Objectif : prouver le principe du moindre privilège au lieu de seulement le décrire. Un serveur de test est démarré avec authentification obligatoire ; trois rôles minimaux et trois utilisateurs y sont créés (`code/07-securite.js`), puis chaque utilisateur essaie ce qu'il doit pouvoir faire et ce qu'il ne doit pas pouvoir faire. Les identifiants sont des valeurs de test, propres à ce conteneur jetable ; en production, ils viendraient d'un coffre de secrets.

Démarrage du serveur de test (les deux variables créent le compte administrateur ; avec elles, l'image démarre `mongod` en mode authentification obligatoire), copie du code, preuve et récupération :

```powershell
docker run -d --name fasopay-securite -e MONGO_INITDB_ROOT_USERNAME=admin-test -e MONGO_INITDB_ROOT_PASSWORD=test-admin-2026 mongo:8.0 --wiredTigerCacheSizeGB 0.25
docker cp code/. fasopay-securite:/tmp/code/
docker exec fasopay-securite sh /tmp/code/07-lancer.sh securite
docker cp fasopay-securite:/tmp/preuves/07-securite.txt preuves/07-securite.txt
```

| Rôle | Droits | Utilisateur |
|---|---|---|
| `fasopay_application` | `transactions` : find, insert, update ; `ledger_entries` : find, insert (ajout seul) ; `wallets` : find, update ; `outbox` : insert | `app_fasopay` |
| `fasopay_relais` | `outbox` : find, update, changeStream ; `notifications` : find, insert | `relais_fasopay` |
| `fasopay_tableau` | `ca_marchands` (read model) : find | `tableau_fasopay` |

Note : un premier lancement s'était arrêté sur l'affichage de la liste des rôles (`TypeError: b.getRoles(...).map is not a function` : dans mongosh 2.14.0, `getRoles` ne renvoie pas un simple tableau), après la création des rôles et des utilisateurs. Le script a été corrigé (affichage et remise à zéro des utilisateurs et rôles de la base de test au début), puis toute la preuve a été refaite ; seule la seconde exécution est conservée.

Résultat : `authorization: enabled` ; une connexion sans identifiants ne lit rien (`Unauthorized`, code 13) ; `app_fasopay` peut insérer une transaction, ajouter une ligne de ledger, mettre à jour un solde et ajouter un événement outbox, mais il est refusé (code 13) quand il essaie de modifier ou supprimer une ligne de ledger, de supprimer la collection `ledger_entries`, de supprimer un wallet ou de lire le read model ; `relais_fasopay` et `tableau_fasopay` n'ont accès qu'à leur périmètre. La ligne de ledger visée reste intacte. 18 vérifications OK sur 18. Preuve : `preuves/07-securite.txt` (date `Tue Nov 10 00:28:25 UTC 2026`).


## 21. Diagramme d'architecture (Partie 7)

Objectif : produire le diagramme unique de la cible PME à partir d'une source texte, pour qu'il puisse être relu, corrigé et régénéré. La source est `rapport/diagramme-architecture.puml` (PlantUML) ; l'image est `rapport/diagramme-architecture.png`. Deux façons de produire l'image, au choix :

1. **Dans VS Code** (ce que nous avons fait) : avec l'extension « PlantUML » (jebbs), ouvrir `rapport/diagramme-architecture.puml`, afficher l'aperçu avec `Alt+D`, puis `Ctrl+Shift+P` → `PlantUML: Export Current Diagram` → `png`. L'image exportée remplace `rapport/diagramme-architecture.png`.
2. **Sans rien installer, avec Docker** : PlantUML tourne dans un conteneur.

```powershell
docker run --rm -v "${PWD}/rapport:/data" plantuml/plantuml -charset UTF-8 -tpng /data/diagramme-architecture.puml
```

Le diagramme ne montre que les composants retenus en Partie 7 : 2 serveurs d'application (API `transfer()`, relais outbox, tâches de nuit `$merge` et rapprochement), le Replica Set `rs-fasopay` de 3 nœuds, le read model lu sur un secondary, les notifications et les sauvegardes. Ni Kafka, ni Spark, ni Redis, ni shard.

## 22. Bonus B2 : relais Outbox par Change Stream

Objectif : prouver qu'un relais qui lit `outbox` par Change Stream ne perd aucun événement et n'envoie aucune notification en double, même tué par `kill -9`. Tout se passe dans une base à part, `fasopay_b2`, sur `mongo-rs1` (Replica Set `rs0` à un nœud : un Change Stream exige un Replica Set) ; `fasopay_tp` n'est pas touchée. Les virements passent par notre `transfer()` (Partie 4), qui écrit l'événement `outbox` dans la même transaction que le virement.

Fichiers : `code/B2-relais.js` (le relais), `code/B2-outils.js` (préparation, rafale de virements, vérifications), `code/B2-lancer.sh` (les deux scénarios, dans l'ordre, avec la preuve).

```powershell
docker start mongo-rs1
docker cp code/. mongo-rs1:/tmp/code/
docker exec mongo-rs1 sh /tmp/code/B2-lancer.sh relais
docker cp mongo-rs1:/tmp/preuves/B2-relais-outbox.txt preuves/B2-relais-outbox.txt
```

Le relais, pour chaque événement, dans cet ordre : (1) il écrit la notification avec le même `_id` que l'événement (`updateOne` avec `upsert` et `$setOnInsert`) ; (2) il passe l'événement à `SENT` ; (3) il sauvegarde le resume token dans `relais_etat`. Le filtre `{ operationType: "insert", "fullDocument.status": "PENDING" }` est appliqué par le serveur. Au premier démarrage, le relais sauvegarde tout de suite un resume token, pour ne rien perdre s'il meurt avant son premier événement.

Résultat :
- **Scénario 1** (`kill -9` au milieu de 1 000 virements) : le relais n° 1 est tué à 00:59:34 ; pendant les 3 s qui suivent, la rafale continue et 410 événements s'accumulent en `PENDING`. Le relais n° 2 reprend avec `resumeAfter` « après 323 événements traités » et reconnaît **1 relivraison** : l'événement 324 avait déjà sa notification et son `SENT`, mais le `kill -9` est tombé avant la sauvegarde du resume token. Vérifications : 1 000 événements, 1 000 notifications, 0 perdu, 0 doublon (6 OK sur 6).
- **Scénario 2** (arrêt volontaire juste après la 5e notification, avant `SENT` et avant le resume token) : le relais n° 3 sort avec le code 9 ; à cet instant, 1 005 notifications pour 1 004 événements `SENT`. Le relais n° 4 reprend et reconnaît **1 relivraison** du même événement, sans doublon. Vérifications sur les 1 020 virements : 1 020 événements, 1 020 notifications, 0 perdu, 0 doublon (6 OK sur 6).

Preuve : `preuves/B2-relais-outbox.txt` (date `Tue Nov 10 00:59:26 UTC 2026`).
