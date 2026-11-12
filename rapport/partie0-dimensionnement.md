# Partie 0 · Dimensionnement (annexe A : feuille complète)

> Brouillon de la section 2 du rapport. Chiffres : `preuves/00-dimensionnement.txt` ; calculs : annexe A.

Avant de choisir une architecture, il faut savoir quelle quantité de données FasoPay devra stocker et traiter dans 18 mois. Nous ne pouvons pas mesurer directement 400 millions de transactions : nous mesurons donc la taille réelle de nos documents sur notre jeu de 60 000 transactions, puis nous la multiplions jusqu'à la cible. Ces chiffres décident ensuite de tout le reste : combien de serveurs, combien de mémoire, et s'il faut répartir les données sur plusieurs machines (le sharding).

Le POC pèse peu : une transaction fait 253 octets, une ligne de ledger 130, et une transaction métier en écrit 2,37 lignes, soit 561 octets pour 400 M de transactions par an, 224 Go de données et 308 Go avec les index (facteur ×1,37, mesuré après les index de la Partie 3).

Le working set (30 jours de transactions, leurs index et les 3 M de wallets) est d'environ **25,9 Go**. Le cache de MongoDB valant environ 50 % de (RAM − 1 Go), un nœud de **64 Go** suffit, avec 22 % de marge. À 6 écritures par virement, le pic de 1 200 tx/s fait 7 200 documents/s. Sur disque, la compression (0,51) et les index donnent 198,5 Go par an : 3,5 ans sur 700 Go utilisables (2 × 1 To en RAID 1), d'où l'archivage au-delà de 2 ans.

Ces chiffres pointent vers une architecture proportionnée : **un Replica Set, sans sharding, sans Spark, sans Redis, et sans Kafka au démarrage** à 18 mois. Le pic de 1 200 tx/s vaut 95 fois la moyenne : c'est lui qui dimensionne. Chaque composant écarté a un seuil de retour (annexe A, section 3) : par exemple le sharding à 490 M tx/an sur des nœuds de 64 Go, et Kafka dès qu'un deuxième consommateur indépendant des événements doit pouvoir les relire.

Un chiffre fragilise ce verdict : nos index ne pèsent que 27 octets par entrée, alors qu'à grande échelle on compte plutôt 40 à 60 octets. À 60 octets, le working set monterait à 34,3 Go et 64 Go ne suffiraient plus (annexe A, section 2 bis) : nous gardons 64 Go avec un seuil de surveillance, et nous passerions à 128 Go s'il est franchi. Un second chiffre le fragilise davantage : sur notre ordinateur portable, `transfer()` atteint 330 virements/s avec 4 clients (Partie 4), loin des 2 400 virements/s qu'il faudrait pour que le pic de 1 200 n'occupe que la moitié du primary. La mesure ne vaut pas pour un serveur, mais elle impose un test de charge sur le matériel cible avant de confirmer le verdict (annexe A, section 2 ter).

**À retenir.** un Replica Set de nœuds de 64 Go tient la cible à 18 mois en volume et en mémoire ; le débit du primary au pic reste à prouver sur le matériel cible, et nous le disons.
