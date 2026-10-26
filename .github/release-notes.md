Cashmyr pour ordinateur. La version web, qui s'installe aussi sur téléphone, est sur https://aiebou.github.io/Cashmyr/.

## Nouveautés de la 0.6.0

- **Budgets** : les trois usages deviennent trois budgets, « Dépenses courantes », « Loisirs » et « Épargne », que tu règles dans Paramètres → Budgets. Pour chaque budget, tu choisis le nom, la nature (dépense ou épargne), la couleur, l'ordre et le pourcentage de tes revenus ; le total doit faire 100 %. Tu peux créer un budget, qui arrive à 0 %, ou en supprimer un : ses catégories et sa part passent dans le budget que tu choisis.
- **Types** : un budget se divise en types, par exemple Charges fixes, Quotidien et Charge ponctuelle pour les Dépenses courantes, ou Épargne de précaution, Placement et Projet pour l'Épargne. Chaque catégorie de dépense peut recevoir un type.
- **Comptes et types** : un compte se rattache à un ou plusieurs types, et le premier est son type principal. À la saisie d'une opération, « Part réservée à » met une somme de côté pour un autre type du compte. Par exemple, un LEP de 10 000 € avec 1 200 € réservés au Projet donne 8 800 € à la précaution et 1 200 € au Projet. Mes comptes affiche la part de chacun.
- **Virements vers l'épargne** : ils comptent dans le budget du type principal du compte qui les reçoit ; sans type, ils comptent dans « Épargne ».
- **Épargne de précaution** : elle devient un type comme les autres. Sa carte ne montre plus que les comptes choisis, avec la part qui lui revient ; « Choisir les comptes » ouvre la liste à cocher.
- **Objectif d'un type d'épargne** : un type comme « Projet » peut recevoir un objectif, par exemple 3 000 €, depuis Paramètres → Budgets. Sa carte apparaît dans Objectifs, avec sa progression : « 1 200,00 € sur 3 000,00 € · 40 % ».
- **Catégories par défaut** : la liste est renouvelée. Quelques noms changent (« Assurance », « Impôt », « Sorties », « Vêtement », « Abonnement »), et six catégories arrivent : Aides, Remboursement et créance, Alimentaire, Remboursement de dettes, Placement et Consommable. Les anciennes catégories par défaut que tu n'avais jamais modifiées et qui ne sont plus dans la liste (par exemple Restaurants et bars, Crédit, PEA et ETF) disparaissent des choix. Tes opérations les gardent et elles comptent toujours dans leur budget ; reclasse-les si tu le souhaites. Les catégories que tu as créées ou modifiées ne changent pas.

**Format des données.** Il passe au format 3. À la première ouverture, tes données sont mises à niveau sans qu'aucun chiffre ne change :
- les usages deviennent les budgets, avec leur répartition ;
- l'objectif de précaution devient celui du type « Épargne de précaution » ;
- un compte coché « Épargne de précaution » est rattaché à ce type.

Chaque appareil doit passer en 0.6.0. Une version 0.5 qui reçoit un fichier au format 3 affiche « Mets l'application à jour » sans rien modifier. La version web propose d'elle-même la nouvelle version.

## Télécharger

| Système | Fichier à télécharger |
|---|---|
| macOS 12 ou plus récent, Apple Silicon et Intel | `Cashmyr_…_universal.dmg` |
| Windows 10 et 11 | `Cashmyr_…_x64-setup.exe` |
| Linux (x86_64) | `.AppImage`, `.deb` ou `.rpm` |

Les binaires ne sont pas signés par une autorité : la première ouverture demande une confirmation, expliquée dans le [README](https://github.com/Aiebou/Cashmyr#installer-lapplication-de-bureau).

Déjà installée ? Paramètres → Application → « Rechercher une mise à jour ».
