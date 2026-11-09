# Notes Partie 1 (chiffres de preuves/01-validator-rejet.txt)

- Validateurs : 6 collections (customers, wallets, merchants, transactions, ledger_entries, outbox), strict / error.
- Données existantes : 0 invalide (2000, 2000, 150, 60000, 141939, 0).
- Rejets : code 121 pour chaque collection, détail errInfo capturé.
- Ledger : 71885 jambes avec wallet, 70054 sans (champ account), acceptées par le validateur (oneOf).
- Anti-pattern (ledger embarqué dans le wallet) : 2000 wallets, 35,94 lignes en moyenne, maximum 390 ; 4 831 octets en moyenne, maximum 52 346.