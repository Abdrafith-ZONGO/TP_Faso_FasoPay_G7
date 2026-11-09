# Partie 2 · Enquête : E1 · E2 · E3 · E4

> Brouillon de la section 4 du rapport. Les chiffres viennent de `preuves/02-enquete.txt` ; les pipelines commentés sont dans `code/02-enquete.js`.

## E1 : wallets dont le solde ne colle pas au ledger

**Question du CTO.** Quels wallets ont un `balance` différent de la somme signée de leur `ledger_entries` ? Combien, et quel écart total ?

**Méthode.** Pour chaque wallet, somme des lignes de ledger (crédit +, débit −), puis comparaison avec `wallets.balance`. La jointure se fait par `walletId`. Écart = `balance` − somme du ledger. Le `$match` écarte d'abord les 70 054 jambes sans wallet ; le `$group` précède le `$lookup` (2000 jointures au lieu de 71 885).

**Résultat.** 6 wallets sur 2000 (0,3 %) sont incohérents :

| Wallet | Solde stocké | Solde du ledger | Écart | Lignes de ledger |
|---|---|---|---|---|
| W001124 | 249 025 | 278 025 | −29 000 | 7 |
| W001372 | 557 152 | 585 152 | −28 000 | 33 |
| W000967 | 389 447 | 415 447 | −26 000 | 28 |
| W001796 | 949 293 | 960 793 | −11 500 | 49 |
| W000668 | 478 654 | 487 654 | −9 000 | 31 |
| W000769 | 75 692 | 41 192 | +34 500 | 86 |

Écart net : −69 000 FCFA. Écart absolu (somme des valeurs absolues) : 138 000 FCFA. Les écarts se compensent en partie, donc l'écart net sous-estime la taille du problème : on retient 138 000 FCFA comme mesure.

**Rattachement au fingerprint.** Le total des soldes est 832 251 836 (`walletsBalanceTotal`, vérifié en D3). Le total du ledger signé sur les wallets est 832 320 836. La différence est 69 000, égale à l'écart net : les deux chiffres s'expliquent par les 6 wallets, rien d'autre ne diverge. Couverture : 2000 wallets ont des lignes de ledger pour 2000 wallets au total.

**Lecture.** Pour chacun des 6 wallets, la dernière valeur `balanceAfter` du ledger est égale à la somme du ledger : la dernière ligne du ledger est cohérente avec la somme des lignes. C'est le solde stocké qui diverge, pas le ledger. Cinq wallets ont un solde stocké inférieur au ledger, un (W000769) un solde supérieur.

**Ce que cela implique.** C'est le risque décrit en Partie 1 : le solde est un cache du ledger, et un cache écrit hors de la transaction qui écrit le ledger diverge. Deux conséquences. D'abord, tout changement de solde doit passer par `transfer.js` (Partie 4), qui écrit ledger et solde ensemble. Ensuite, un contrôle de rapprochement (le pipeline E1) devrait tourner régulièrement. Pour corriger les 6 wallets, on passerait par des écritures d'ajustement dans le ledger plutôt que par une modification directe du solde, afin de garder la trace. E1 détecte les écarts, mais ne dit ni quand ni comment ils sont apparus.