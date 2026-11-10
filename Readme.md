# TP final FasoPay

**Groupe 07**
- YAMEOGO Joseph
- ZONGO Abdrafith

UE Bases de données NoSQL, Master 2 Data Science, IFOAD, 2026-2027.

Mission d'audit, de conception et de démonstration pour FasoPay, un portefeuille de paiement mobile : un modèle de données solide, les soldes incohérents retrouvés, des virements qui ne peuvent ni doubler ni se perdre, et une architecture qui tient la cible sans « usine à gaz ». Chaque chiffre du rapport vient d'une preuve de `preuves/`, produite par une commande du journal de montage (`docs/journal-montage.md`).

## Ce que nous avons trouvé et prouvé
- **Données :** notre jeu (2 000 clients, 60 000 transactions) est conforme à son `fingerprint.json` : comptages, sommes et empreintes SHA-256 (`preuves/00-fingerprint.txt`).
- **Enquête :** 6 soldes incohérents avec le ledger (écart absolu de 138 000 FCFA), 5 wallets qui découpent leurs transferts sous le plafond, 21 clés d'idempotence rejouées (`preuves/02-enquete.txt`).
- **Virements :** `code/transfer.js` fait tout ou rien, ne double pas un virement rejoué et garde les soldes justes avec deux clients en même temps (`preuves/04-*.txt`).
- **Réplication :** panne du primary, 0 écriture `w: "majority"` perdue ; avec `w: 1`, 97 écritures acquittées puis annulées (`preuves/05-*.txt`).
- **Architecture :** cible PME, un Replica Set de 3 nœuds et un read model, sans Kafka, Spark, Redis ni sharding à 18 mois ; environ 483 € HT par mois, soit environ 317 070 FCFA (`rapport/partie7-architecture.md`, `adr/ADR-003.md`).
- **Bonus B2 :** relais outbox par Change Stream tué par `kill -9`, puis repris : 0 événement perdu, 0 notification en double (`preuves/B2-relais-outbox.txt`).

## Organisation du dossier

| Dossier | Contenu |
|---|---|
| `rapport/` | le rapport, une partie par fichier (`partie-contexte.md`, `partie0-…` à `partie7-…`, `synthese-cto.md`, `bonus-B2-outbox.md`), l'annexe A (`annexe-A-dimensionnement.md`), la déclaration d'usage de l'IA (`notes-ia.md`) et le diagramme d'architecture (`diagramme-architecture.puml` et `.png`) |
| `adr/` | les trois décisions d'architecture : `ADR-001.md`, `ADR-002.md`, `ADR-003.md` |
| `docs/journal-montage.md` | l'annexe B : toutes les commandes, dans l'ordre, telles que nous les avons tapées, avec le résultat et la date de chaque preuve |
| `code/` | les scripts mongosh (`.js`) et les lanceurs (`.sh`) de chaque partie, dont `transfer.js` |
| `preuves/` | les sorties brutes (commande, date, sortie) ; `preuves/LISEZMOI.md` dit ce que démontre chaque fichier et quelle partie le cite |
| `data/` | le jeu de données du groupe 07, fourni par l'enseignant, avec son `fingerprint.json` |

## Ce qu'il faut pour rejouer
- Windows avec PowerShell, et Docker (nous avons utilisé Docker 29.8.0) ; environ 8 Go de mémoire pour Docker.
- L'image `mongo:8.0` (nous avons utilisé MongoDB 8.0.34 et le `mongosh` 2.14.0 fourni dans l'image) : rien d'autre à installer.
- Toutes les commandes se lancent depuis le dossier du projet (`TP_FasoPay_G7`).

## Rejouer, dans l'ordre
Le détail de chaque étape (toutes les commandes, ce qu'elles font, le résultat attendu) est dans le journal de montage ; le tableau donne le point d'entrée de chaque étape.

| Étape | Journal | Conteneur(s) | Point d'entrée | Preuves |
|---|---|---|---|---|
| Serveur du TP, Replica Set `rs0` à un nœud | sections 1 à 5 | `mongo-rs1` | `docker run -d --name mongo-rs1 -p 27017:27017 -v mongo-rs1-data:/data/db mongo:8.0 --replSet rs0`, puis `rs.initiate` | `00-rs-status-1-noeud.txt` |
| Import et vérification des données (D2, D3, D4) | sections 6 à 11 | `mongo-rs1` | `mongoimport` de chaque fichier de `data/`, puis la vérification du fingerprint | `00-import-comptages.txt`, `00-collections.txt`, `00-fingerprint.txt`, `00-types.txt` |
| Parties 1, 2, 3 et 0 (validateurs, enquête, index, dimensionnement) | sections 12 à 16 | `mongo-rs1` | `docker exec -it mongo-rs1 mongosh fasopay_tp`, puis les commandes de `code/01-…`, `02-…`, `03-…`, `00-….js` | `01-*`, `02-*`, `03-*`, `00-dimensionnement.txt` |
| Partie 4 (transactions) | section 17 | `mongo-rs1` | `docker exec mongo-rs1 sh /tmp/code/04-lancer.sh tests` (puis `concurrence`, `lostupdate`, `debit`) | `04-*` |
| Partie 5 (Replica Set à 3 nœuds, pannes) | section 18 | `fasopay-noeud1` à `3`, `fasopay-client` | réseau `reseau-fasopay`, 3 nœuds, `rs.initiate`, puis `code/05-lancer.sh` | `05-*`, `04-*-rs3.txt` |
| Partie 6 (cluster shardé, clés) | section 19 | `fasopay-cfg`, `fasopay-shard1` à `3`, `fasopay-mongos` | réseau `reseau-cluster`, puis `code/06-lancer.sh cluster`, `cle NOM`, `orphelins` | `06-*` |
| Partie 7 (sécurité, rôles minimaux) | section 20 | `fasopay-securite` | `docker exec fasopay-securite sh /tmp/code/07-lancer.sh securite` | `07-securite.txt` |
| Diagramme d'architecture | section 21 | aucun (VS Code) ou `plantuml/plantuml` | export PlantUML de `rapport/diagramme-architecture.puml` | `rapport/diagramme-architecture.png` |
| Bonus B2 (relais outbox) | section 22 | `mongo-rs1` | `docker exec mongo-rs1 sh /tmp/code/B2-lancer.sh relais` | `B2-relais-outbox.txt` |

Avant chaque lanceur `.sh`, le code est copié dans le conteneur (`docker cp code/. <conteneur>:/tmp/code/`) ; après, la preuve est récupérée (`docker cp <conteneur>:/tmp/preuves/<fichier> preuves/`). Le journal donne ces deux commandes à chaque fois.

## Règles que nous avons suivies
- Les données de `fasopay_tp` n'ont jamais été réimportées après le début des mesures. Les tests qui écrivent se font dans des bases à part (`fasopay_test`, `fasopay_bench`, `fasopay_b2`), recréées à chaque lancement.
- Les preuves sont brutes : nous ne les retouchons pas. Quand une mesure a été refaite, le nouveau résultat est ajouté avec sa propre date, et le journal explique pourquoi.
- Les mots de passe des conteneurs de test (`fasopay-securite`) sont des valeurs de test, propres à ce conteneur jetable.

## Auteurs
**Groupe 07**
- YAMEOGO Joseph
- ZONGO Abdrafith
