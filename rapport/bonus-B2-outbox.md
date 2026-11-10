# Bonus B2 · Relais Outbox par Change Stream

> Code : `code/B2-relais.js`, `code/B2-outils.js`, `code/B2-lancer.sh`. Preuve : `preuves/B2-relais-outbox.txt`. Commandes : annexe B, section 22.

## Le problème
`transfer()` écrit l'événement `outbox` dans la même transaction que le virement (Partie 4) : un virement validé a toujours son événement, un virement annulé n'en a jamais. Il reste à **envoyer** ces événements (notifications SMS ou push) sans en perdre un et sans en envoyer deux, même si le relais meurt n'importe quand.

## Notre relais
Le relais ouvre un Change Stream sur `outbox` avec un filtre **appliqué par le serveur** : seules les insertions d'événements `PENDING` lui parviennent ; ses propres mises à jour (passage à `SENT`) ne lui reviennent pas. Pour chaque événement, dans cet ordre :

1. il écrit la notification, avec **le même `_id` que l'événement** (`updateOne` avec `upsert: true` et `$setOnInsert`) ;
2. il passe l'événement à `SENT` ;
3. il sauvegarde le **jeton de reprise** de l'événement dans `relais_etat`.

Au redémarrage, il relit ce jeton et rouvre le Change Stream avec `resumeAfter` : il repart juste après le dernier événement dont le jeton est sauvegardé. Au tout premier démarrage, il sauvegarde un jeton avant même son premier événement, pour ne rien perdre s'il meurt tout de suite.

## Ce que nous avons mesuré

| Scénario | Ce qui s'est passé | Résultat |
|---|---|---|
| 1. `kill -9` au milieu d'une rafale de 1 000 virements | Relais tué après 324 notifications ; pendant 3 s sans relais, 410 événements s'accumulent en `PENDING` ; le relais relancé reprend « après 323 événements traités » | **1 relivraison reconnue**, 1 000 événements, 1 000 notifications, **0 perdu, 0 doublon** |
| 2. Arrêt juste après la 5e notification, avant `SENT` et avant le jeton | Relais sorti avec le code 9 ; à cet instant, 1 005 notifications pour 1 004 événements `SENT` | **1 relivraison reconnue**, 1 020 événements, 1 020 notifications, **0 perdu, 0 doublon** |

Le scénario 1 est celui de l'énoncé : le `kill -9` tombe au hasard. Ici, il est tombé entre la notification de l'événement 324 et la sauvegarde de son jeton, c'est-à-dire dans la fenêtre dangereuse. Le scénario 2 provoque exprès cette fenêtre, pour que la preuve ne dépende pas du hasard. Chaque scénario se termine par 6 vérifications, toutes OK : un événement par virement, aucun `PENDING` restant, aucun événement sans notification, aucune transaction notifiée deux fois (comptée sur `txId`), aucune notification sans événement, autant de notifications que d'événements.

## Pourquoi « au moins une fois »
Le jeton est sauvegardé **après** la notification. Si le relais meurt entre les deux, le jeton sauvegardé est celui de l'événement précédent : au redémarrage, le Change Stream relivre l'événement déjà notifié. Un événement n'est donc jamais perdu, mais il peut être livré deux fois. Sauvegarder le jeton **avant** la notification ferait l'inverse : jamais deux fois, mais un événement perdu à chaque arrêt dans cette fenêtre. Pour de l'argent, perdre une notification est pire que la recevoir deux fois : nous choisissons « au moins une fois ».

## Ce qui rend le résultat « exactement une fois »
La notification porte **le même `_id` que l'événement `outbox`**, et `_id` est unique dans une collection. Quand un événement est relivré, `upsert` avec `$setOnInsert` trouve la notification déjà écrite et ne change rien : le relais le voit (`upsertedCount` à 0) et l'écrit dans son journal (« relivraison reconnue, aucune notification en double »). La livraison est « au moins une fois », mais l'effet est « exactement une fois ». C'est le même principe que la clé d'idempotence de `transfer()` (Partie 4).

## Limites
- Le jeton ne sert que tant que l'événement est encore dans l'oplog. Si le relais reste arrêté plus longtemps que la fenêtre de l'oplog, `resumeAfter` échoue : il faut alors repartir des événements encore `PENDING` dans `outbox`, qui restent la référence.
- « Exactement une fois » vaut pour la collection `notifications`. Un vrai fournisseur de SMS devrait recevoir lui aussi une clé (l'`_id` de l'événement) pour ne pas envoyer deux SMS ; sinon, un SMS en double reste possible dans la fenêtre décrite plus haut.
- Mesure faite sur un Replica Set à un nœud, sur notre portable : le relais a suivi une rafale d'environ 118 virements/s (1 000 en 8,5 s). Le débit du relais au pic de 1 200 tx/s n'est pas mesuré : c'est l'un des seuils de retour de Kafka (Partie 7, 60 s de retard au pic).
