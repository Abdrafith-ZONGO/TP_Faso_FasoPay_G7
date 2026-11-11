# 10. Synthèse CTO : 5 priorités pour les 12 prochains mois

**Notre verdict en une phrase :** FasoPay n'a pas besoin d'une plateforme de données, mais d'un Replica Set de 3 nœuds bien réglé, d'un `transfer()` utilisé partout et d'un contrôle quotidien de l'argent ; coût indicatif **483,37 € HT par mois, soit environ 317 070 FCFA**.

## Les 5 priorités, dans l'ordre

**1. Réparer la confiance dans les soldes (mois 1).**
Corriger les **6 soldes incohérents** trouvés par E1 (écart absolu de 138 000 FCFA) en partant du ledger, qui fait foi ; puis lancer chaque nuit le rapprochement ledger / soldes. *Mesure de réussite :* 0 écart chaque matin, et tout nouvel écart vu par la finance avant le support.

**2. Faire passer 100 % des flux d'argent par `transfer()` (mois 1 à 3).**
Une seule transaction pour la transaction, les deux lignes de ledger, les soldes et l'outbox, avec une clé d'idempotence obligatoire. C'est la réponse aux paiements en double du 10/04 (E4 : **21 clés** rejouées) : nos tests montrent 1 seul débit pour 3 rejeux et 30 virements acceptés sur 50 en concurrence, jamais de solde négatif (Partie 4). *Mesure :* 0 doublon, 0 solde négatif.

**3. Mettre en production le Replica Set sûr (mois 2 à 4).**
3 nœuds de 64 Go dans des centres de données différents, `w: "majority"` pour l'argent, clients réglés à 1 s (interruption ramenée de 21,2 s à 10,6 s pendant une panne, 0 écriture perdue : Partie 5), sauvegardes avec restauration à un instant donné **testée**, TLS, disques chiffrés, et les trois rôles minimaux (18 vérifications sur 18 : l'application ne peut ni modifier ni supprimer le ledger).

**4. Donner à la conformité et à la finance leurs outils (mois 3 à 6).**
Alerte automatique dans `fraud_alerts` pour les découpages sous le plafond journalier (E2 : 5 wallets aujourd'hui) ; read model `ca_marchands` pour le tableau de bord et les règlements, lu sur un secondary ; relais outbox pour les notifications. Consulter dès maintenant la **CIL** (serveurs hors du Burkina Faso) et intégrer les exigences de la **BCEAO**.

**5. Mesurer avant de grandir (mois 4 à 12).**
Test de charge sur le matériel cible avant la mise en production : il faut **2 400 virements/s** sur le primary, nous en avons mesuré 330 sur un portable. Puis suivre chaque mois les seuils qui déclenchent la suite : working set au-delà de 50 % de la RAM, index au-delà de 45 octets par entrée, volume vers 490 M tx/an. La clé de sharding est déjà choisie (`{ walletCle: "hashed" }`) : le jour venu, nous saurons quoi faire.

## Ce que nous ne ferons PAS

| Nous ne ferons pas | Parce que (nos chiffres) | Sauf si |
|---|---|---|
| Kafka | un seul consommateur des événements | un deuxième consommateur indépendant doit les relire |
| Spark ou un Data Lake | 615 Mo de données nouvelles par jour ; E3 en 23 ms | plus de 1 To à transformer par cycle |
| Redis devant les soldes | 0,43 Go de soldes en cache, lecture par index unique en 0 ms médiane (Q3) ; un cache créerait un second solde qui peut diverger | p99 du solde au-delà de 20 ms sous charge |
| Sharding | 400 M tx/an, working set à 40 % de la RAM | 490 M tx/an ou test de charge insuffisant |
| Une architecture Lambda | pas de double besoin temps réel + recalcul lourd | les deux besoins à la fois |
| Modifier ou supprimer une ligne de ledger | le ledger est la preuve de l'argent ; une erreur se corrige par une écriture de correction | jamais |
| Changer de base de données | MongoDB couvre transactions, réplication, Change Streams et agrégats, et tout notre POC tourne dessus | jamais sans mesure qui le justifie |

**La décision à prendre maintenant :** valider la cible PME (ADR-003) et commander le test de charge sur le matériel cible ; c'est le seul chiffre qui pourrait changer cette architecture.
