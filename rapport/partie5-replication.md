# Partie 5 : Réplication et haute disponibilité (+ ADR-002)

> Brouillon de la section 7 du rapport. Montage : journal, section 18 ; code : `code/05-lancer.sh`, `code/05-boucle.js` ; preuves : `preuves/05-rs-status.txt`, `preuves/05-failover.txt`.

## 5.1 Le Replica Set à trois nœuds
Nous avons monté un second environnement, distinct de `mongo-rs1` qui garde `fasopay_tp` : le Replica Set `rs-fasopay`, avec trois nœuds (`fasopay-noeud1` à `fasopay-noeud3`), chacun dans son conteneur, avec son propre volume, sur le réseau Docker `reseau-fasopay`. Chaque nœud a un cache limité à 0,25 Go pour tenir dans la mémoire de notre machine. Les noms désignent un nœud et non un rôle : après une panne, le primary change de nœud.

`rs.status()` (`preuves/05-rs-status.txt`) montre `fasopay-noeud1` PRIMARY et les deux autres SECONDARY, tous en santé 1 et au même optime, avec 3 membres votants et une majorité d'écriture de 2. Sur `mongo-rs1`, à un seul nœud, cette majorité valait 1 : `w: "majority"` y équivalait à `w: 1`. Ici, une écriture majoritaire n'est acquittée qu'une fois présente sur deux nœuds.

**Résolution des noms.** Les membres s'annoncent par leur nom sur le réseau Docker, que Windows ne sait pas résoudre (`ENOTFOUND`). Nous lançons donc le client dans un conteneur à part, `fasopay-client`, sur le même réseau : il résout les noms par le DNS interne de Docker, il ne tourne sur aucun nœud et survit donc à la panne du primary, et la machine Windows n'est pas modifiée. L'alternative, déclarer les trois noms dans le fichier `hosts` de Windows et publier un port par nœud, demande des droits administrateur.

## 5.2 Panne du primary avec `w: "majority"`
Le client écrit pendant 90 s, une écriture toutes les 100 ms, avec `w: "majority"`, et note pour chacune son numéro, son heure, son résultat (acquittée ou échouée) et sa durée (`preuves/05-failover.txt`, journal brut complet). Vingt secondes après le début, nous notons l'heure puis tuons le primary (`docker kill fasopay-noeud1`) ; à la fin de la boucle, nous le redémarrons.

| Mesure | Valeur |
|---|---|
| Écritures tentées / acquittées / échouées | 637 / 627 / 10 |
| Heure de la panne | 20:56:09.053 |
| Nouveau primary | `fasopay-noeud3`, élu à 20:56:20.375, soit **11,32 s** après la panne (raison `electionTimeout`) |
| Plus longue interruption des écritures acquittées | **21,17 s** (entre l'écriture n° 93 et la n° 104) |
| Écritures acquittées absentes de la base | **0** |
| Écritures en échec mais présentes en base | 0 |
| Documents sur chaque nœud après le retour de `fasopay-noeud1` | 627, 627, 627 (`fasopay-noeud1` revenu SECONDARY) |

**Lecture.** L'élection prend 11,3 s : un nœud attend 10 s sans nouvelles du primary (`electionTimeoutMillis`) avant de se présenter, puis le vote est rapide. Les 10 écritures échouées sont des erreurs de sélection de serveur : pendant ce temps, le client n'a pas de primary où écrire, et nous avons réglé son attente à 2 s pour que l'interruption soit visible dans le journal. Aucune écriture acquittée n'est perdue : chacune était sur deux nœuds au moment de l'acquittement, donc présente sur le nœud élu. Les écritures n° 92 et 93 sont acquittées juste après l'heure notée : `docker kill` prend quelques dizaines de millisecondes à arrêter le conteneur.

L'interruption totale (21,2 s) est près du double du temps d'élection (11,3 s) : pendant environ 10 s après l'élection, le client échoue encore alors qu'un nouveau primary existe. La section 5.3 en donne la cause, mesurée. Ces durées ont été mesurées sur notre montage Docker, où les trois nœuds partagent une machine : elles dépendent du pilote et du réseau, et sont à remesurer sur le matériel cible.

## 5.3 D'où viennent les 10 secondes de trop ?
Notre hypothèse : par défaut, le pilote du client ne vérifie l'état des nœuds que toutes les 10 s (`heartbeatFrequencyMS`). Après l'élection, il continue donc à chercher l'ancien primary jusqu'à sa vérification suivante. Pour le vérifier, nous avons refait exactement la même panne (`docker kill` du primary, alors `fasopay-noeud3`), avec un client réglé à une vérification par seconde (`preuves/05-failover-hb1.txt`).

| | Client par défaut (10 s) | Client réglé à 1 s |
|---|---|---|
| Élection du nouveau primary après la panne | 11,32 s | 10,31 s |
| Plus longue interruption des écritures | **21,17 s** | **10,62 s** |
| Première écriture acquittée après l'élection | 9,99 s après | 0,44 s après |
| Écritures échouées | 10 | 5 |
| Écritures acquittées perdues | 0 | 0 |

L'hypothèse est confirmée : avec un client réglé à 1 s, l'interruption se réduit au temps d'élection. Celui-ci est fixé par le serveur : un nœud attend `electionTimeoutMillis` (10 s par défaut) sans nouvelles du primary avant de se présenter. Deux leviers existent donc pour réduire l'interruption, avec chacun un coût : régler le client à une surveillance plus fréquente (un peu plus de trafic de surveillance), ou baisser `electionTimeoutMillis` (risque d'élections inutiles lors d'une simple lenteur du réseau). Pour FasoPay, nous retenons le premier et gardons le second à sa valeur par défaut. Avec une élection de l'ordre de 10 s, une seule panne par mois consomme environ 0,8 % du budget d'indisponibilité de la cible de 99,95 % (environ 21,6 min par mois).

## 5.4 `w: 1` : ce qui peut se perdre, et où MongoDB le range
Nous avons reproduit la perte au lieu de seulement l'expliquer (`preuves/05-failover-w1.txt`, `preuves/05-rollback.txt`). Une boucle écrit avec `w: 1` directement sur le primary (`fasopay-noeud2`) ; nous coupons ce primary du réseau sans l'arrêter (`docker network disconnect`), puis nous le rebranchons après la boucle.

| Moment | Ce qui se passe |
|---|---|
| 21:09:43.457 | coupure réseau de `fasopay-noeud2` |
| de 21:09:43 à 21:09:53.5 | isolé, il se croit encore primary et **acquitte** les écritures n° 86 à 182 avec `w: 1`, que personne ne recopie |
| 21:09:53.6 | il constate qu'il ne voit plus la majorité, se retire et refuse les écritures (`NotWritablePrimary`) |
| 21:09:54.433 | les deux autres nœuds élisent `fasopay-noeud3` (10,98 s après la coupure) |
| 21:10:19 | rebranché, `fasopay-noeud2` découvre le nouveau primary et **annule** ses écritures non recopiées (rollback), puis redevient SECONDARY |

**Résultat :** sur 182 écritures acquittées, **97 sont perdues** (n° 86 à 182). Le client a reçu « acquitté » pour chacune, et aucune n'est dans la base. MongoDB ne les détruit pas : il les range dans un fichier BSON du nœud qui les a annulées, sous `/data/db/rollback/<identifiant de la collection>/removed.<date>.bson`. Nous y retrouvons les 97 documents (lus avec `bsondump`), et le journal du serveur indique « Operations reverted by rollback » avec 97 insertions. Ces fichiers ne sont pas réintégrés automatiquement : il faudrait les examiner puis les réappliquer à la main.

**Avec `w: "majority"`, ces écritures n'auraient pas été acquittées.** L'ancien primary isolé ne peut plus les faire recopier par un deuxième nœud : l'écriture attend, puis échoue à l'expiration du délai (`wtimeout`). Le client sait alors que l'écriture n'est pas garantie, et peut la rejouer avec sa clé d'idempotence (Partie 4). C'est la différence mesurée entre nos deux tests : 0 écriture acquittée perdue en `w: "majority"` (sections 5.2 et 5.3), 97 en `w: 1`.

Ce que ce test ne montre pas : le cas d'une écriture `w: "majority"` interrompue sans réponse (délai expiré alors qu'elle a peut-être été recopiée). Ce cas ne perd rien d'acquitté, mais laisse le client dans le doute : c'est précisément le rôle de la clé d'idempotence.

## 5.5 ADR-002 : quel niveau de garantie pour quel usage
La décision complète est dans `adr/ADR-002.md`. Nos tests la fondent :

| Usage | Écriture | Lecture | Raison mesurée |
|---|---|---|---|
| Argent (virements, ledger, outbox, solde qui décide) | `w: "majority"`, `j: true`, avec `wtimeout` | primary, `readConcern: "majority"` ; `snapshot` dans les transactions | 0 écriture acquittée perdue en `majority`, 97 en `w: 1` |
| Tableau de bord | read model en `w: 1` (recalculable) | secondary (`secondaryPreferred`, `maxStalenessSeconds: 90`), `readConcern: "local"` | ne pas consommer la capacité du primary, notre point le plus fragile (annexe A, section 2 ter) |

Le client est réglé avec `retryWrites=true` et `heartbeatFrequencyMS=1000`, ce qui ramène l'interruption d'une panne au temps d'élection (section 5.3). Deux alternatives sont rejetées avec des chiffres : `w: 1` pour l'argent (97 écritures perdues en une coupure), et `w: 3`, qui bloquerait toutes les écritures dès qu'un seul nœud tombe. Le coût accepté : une écriture d'argent attend un deuxième nœud (6 à 7 ms en médiane sur notre machine, contre 2 ms en `w: 1` mesurées sans réseau), et les écritures échouent pendant les 10 s d'une élection, puis sont rejouées grâce à la clé d'idempotence.

## 5.6 Nos virements sur trois nœuds
Les tests de la Partie 4 avaient tourné sur un nœud unique, où `w: "majority"` équivaut à `w: 1`. Nous les avons rejoués sur `rs-fasopay`, où la majorité d'écriture vaut 2 (`preuves/04-transaction-rs3.txt`, `preuves/04-concurrence-rs3.txt`) : 36 vérifications OK sur 36 pour le contrat de `transfer()` (succès, rejeux, refus, abort prouvé, réponse perdue), et 10 sur 10 pour la concurrence (30 virements acceptés sur 50, solde final 0 jamais négatif, monnaie conservée, ledger = 60, outbox = 30, 5 conflits rejoués). La garantie de majorité ne change donc rien au comportement de `transfer()`, et elle lui ajoute la résistance à la perte d'un nœud mesurée dans les sections 5.2 à 5.4.

