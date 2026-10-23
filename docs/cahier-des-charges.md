# Cahier des charges de Cashmyr

Le cahier des charges remis le 23/09/2026, au début du développement, suivi de ses deux compléments du même jour.
Les trois textes ont été collés dans la première session de Claude Code. Ils sont repris ici mot pour mot, avec deux
exceptions :
- les passages personnels (revenus, comptes, habitudes, fichiers de l'autrice ou de l'auteur) sont remplacés par des
  formulations génériques ;
- les exemples chiffrés (montants, dates d'échéance) sont des valeurs d'illustration, qui suivent les mêmes règles de
  calcul.

Seule la mise en forme des compléments a été reprise : intertitres, et le bloc d'identité du projet en bloc de code.

**Ce texte n'est plus la référence.** Les règles tranchées depuis sont dans [`architecture.md`](architecture.md),
au §8, et priment en cas d'écart. Principaux écarts, liste non exhaustive :
- **Revenu moyen** : les mois vides comptent pour 0, et la fenêtre ne remonte pas avant la première opération
  (complément 1, point 7 ; décision 7). Le texte initial dit l'inverse.
- **Valeur déclarée** : elle entre dans le total du bandeau et dans le patrimoine net (décisions 42 à 44, 62), alors
  que le texte initial ne l'affiche qu'en écart.
- **Bandeau du tableau de bord** : trois totaux au choix (décisions 42 et 62).
- **Dépenses moyennes** (épargne de précaution, capacité) : même règle et même N que le revenu moyen, mois vides
  compris, relativement au mois en cours (décision 8), et non « les 6 derniers mois renseignés ».
- **Patrimoine net** : toujours en valeurs déclarées, quel que soit le total affiché (décision 44), et non « le total
  des comptes » du complément 2. **Total dû** : les dettes soldées en sont aussi exclues (décision 28).
- **Purge des pierres tombales** : seulement une fois vues par tous les appareils, jamais si une ligne vivante y
  renvoie, jamais sans fichier de synchronisation (décisions 2, 20 et 21).
- **Montants** : au centime partout depuis la 0.2.0, gros chiffres compris.
- **Mise à jour du bureau** : le texte demande seulement d'activer l'updater ; elle est recherchée au lancement
  (désactivable) et sur clic (décision 46, qui remplace la 17).
- **macOS** : depuis macOS 15, le clic droit puis « Ouvrir » ne suffit plus ; le README donne le chemin par
  Réglages Système.
- Les profils, les tags, l'écran de secours, la remise à zéro et le tutoriel sont venus ensuite. Voir
  [`passation.md`](passation.md), §1.

## Sommaire

1. [Texte initial](#texte-initial)
2. [Complément 1 : réponses aux premières questions](#complément-1--réponses-aux-premières-questions)
3. [Complément 2 : lot d'ajouts](#complément-2--lot-dajouts)

---

## Texte initial

**Prompt pour Claude Code — application de gestion budgétaire (PWA + bureau)**

> Copiez tout ce qui suit le trait horizontal dans Claude Code, dans un dossier vide.
> Joignez un export JSON de l'application web actuelle (onglet Paramètres → Exporter en JSON), par exemple `mes-finances.json`. Il sert de jeu de reprise et de référence de calcul.

---

### Contexte

Je veux reconstruire en application autonome un outil de gestion de budget personnel qui existe déjà sous forme de page web. Deux cibles, un seul code :

- **une PWA** publiée sur GitHub Pages, installable depuis un lien sur ordinateur, Android et iPhone, et que l'on puisse partager gratuitement ;
- **une application bureau** empaquetée avec Tauri, distribuée en binaires sur GitHub Releases.

Aucun serveur, aucun compte utilisateur, aucune donnée chez moi. Chaque personne garde ses données sur sa machine, et relie ses appareils par un fichier posé dans son propre cloud (iCloud Drive, Google Drive, Dropbox, Syncthing — au choix de l'utilisateur).

Les revenus peuvent venir de plusieurs sources, et d'autres peuvent s'ajouter. L'application ne demande jamais « quel est ton salaire » : elle déduit les revenus des opérations saisies. L'argent peut être réparti sur plusieurs comptes, dont on veut suivre les montants injectés et retirés, pas la valeur de marché.

### Stack imposée

- **React 18 + TypeScript**, build **Vite**. Monorepo en **pnpm workspaces**, sans Turborepo ni Nx.
- Bureau : **Tauri v2** (ligne 2.11 ou plus récente), plugins `fs`, `dialog`, `store`.
- Persistance locale : **IndexedDB** via `idb` côté web, fichier JSON dans le répertoire de données de l'app côté bureau.
- État : **Zustand**. Pas de Redux.
- Styles : **CSS modules**. Pas de Tailwind, pas de librairie de composants.
- Graphiques : **SVG écrit à la main**. Pas de Chart.js, Recharts ni D3.
- Tests : **Vitest** sur la couche calcul et la couche fusion.
- Aucun appel réseau au runtime. L'application doit fonctionner entièrement hors ligne, avion activé, au premier lancement comme au centième.

### Architecture du dépôt

```
packages/core/     logique métier pure : calculs, fusion, migrations. Zéro import React, zéro accès au stockage.
packages/ui/       composants React partagés par les deux cibles.
packages/storage/  adaptateurs : LocalStore (IndexedDB | fichier) et SyncFile (accès au fichier cloud).
apps/web/          PWA : manifest, service worker, icônes. Déployée sur GitHub Pages.
apps/desktop/      enveloppe Tauri. Produit les binaires des Releases.
```

`apps/web` et `apps/desktop` ne contiennent que le point d'entrée, la configuration de build et les adaptateurs de plateforme. Tout écran vit dans `packages/ui`. Si un comportement diverge entre les cibles, il passe par une abstraction déclarée dans `packages/storage`, jamais par un `if (isTauri)` dispersé dans les composants.

Dépôt public, licence MIT, pour que GitHub Pages soit gratuit et que d'autres puissent reprendre le code. Aucune donnée personnelle ne doit jamais être commitée.

### Modèle de données

Chaque enregistrement porte ses métadonnées de synchronisation. Elles sont indispensables : deux appareils peuvent être modifiés hors ligne puis se retrouver.

```ts
type Meta = {
  id: string;            // uuid v4
  updatedAt: number;     // epoch ms, horloge locale de l'appareil qui a écrit
  deletedAt: number | null; // pierre tombale : on ne supprime jamais une ligne, on la marque
};

type Bucket = "besoin" | "envie" | "invest";
type Role = "courant" | "epargne" | "invest" | "autre";
type OpType = "in" | "out" | "tx";

type Category = Meta & { name: string; kind: "in" | "out"; bucket?: Bucket };

type Account = Meta & {
  name: string; role: Role;
  opening: number;          // solde de départ en centimes, point zéro du suivi
  safety: boolean;          // entre dans l'épargne de précaution
  declaredValue?: number;   // valeur saisie à la main, facultative, jamais calculée
  declaredAt?: string;
};

type Operation = Meta & {
  date: string;             // "YYYY-MM-DD"
  amount: number;           // centimes, toujours positif ; le signe vient du type
  type: OpType;
  note: string;
  categoryId?: string;      // types "in" et "out"
  accountId?: string;       // types "in" et "out"
  fromAccountId?: string;   // type "tx"
  toAccountId?: string;     // type "tx"
  goalId?: string;          // rattachement facultatif à un objectif
  recurrenceId?: string;    // si l'opération a été générée automatiquement
};

type GoalStep = Meta & {
  goalId: string; label: string; amount: number; done: boolean; position: number;
};

type Goal = Meta & {
  name: string;
  target: number;                     // centimes, utilisé si targetMode = "manual"
  targetMode: "manual" | "steps";     // "steps" : la cible est la somme des postes
  source: "tagged" | "account";       // suivi par opérations rattachées, ou par solde de compte
  accountIds: string[];               // utilisé si source = "account"
  due: string | null;                 // échéance "YYYY-MM-DD"
  hidden: boolean;                    // retiré du tableau de bord
  pinned: boolean;                    // épinglé en tête, reste visible même une fois atteint
  done: boolean; doneAt: string | null;
  archived: boolean;
  position: number;
};

type Recurrence = Meta & {
  label: string; amount: number; type: OpType;
  categoryId?: string; accountId?: string;
  fromAccountId?: string; toAccountId?: string;
  goalId?: string;
  dayOfMonth: number;      // 1–31, rabattu sur le dernier jour des mois courts
  startMonth: string;      // "YYYY-MM"
  endMonth: string | null;
  active: boolean;
};

type Skip = Meta & { month: string; recurrenceId: string }; // occurrence annulée

type Preferences = {
  splits: { besoin: number; envie: number; invest: number }; // fractions, somme ≈ 1
  basis: "month" | "avg";
  averageWindow: 3 | 6 | 12;
  safety: { mode: "months" | "amount"; months: number; amount: number; hidden: boolean; pinned: boolean };
  dashOrder: string[];     // ordre des blocs du tableau de bord
  theme: "system" | "light" | "dark";
  updatedAt: Record<keyof Preferences, number>; // horodatage par clé, pour la fusion
};
```

Tous les montants sont des **entiers en centimes** dans le stockage. La conversion en euros n'existe qu'à l'affichage et à la saisie. Aucun flottant ne doit atteindre la base.

### Stockage et synchronisation

C'est la partie délicate. Lis-la en entier avant de proposer quoi que ce soit.

**Source de vérité locale.** Chaque appareil garde son jeu complet d'enregistrements : IndexedDB dans la PWA, fichier JSON dans le répertoire de données de l'application sous Tauri. L'application est utilisable à 100 % sans jamais configurer de synchronisation.

**Fichier de synchronisation.** Un unique document JSON, `finances-sync.json`, que l'utilisateur place où il veut dans un dossier synchronisé par son propre service. Il contient les mêmes collections, avec leurs métadonnées.

**Fusion.** Jamais de remplacement de fichier en bloc. À chaque synchronisation, fusionner enregistrement par enregistrement :
- une ligne présente d'un seul côté est reprise ;
- une ligne présente des deux côtés garde la version dont `updatedAt` est le plus élevé ;
- `deletedAt` non nul gagne sur une modification plus ancienne, et la pierre tombale se propage ;
- pour `Preferences`, la fusion se fait clé par clé selon `updatedAt[clé]`, pas sur l'objet entier ;
- les pierres tombales de plus de 90 jours sont purgées des deux côtés.

Écriture atomique obligatoire : écrire dans un fichier temporaire à côté, puis renommer. Un cloud qui synchronise un fichier à moitié écrit corrompt tout.

**Ce que chaque plateforme permet réellement.** N'invente pas de capacité qui n'existe pas, et ne promets rien dans l'interface que la plateforme ne tienne pas :

| Cible | Accès au fichier | Comportement à implémenter |
|---|---|---|
| Bureau Tauri | complet | L'utilisateur choisit le fichier une fois via `plugin-dialog`. Lecture au lancement, à la reprise de focus, et écriture différée de 2 s après chaque modification. |
| PWA sur navigateur Chromium de bureau | File System Access API | Même comportement, le handle de fichier est conservé dans IndexedDB et redemandé si la permission expire. |
| PWA sur Safari, Firefox, et tout mobile | aucun accès direct | Synchronisation assistée : un bouton « Synchroniser » ouvre le sélecteur de fichiers, l'utilisateur désigne le fichier dans son app Fichiers, l'application fusionne, puis propose le fichier fusionné à l'enregistrement pour qu'il écrase l'original. |

L'écran de synchronisation doit indiquer sans détour quel mode est actif sur l'appareil courant, la date de la dernière fusion réussie, et le nombre de modifications en attente. Si une plateforme ne peut pas synchroniser automatiquement, dis-le dans l'interface plutôt que de laisser croire que ça tourne en arrière-plan.

### Règles de calcul — à implémenter exactement

Module `packages/core`, fonctions pures, chacune couverte par un test.

**Agrégats d'un mois**
- `income` = somme des opérations `in`.
- `incomeBySource` = même somme groupée par catégorie, pour la barre segmentée.
- `needs` = somme des `out` dont la catégorie a `bucket = "besoin"`.
- `wants` = idem pour `bucket = "envie"`.
- `saved` = somme des `out` en `bucket = "invest"`, **plus** les transferts entrants vers un compte de rôle `epargne` ou `invest`, **moins** les transferts sortants depuis ces mêmes comptes. Un retrait d'un compte de placement vers le compte courant diminue donc la mise de côté du mois.
- `spent` = `needs + wants`.
- `balance` = `income − spent − saved`.

**Revenu moyen.** Moyenne de `income` sur les `averageWindow` mois **précédant** le mois affiché, en ne comptant que les mois contenant au moins une opération. Les mois vides ne tirent pas la moyenne vers le bas. `null` s'il n'y a aucun mois exploitable : afficher alors un message d'attente, jamais un zéro.

**Base des cibles.** Si `basis = "avg"` et qu'une moyenne existe, la base est la moyenne ; sinon les revenus du mois affiché. Chaque cible vaut `base × splits[bucket]`. L'interface indique toujours sur quoi le calcul repose.

**Soldes de comptes.** `opening`, plus les `in` qui créditent, moins les `out` qui débitent, plus les transferts reçus, moins les transferts émis. C'est un capital net injecté, jamais une valeur de marché. Si `declaredValue` est renseignée, afficher l'écart avec le capital injecté, sans jamais l'utiliser ailleurs.

**Épargne de précaution**
- Constituée = somme des soldes des comptes dont `safety` est vrai.
- Objectif = `safety.amount` en mode montant fixe, sinon `safety.months × moyenne de (needs + wants) sur les 6 derniers mois renseignés`.
- **Capacité** = `constituée ÷ moyenne mensuelle des dépenses courantes`, affichée en mois avec une décimale, juste sous la ligne d'objectif. Exemple attendu : 1 200 € de dépenses mensuelles, objectif 3 mois soit 3 600 €, 5 400 € constitués → « Capacité actuelle : 4,5 mois de dépenses courantes ».
- Le choix des comptes qui composent le matelas se fait sur la fiche elle-même, par cases à cocher, pas dans un écran de paramètres éloigné.
- Cette fiche est épinglée par défaut : elle ne disparaît pas du tableau de bord une fois l'objectif atteint.

**Objectifs**
- `target` = `goal.target` en mode `manual`, somme des `amount` des postes en mode `steps`.
- Avancement en mode `account` : somme des soldes des comptes listés.
- Avancement en mode `tagged`, sur les opérations portant ce `goalId` :
  - transfert vers un compte `epargne` ou `invest` : `+ montant` ;
  - transfert depuis un compte `epargne` ou `invest` : `− montant` ;
  - revenu : `+ montant` ;
  - dépense en `bucket = "invest"` : `+ montant` ;
  - dépense en `besoin` ou `envie` : `− montant`, c'est l'objectif qui se vide quand on paie enfin l'achat prévu.
- Échéance : afficher la date, le temps restant, et la mensualité nécessaire `(cible − avancement) ÷ mois restants`. Une échéance dépassée et non atteinte s'affiche en rouge.
- Postes : liste ordonnée avec libellé, montant et case « réglé ». Résumé sous la jauge : « 2 postes sur 4 réglés · 600 € sur 1 500 € ».
- États et filtrage du tableau de bord : un objectif y apparaît s'il n'est ni archivé, ni masqué, et s'il n'est pas atteint **ou** qu'il est épinglé. Les épinglés passent en tête.
- L'onglet Objectifs montre tout : en cours, atteints dans leur propre section, archivés dans une liste compacte avec restauration et suppression définitive.

**Récurrences**
- Au lancement et après toute modification d'une récurrence, matérialiser les occurrences manquantes de `startMonth` jusqu'au mois en cours inclus, borné par `endMonth`.
- Une occurrence n'est créée que s'il n'existe pas déjà une opération vivante portant ce `recurrenceId` pour ce mois, et si le couple (mois, récurrence) n'a pas de `Skip`. La génération doit être **strictement idempotente** : l'exécuter dix fois de suite ne change rien.
- Annuler une occurrence supprime l'opération et crée un `Skip`. Rétablir supprime le `Skip` et régénère.
- Modifier une récurrence ne touche pas aux occurrences déjà créées. La supprimer conserve l'historique généré. Dis-le dans l'interface.
- Jamais de génération pour un mois futur. Dans un mois futur, afficher la liste de ce qui est prévu, en lecture seule.

### Écrans

Six onglets : **Tableau de bord · Mois · Objectifs · Mes comptes · Opérations · Paramètres**. Un sélecteur dans l'en-tête, qui porte l'année sur Tableau de bord, Objectifs et Mes comptes, et le mois sur Mois et Opérations.

**Tableau de bord.** En tête, fixe : le total épargne et placements, décomposé par compte en barre segmentée, le solde du compte courant, et l'écart avec la valeur déclarée si elle existe. En dessous, cinq blocs **réordonnables** dont l'ordre est enregistré dans `dashOrder` : les objectifs, trois indicateurs (revenu moyen, taux d'épargne de l'année, dépenses moyennes par mois), le graphique 12 mois, la courbe de progression de l'épargne, le classement des postes de dépense. Chaque bloc porte une petite barre discrète en haut à droite, plus marquée au survol : une poignée de glisser-déposer et deux flèches. Les flèches sont indispensables : le glisser-déposer HTML5 ne fonctionne pas au doigt.

**Mois.** Revenus du mois en très grand, décomposés par source. Moyenne des N derniers mois en sous-titre. Trois jauges Besoins / Envies / Épargne, chacune avec réalisé, cible et un trait vertical marquant la cible. Trois indicateurs : dépensé, mis de côté, reste sur le courant. Six dernières opérations.

**Objectifs.** L'épargne de précaution puis chaque objectif, en cartes espacées d'au moins 18 px. Chaque carte : jauge, échéance, résumé des postes, et quatre actions en haut à droite — masquer du tableau de bord, épingler, marquer atteint, archiver. Sous la jauge, les champs d'édition : nom, montant cible, échéance, mode de cible, mode de suivi, compte associé, liste des postes, suppression définitive avec confirmation. Puis un formulaire de création, la section des objectifs atteints, la section des archives.

**Mes comptes.** Total suivi, puis une ligne par compte : solde, montants entrés et sortis, solde de départ, valeur déclarée et son écart. Section des mouvements de l'année, entrées et sorties par compte. Bouton de transfert.

**Opérations.** Liste complète du mois, triée par date décroissante, chaque ligne ouvrant l'édition. Les opérations générées portent un marqueur discret. Section des récurrences ignorées ce mois avec bouton de rétablissement. Filtres par type, catégorie, compte et objectif. Recherche plein texte sur le libellé.

**Paramètres.** Répartition cible avec contrôle de la somme. Base de calcul et fenêtre de moyenne. Comptes : nom, rôle, solde de départ, valeur déclarée. Récurrences : création, modification, pause, suppression. Catégories. Synchronisation : choix du fichier, état, dernière fusion, bouton manuel. Export CSV et JSON, import JSON, thème.

**Saisie d'une opération** — le geste le plus fréquent, soigne-le. Modale avec sélecteur Dépense / Revenu / Transfert. Le montant est le premier champ, en grand, clavier numérique, virgule décimale acceptée, validation par Entrée. Puis catégorie et compte, ou comptes source et destination pour un transfert. Rattachement facultatif à un objectif. Date pré-remplie au jour courant, ou au premier du mois affiché si ce n'est pas le mois en cours. Libellé facultatif. Case « répéter chaque mois » qui crée la récurrence à partir du mois suivant. Raccourci clavier global sur bureau.

### Direction visuelle

- Palette claire : papier `#F1F0EA`, panneaux `#FBFAF6`, encre `#1B222C`, texte secondaire `#525C69`, filets `#DCD9D0`. Accents : besoins `#3E5C76`, envies `#BE8534`, épargne `#4F8468`, négatif `#A8503F`.
- Palette sombre : fond `#13171D`, panneaux `#1A1F27`, encre `#E9E6DE`, accents éclaircis `#6E96B8`, `#D9A54E`, `#71B08E`, `#D4785F`. Bascule claire / sombre / système.
- Typographie : **Spectral** pour les titres et les montants affichés en gros, **Archivo** pour l'interface. `font-variant-numeric: tabular-nums` sur tous les chiffres. **Polices embarquées en woff2 dans le dépôt**, jamais chargées depuis Google Fonts : l'application doit s'afficher correctement hors ligne dès le premier lancement.
- Sept couleurs de série pour distinguer les sources de revenus, les comptes et les objectifs, attribuées dans l'ordre de création.
- Montants via `Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })`, sans décimales dans les gros chiffres, deux décimales dans les listes.
- Pas d'animation décorative. Seules les ouvertures de modale et les confirmations d'action méritent une transition.
- Focus clavier visible, contraste suffisant, `prefers-reduced-motion` respecté, zones tactiles d'au moins 44 px. Respect des encoches : `viewport-fit=cover` et `env(safe-area-inset-*)`.

### Reprise des données existantes

`mes-finances.json` contient `{ settings, months }`, où `months` est un objet indexé par `"YYYY-MM"` contenant `items` et `skips`, et où les montants sont en euros décimaux. Écris un importateur qui convertit vers le nouveau schéma, en centimes, avec génération des métadonnées de synchronisation. Vérifie que les totaux par mois, les soldes par compte et l'avancement de chaque objectif sont identiques avant et après conversion. Fais échouer l'import bruyamment plutôt que d'accepter une conversion partielle.

### Qualité et tests

Couche `core` sans effet de bord, testée :
- agrégats mensuels, y compris un retrait depuis un compte d'épargne qui diminue la mise de côté ;
- moyenne glissante en présence de mois vides ;
- soldes de comptes avec transferts dans les deux sens ;
- objectif en mode compte et en mode opérations rattachées, avec versement, retrait et dépense finale ;
- cible calculée sur la somme des postes ;
- mensualité nécessaire selon l'échéance, échéance dépassée, échéance à moins d'un mois ;
- épargne de précaution dans les deux modes, et capacité en mois ;
- filtrage du tableau de bord selon masqué / épinglé / atteint / archivé, et tri des épinglés en tête ;
- génération de récurrences idempotente, annulation, rétablissement, récurrence au 31 sur un mois de 28 jours ;
- fusion : ligne ajoutée d'un seul côté, modification concurrente, suppression contre modification plus ancienne, suppression contre modification plus récente, fusion des préférences clé par clé, purge des pierres tombales.

Sauvegarde automatique du fichier local à chaque démarrage, cinq copies tournantes conservées. L'application démarre sur des données vides sans erreur et propose une action claire sur chaque écran vide.

### Publication

**PWA → GitHub Pages.** Workflow `deploy-pages.yml` déclenché sur `main` : build de `apps/web`, publication via `actions/deploy-pages`. Configure `base` dans Vite selon le nom du dépôt. Manifest complet avec icônes maskable 192 et 512, `display: standalone`, service worker qui précache toute la coquille et sert l'application hors ligne, gestion propre de la mise à jour (proposer « Nouvelle version disponible, recharger » plutôt que recharger de force). L'installation doit marcher sur Chrome bureau, Chrome Android et « Ajouter à l'écran d'accueil » sur iOS Safari.

**Bureau → GitHub Releases.** Workflow `release.yml` déclenché sur tag `v*`, matrice macOS / Windows / Linux, via `tauri-apps/tauri-action`, artefacts attachés à la Release. Active l'updater Tauri avec sa propre paire de clés, la clé privée en secret de dépôt.

Les binaires ne seront pas signés par une autorité. Explique dans le README, en deux phrases sobres, l'avertissement SmartScreen sur Windows et le clic droit puis « Ouvrir » sur macOS. N'essaie pas de contourner ces mécanismes.

**README.md** court : à quoi sert l'application, le lien vers la PWA, les liens de téléchargement, comment configurer le fichier de synchronisation sur chaque plateforme et ce que chacune permet réellement, où vivent les données, comment les sauvegarder, comment lancer en développement et faire tourner les tests.

### Déroulé attendu

1. Propose l'arborescence du monorepo, le schéma des collections et l'interface des adaptateurs de stockage. Attends ma validation avant d'écrire le reste.
2. Implémente `packages/core` avec ses tests, calculs puis fusion. Montre-moi la sortie de `vitest` au vert.
3. Implémente `packages/storage` et ses trois adaptateurs, avec un test de bout en bout de la fusion entre deux jeux de données divergents.
4. Construis l'interface écran par écran, en commençant par la saisie d'opération, puis Mois, puis Objectifs.
5. Branche l'importateur et vérifie la reprise d'un fichier JSON exporté depuis l'application actuelle.
6. Mets en place les deux workflows GitHub et produis une première Release ainsi qu'un déploiement Pages.

Pose-moi une question dès qu'une règle métier est ambiguë. Ne devine jamais sur un calcul financier ni sur une règle de fusion.

---

## Complément 1 : réponses aux premières questions

Réponses aux questions 5, 7 et 18 posées après la lecture du texte initial.

**Récurrences**

5. Il faut pouvoir choisir la date de la récurrence.

**Calculs**

7. Il faut prendre en compte les mois vides, mais pouvoir choisir le nombres de mois, par exemples "Les 3 derniers mois", ou "Les 6 derniers mois". Pour un mois "non vide", c'est au moins une opération de n'importe quel type.

18\. Identité du projet :

```
Nom de l'application : Cashmyr
Identifiant de bundle : io.github.aiebou.cashmyr
Compte GitHub : Aiebou
Dépôt : Cashmyr (public, vide, sans README ni .gitignore)
Base Vite : /Cashmyr/
URL de la PWA : https://aiebou.github.io/Cashmyr/
Updater : https://github.com/Aiebou/Cashmyr/releases/latest/download/latest.json
```

Crée le .gitignore dès la première étape, couvrant Node, Rust/Tauri, macOS,
et les fichiers de données : mes-finances.json, finances-sync.json, *.sqlite

---

## Complément 2 : lot d'ajouts

Deux messages envoyés à la suite pendant l'étape 2 : la consigne, puis le lot lui-même.

**La consigne**

Voici un lot d'ajouts à la spécification. Tu es à l'étape 2, c'est le bon moment.

Intègre maintenant, dans packages/core et son schéma :
- la section 1 (dettes) : nouvelle collection Debt, champ debtId sur Operation
  et Recurrence, et toutes les règles de calcul associées ;
- la section 7 : les cas de test correspondants.

Les sections 2 à 6 concernent l'interface et les styles : garde-les pour
l'étape 4, ne les implémente pas tout de suite.

Avant d'écrire quoi que ce soit, redonne-moi le schéma des collections mis à
jour, comme à l'étape 1, pour que je le valide. Puis reprends l'étape 2 là où
tu en étais, dettes incluses, et montre-moi vitest au vert sur l'ensemble.

**Le lot**

Voici un lot d'ajouts et de corrections à intégrer à la spécification que tu implémentes. Si tu as déjà écrit du code sur les parties touchées, adapte-le plutôt que de repartir de zéro. Si une de ces demandes contredit un choix que nous avions validé ensemble, signale-le-moi avant de trancher.

### 1. Nouvelle entité : les dettes

C'est l'ajout le plus important. Une septième onglet Dettes vient après Objectifs, et un bloc debts s'ajoute au tableau de bord.

**Modèle**

```ts
type Debt = Meta & {
  name: string;
  creditor: string;                      // organisme ou personne, libre
  direction: "owe" | "lent";             // « je dois » ou « on me doit »
  principal: number;                     // centimes, montant total
  paidManual: number;                    // centimes déjà réglés hors application
  mode: "installments" | "free";
  installmentAmount: number;             // centimes
  installmentCount: number;
  startDate: string;                     // "YYYY-MM-DD", première échéance
  dayOfMonth: number;                    // déduit de startDate, modifiable
  categoryId: string | null;             // catégorie utilisée pour les paiements
  accountId: string | null;              // compte débité ou crédité
  recurrenceId: string | null;           // prélèvement automatique associé
  hidden: boolean; pinned: boolean;
  settled: boolean; settledAt: string | null;
  archived: boolean;
  position: number;
};

```

`Operation` et `Recurrence` gagnent un champ `debtId?: string`, qui fonctionne exactement comme `goalId`.

**Calculs — à implémenter exactement**

* Montant total = `principal` s'il est renseigné, sinon `installmentAmount × installmentCount` en mode `installments`, sinon 0.
* Montant réglé = `paidManual` plus les opérations portant ce `debtId` :
   * direction `owe` : une dépense ou un transfert ajoute, un revenu retranche ;
   * direction `lent` : un revenu ajoute, tout le reste retranche.
* Reste = `max(0, total − réglé)`.
* Échéancier = `installmentCount` dates mensuelles à partir du mois de `startDate`, au jour `dayOfMonth`, rabattu sur le dernier jour des mois courts.
* Échéances couvertes = `floor(réglé ÷ installmentAmount)`, plafonné à `installmentCount`. Sert au remplissage des segments.
* Échéances restantes = `ceil(reste ÷ installmentAmount)`. La dernière peut être réduite : son montant vaut `reste − (échéances restantes − 1) × installmentAmount`.
* Prochaine échéance = l'entrée de l'échéancier à l'indice `installmentCount − échéances restantes`. Marquée « en retard » si la date est passée, et « dans N jours » si elle tombe sous sept jours.
* Date de solde = l'entrée à l'indice `prochaine + échéances restantes − 1`, plafonnée au dernier élément.
* Charge mensuelle = somme des `installmentAmount` des dettes actives, non soldées, non archivées, en direction `owe`, en mode `installments`, et dont le reste est strictement positif.
* Total dû = somme des restes des dettes non archivées en direction `owe`.

Ne raisonne pas en « nombre d'échéances réglées » dans les textes affichés : dès qu'un versement sort de l'échéancier, ce compte devient faux. Raisonne toujours en montant restant, puis convertis en nombre d'échéances restantes. La phrase attendue sous la jauge est de cette forme : « reste 1 échéance de 75 € · prochaine le 5 mars 2027 · soldée en mars 2027. »

**Versement ponctuel**

Chaque fiche de dette commence par un encadré sur fond légèrement contrasté, intitulé Versement ponctuel (ou Remboursement reçu en direction `lent`) : un champ montant, un champ date pré-rempli au jour courant, un bouton, et une case cochée par défaut « Créer aussi l'opération dans mon budget ».

* Case cochée : crée une vraie opération, de type `out` en direction `owe` et `in` en direction `lent`, rattachée à la dette, avec la catégorie et le compte de la dette, et un libellé « Versement — <nom de la dette> ». L'argent a réellement quitté le compte, le budget du mois doit le refléter.
* Case décochée : incrémente simplement `paidManual`, pour un paiement en espèces ou déjà saisi ailleurs.

Le champ `paidManual` reste modifiable dans la configuration de la fiche, mais il ne sert plus qu'au démarrage, pour rattraper l'historique d'une dette entamée avant l'application.

**Prélèvement automatique**

Un bouton crée une récurrence à partir de la dette : montant de l'échéance, catégorie et compte de la dette, `debtId` renseigné, début au mois de la prochaine échéance non couverte, fin au mois de la dernière. Un second bouton la retire sans toucher aux opérations déjà générées. Les occurrences créées font baisser le reste dû en même temps qu'elles apparaissent dans le budget.

**Écran Dettes**

Bandeau : le reste à rembourser en grand, décomposé par dette en barre segmentée, puis la charge mensuelle rapportée au revenu moyen. Ensuite une carte par dette active, dans le même style que les objectifs, avec jauge, échéancier en segments, phrase de synthèse, encadré de versement et champs de configuration. Puis un formulaire de création, une section « Dettes soldées », une section « Archives ».
Les quatre commandes en haut à droite reprennent celles des objectifs : masquer du tableau de bord, épingler, marquer soldée, archiver. Le filtrage du tableau de bord suit la même règle : une dette y figure si elle n'est ni archivée ni masquée, et si elle n'est pas soldée ou qu'elle est épinglée. Les épinglées passent en tête.

**Tableau de bord**

`dashOrder` devient `["goals","debts","stats","months","savings","cats"]`, avec la même règle d'ajout en fin de liste pour les clés inconnues. Dès qu'une dette existe, le bandeau affiche une ligne supplémentaire : « Dettes restantes : X €. Patrimoine net : Y €. », où le patrimoine net vaut le total des comptes moins le total dû.

### 2. Bandeau du tableau de bord : le total des comptes passe devant

Le chiffre principal n'est plus le capital net épargné et placé, mais le total de l'ensemble des comptes, courant compris. Structure attendue :

* surtitre : « Total de mes comptes aujourd'hui », ou « au 31 décembre <année> » si l'année sélectionnée n'est pas l'année courante ;
* le total en très grand ;
* barre segmentée sur tous les comptes au solde positif, avec la légende correspondante — les comptes à zéro ou négatifs ne figurent ni dans la barre ni dans la légende ;
* ligne secondaire : « Dont X € disponibles au quotidien et Y € d'épargne et de placements », plus une mention des autres comptes si leur total dépasse un euro ;
* ligne de valeur déclarée, si au moins un compte en porte une ;
* ligne dettes et patrimoine net, si une dette existe.

Le détail de la seule épargne reste accessible par la courbe « Progression de l'épargne » et par l'onglet Mes comptes.

### 3. Bouton Ajouter : un menu de création

Le bouton Ajouter de l'en-tête ouvre un menu au lieu d'ouvrir directement la saisie d'opération. Six entrées, séparées en deux groupes : Dépense, Revenu, Transfert, puis Objectif, Dette, Compte.
Les trois premières ouvrent la modale de saisie déjà spécifiée, pré-réglée sur le bon type. Les trois autres ouvrent une modale de création courte, puis basculent sur l'onglet concerné :

* Objectif : nom, montant cible, échéance facultative.
* Dette : intitulé, montant total, déjà réglé, montant par échéance, nombre d'échéances, première échéance, case « Créer aussi le prélèvement mensuel ».
* Compte : nom, type de compte, solde de départ, case « Compte d'épargne de précaution ».

Le menu se ferme au clic à l'extérieur, à la touche Échap, et après le choix d'une entrée. `aria-haspopup`, `aria-expanded` et `role="menu"` sont attendus.

### 4. Onglet Mes comptes : réorganisation

Dans l'ordre : le bandeau du total, une ligne de deux boutons Ajouter un compte et Nouveau transfert, le cadre Mouvements de l'année, puis le cadre Vos comptes. Le cadre « Transférer entre deux comptes » disparaît, son bouton ayant rejoint la ligne du haut. « Ajouter un compte » ouvre la modale de création décrite ci-dessus, sans passer par les paramètres.

### 5. Couleurs personnalisables

Dans Paramètres, deux séries de sélecteurs `<input type="color">` :

* une couleur par source de revenu, à côté de son nom dans la liste des catégories d'entrée ;
* une couleur par usage de dépense — Besoins, Envies, Mise de côté — et non par sous-catégorie.

Stockage : `preferences.categoryColors: Record<string, string>` et `preferences.bucketColors: Record<Bucket, string>`, en hexadécimal.
Ces couleurs se propagent partout : jauges du mois, barres segmentées, pastilles des listes d'opérations, barres du graphique mensuel, classement des postes, légendes. Toute fonction qui renvoyait une couleur en dur doit passer par un accesseur unique, qui renvoie la valeur personnalisée si elle existe et la couleur par défaut sinon.
Tant qu'aucune couleur n'est choisie, la valeur par défaut reste la variable CSS du thème, qui s'adapte au clair et au sombre. Une couleur choisie par l'utilisateur est fixe dans les deux thèmes : c'est assumé, mais un bouton de retour à la couleur d'origine doit apparaître à côté de chaque sélecteur personnalisé.

### 6. Correction à connaître : les champs masqués

Un piège que j'ai rencontré et qui te coûtera du temps si tu le reproduis. Les champs de formulaire portaient une classe avec `display: grid`, qui l'emporte sur la règle par défaut du navigateur pour l'attribut `hidden`. Résultat : des champs masqués par le code restaient visibles à l'écran, notamment « Depuis » et « Vers » sur une dépense ou un revenu, alors qu'ils ne concernent que les transferts.
Déclare explicitement, dans la feuille de styles, que tout conteneur de champ portant `hidden` ne s'affiche pas, et vérifie-le par un test : dans la modale de saisie, en type Dépense puis Revenu, les sélecteurs de comptes source et destination doivent être absents du rendu ; en type Transfert, ce sont catégorie et compte qui disparaissent.

### 7. Reprise des données et tests

L'export JSON de l'application actuelle contient désormais `settings.debts`, `settings.catColors`, `settings.bucketColors`, et les opérations portent les champs `goal` et `debt`. L'export CSV gagne une colonne `Dette` entre `Objectif` et `Libelle`. Mets l'importateur à jour en conséquence, et garde la règle : plutôt échouer bruyamment qu'accepter une conversion partielle.
Ajoute ces cas à la suite de tests, tous dans `packages/core` :

* montant total déduit du nombre et du montant des échéances lorsque le principal n'est pas saisi ;
* montant réglé combinant `paidManual` et opérations rattachées, dans les deux directions ;
* versement ponctuel qui laisse une dernière échéance réduite — 1 500 € en 5 × 300 €, 900 € réglés, versement de 525 € : il doit rester une seule échéance, de 75 € ;
* versement hors budget qui incrémente `paidManual` sans créer d'opération ;
* échéancier d'une dette au 31 sur un mois de 28 jours ;
* prochaine échéance en retard, et à moins de sept jours ;
* charge mensuelle excluant les dettes soldées, archivées, en direction `lent` et en mode libre ;
* filtrage du bloc dettes du tableau de bord selon masquée, épinglée, soldée, archivée, et tri des épinglées en tête ;
* récurrence créée depuis une dette : bon mois de début, bon mois de fin, `debtId` propagé aux occurrences ;
* accesseur de couleur : valeur personnalisée prioritaire, retour à la valeur par défaut après réinitialisation.

Comme précédemment : montre-moi la sortie de `vitest` au vert avant de passer à l'interface, et pose-moi la question dès qu'une règle est ambiguë plutôt que de deviner.
