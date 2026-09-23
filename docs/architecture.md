# Architecture de Cashmyr

Statut : **validée** le 23/09/2026. Les décisions prises en cours de route sont consignées au §8,
et ce document suit le code : toute règle qui change ici change aussi dans `packages/core` et ses tests.

---

## 1. Arborescence

```
.
├── package.json                 scripts racine : dev:web, dev:desktop, build:web, build:desktop, test, typecheck
├── pnpm-workspace.yaml          packages/*, apps/*
├── tsconfig.base.json           strict, noUncheckedIndexedAccess
├── LICENSE                      MIT
├── README.md
├── .gitignore                   node_modules, dist, target, *.local.json,
│                                mes-finances*.json, finances-sync*.json
├── .github/workflows/
│   ├── ci.yml                   typecheck + vitest sur chaque push et PR
│   ├── deploy-pages.yml         main → build apps/web → actions/deploy-pages
│   └── release.yml              tag v* → tauri-action, matrice macOS / Windows / Linux
├── docs/architecture.md         ce document, tenu à jour
│
├── packages/core/               pur : ni React, ni stockage, ni Date.now() implicite
│   ├── src/
│   │   ├── money.ts             saisie "12,50" → 1250, formatage, arrondis
│   │   ├── dates.ts             Day / Month, bornes, rabattement au dernier jour
│   │   ├── model.ts             types (§2)
│   │   ├── validate.ts          validation des invariants, erreurs explicites
│   │   ├── ids.ts               uuid v4, uuid v5 déterministes
│   │   ├── records.ts           create / touch / tombstone : pose updatedAt et deletedAt
│   │   ├── calc/
│   │   │   ├── month.ts         income, incomeBySource, needs, wants, saved, spent, balance
│   │   │   ├── averages.ts      revenu moyen, dépenses moyennes
│   │   │   ├── targets.ts       base et cibles par enveloppe
│   │   │   ├── accounts.ts      soldes, entrées/sorties, écart à la valeur déclarée
│   │   │   ├── safety.ts        constituée, objectif, capacité
│   │   │   ├── goals.ts         cible, avancement, échéance, mensualité, filtrage
│   │   │   ├── debts.ts         total, réglé, reste, échéancier, charge, total dû, filtrage
│   │   │   └── year.ts          indicateurs annuels, séries 12 mois, classement
│   │   ├── debts.ts             versement ponctuel, prélèvement créé depuis une dette
│   │   ├── colors.ts            accesseur unique de couleur, choix et réinitialisation
│   │   ├── recurrence.ts        matérialisation idempotente, annulation, rétablissement
│   │   ├── merge.ts             fusion ligne à ligne, préférences clé à clé
│   │   ├── sync.ts              document de synchronisation, registre, purge
│   │   ├── migrate/
│   │   │   ├── schema.ts        migrations du schéma (v1 → v2…)
│   │   │   └── legacy.ts        import de mes-finances.json + vérification croisée
│   │   └── index.ts
│   └── test/                    *.test.ts, une fixture synthétique (jamais tes données)
│
├── packages/storage/            dépôt local, moteur de synchronisation, adaptateurs par plateforme
│   └── src/
│       ├── types.ts             Platform, LocalStore, SyncFile, FileIO, AppUpdates, DeviceState (§5)
│       ├── repository.ts        Repository : jeu en mémoire, validation, récurrences, modifications en attente
│       ├── engine.ts            SyncEngine : lire → fusionner → adopter → écrire, différé 2 s, état affiché
│       ├── web/                 entrée « @cashmyr/storage/web » : IndexedDB, File System Access,
│       │                        mode assisté, exports, détection du mode
│       └── tauri/               entrée « @cashmyr/storage/tauri » : fichier local atomique,
│                                commandes Rust de synchronisation, dialogues natifs
│   test/                        adaptateurs, dépôt, moteur, et bout en bout à trois appareils
│
├── packages/ui/                 tous les écrans, aucune détection de plateforme
│   └── src/
│       ├── App.tsx              reçoit `platform: Platform` en prop, le fournit par contexte
│       ├── store/               Zustand : données, préférences, période affichée, UI
│       ├── screens/             Dashboard, Month, Goals, Accounts, Operations, Settings, Sync
│       ├── components/          OperationModal, Gauge, SegmentedBar, BarChart12, LineChart,
│       │                        ReorderableBlock, PeriodPicker, EmptyState…
│       ├── theme/               tokens.css (clair / sombre), fonts/*.woff2 + OFL.txt
│       └── format.ts            Intl.NumberFormat fr-FR
│
└── apps/
    ├── web/                     index.html, main.tsx, vite.config.ts (base = /<dépôt>/),
    │   ├── public/              manifest.webmanifest, icônes 192 / 512 / maskable, apple-touch-icon
    │   └── src/platform.ts      assemble la Platform web (IDB + fs-access ou assisted)
    └── desktop/                 index.html, main.tsx, vite.config.ts (port 1420, base relative)
        ├── src/platform.ts      assemble la Platform bureau
        └── src-tauri/           Cargo.toml, build.rs (permissions des commandes), tauri.conf.json,
                                 Info.plist (français), capabilities/default.json,
                                 icons/ (icon.svg est la source, « pnpm tauri icon » en tire le reste),
                                 src/{main.rs, lib.rs, menu.rs, sync_file.rs}
```

**Sens des dépendances** : `core` ← `storage` ← `ui` ← `apps/*`. `storage` a trois entrées : la racine (types,
dépôt, moteur), `web` et `tauri`. La PWA n'importe jamais l'entrée `tauri`, et inversement. `ui` n'importe de `storage` que les
*types*. Chaque `apps/*/src/platform.ts` instancie les implémentations et les passe à `<App platform />`.
Un écran qui doit se comporter différemment lit une capacité de `platform` (par exemple
`platform.sync.mode === "assisted"`), jamais la cible.

**Dépendances d'exécution** : `react`, `react-dom`, `zustand`, `idb`, `uuid`, `@tauri-apps/api` et les
plugins côté bureau (`dialog`, `fs`, `store`, plus `single-instance` côté Rust seulement). **Développement** : `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`,
`vite-plugin-pwa` (précache Workbox et invite de mise à jour), `@tauri-apps/cli`. Les woff2 de Spectral
et Archivo (licence OFL) sont copiés une fois depuis `@fontsource/*` dans `packages/ui/src/theme/fonts/`
et commités avec leur licence.

---

## 2. Modèle de données

Repris du cahier des charges. Les écarts sont marqués `ÉCART`.

```ts
export type Cents = number;   // Number.isSafeInteger, jamais un flottant
export type Day = string;     // "YYYY-MM-DD"
export type Month = string;   // "YYYY-MM"
export type SeriesColor = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Meta = { id: string; updatedAt: number; deletedAt: number | null };

export type Bucket = "besoin" | "envie" | "invest";
export type Role = "courant" | "epargne" | "invest" | "autre";
export type OpType = "in" | "out" | "tx";

export type Category = Meta & {
  name: string;
  kind: "in" | "out";
  bucket?: Bucket;            // ÉCART : obligatoire si kind = "out", interdit si kind = "in"
  color: SeriesColor;         // ÉCART : couleur de série, figée à la création
};

export type Account = Meta & {
  name: string; role: Role;
  opening: Cents;             // peut être négatif
  safety: boolean;
  declaredValue?: Cents; declaredAt?: Day;
  color: SeriesColor;         // ÉCART
};

export type Operation = Meta & {
  date: Day; amount: Cents; type: OpType; note: string;
  categoryId?: string; accountId?: string;      // in / out : obligatoires tous les deux
  fromAccountId?: string; toAccountId?: string; // tx : obligatoires, distincts
  goalId?: string;
  debtId?: string;                              // comme goalId ; peut coexister avec lui
  recurrenceId?: string;
};

export type GoalStep = Meta & {
  goalId: string; label: string; amount: Cents; done: boolean; position: number;
};

export type Goal = Meta & {
  name: string; target: Cents;
  targetMode: "manual" | "steps"; source: "tagged" | "account";
  accountIds: string[]; due: Day | null;
  hidden: boolean; pinned: boolean; done: boolean; doneAt: Day | null; archived: boolean;
  position: number;
  color: SeriesColor;         // ÉCART
};

export type Recurrence = Meta & {
  label: string; amount: Cents; type: OpType;
  categoryId?: string; accountId?: string; fromAccountId?: string; toAccountId?: string;
  goalId?: string;
  debtId?: string;            // propagé aux occurrences ; la génération suit alors l'échéancier (§4.9)
  dayOfMonth: number; startMonth: Month; endMonth: Month | null; active: boolean;
};

export type Debt = Meta & {
  name: string; creditor: string;
  direction: "owe" | "lent";
  principal: Cents;           // 0 = non renseigné → total calculé
  paidManual: Cents;          // rattrapage de l'historique ; les versements hors budget l'incrémentent
  mode: "installments" | "free";
  installmentAmount: Cents;   // > 0 en mode échéances
  installmentCount: number;   // ≥ 1 en mode échéances
  startDate: Day; dayOfMonth: number;
  categoryId: string | null;  // owe → dépense ; lent → revenu
  accountId: string | null;
  recurrenceId: string | null;
  hidden: boolean; pinned: boolean;
  settled: boolean; settledAt: Day | null;   // drapeau manuel
  archived: boolean; position: number;
  color: SeriesColor;         // ÉCART : segment de la dette dans le bandeau des Dettes
};

export type Skip = Meta & { month: Month; recurrenceId: string };

export type DashBlock = "goals" | "debts" | "stats" | "months" | "savings" | "cats";
// Un ordre enregistré reçoit en fin de liste les blocs qui lui manquent ; les clés inconnues sont retirées.

export type Preferences = {
  splits: { besoin: number; envie: number; invest: number }; // ÉCART : points de base entiers, somme = 10 000
  basis: "month" | "avg";
  averageWindow: 3 | 6 | 12;
  safety: { mode: "months" | "amount"; months: number; amount: Cents; hidden: boolean; pinned: boolean };
  dashOrder: DashBlock[];
  theme: "system" | "light" | "dark";
  categoryColors: Record<string, string>;         // id de source de revenu → "#rrggbb"
  bucketColors: Partial<Record<Bucket, string>>;  // ÉCART : Partial ; clé absente = variable CSS du thème
  updatedAt: Record<PrefKey, number>;
};
export type PrefKey = Exclude<keyof Preferences, "updatedAt">;  // ÉCART : updatedAt ne s'horodate pas lui-même

export type Collections = {
  categories: Category[]; accounts: Account[]; operations: Operation[];
  goals: Goal[]; goalSteps: GoalStep[]; debts: Debt[]; recurrences: Recurrence[]; skips: Skip[];
};

export type Dataset = { schemaVersion: 1; collections: Collections; preferences: Preferences };
```

**Invariants vérifiés** à chaque écriture, à l'import et à chaque lecture du fichier de synchronisation.
Une violation bloque l'opération avec un message, sans correction silencieuse.

- `amount > 0`, `opening` et `declaredValue` entiers ; dates et mois valides au calendrier.
- `in` / `out` : catégorie du bon `kind` et compte présents, pas de `from` / `to`. `tx` : l'inverse.
- `splits` : entiers ≥ 0, somme exactement 10 000.
- `dayOfMonth` ∈ 1–31 ; `endMonth ≥ startMonth`.
- Dette en mode échéances : montant > 0, au moins une échéance, total renseigné ≤ montant × nombre.
  Catégorie de dépense pour « je dois », de revenu pour « on me doit ».
- Couleurs personnalisées au format `#rrggbb`.
- Une référence vers une ligne supprimée reste lisible. C'est possible après une fusion : l'appareil A
  supprime un compte pendant que B y saisit une opération hors ligne. L'interface la signale
  (« compte supprimé ») et les calculs la comptent normalement.

**État propre à l'appareil**, jamais synchronisé :

```ts
export type DeviceState = {
  deviceId: string;            // aléatoire, jamais un nom de machine
  deviceLabel: string;         // « Mac », « Safari iPhone »… déduit, modifiable
  sync: { fileId: string | null; targetName: string | null;
          lastMergeAt: number | null; lastOfferAt: number | null; lastError: string | null };
  dirty: Record<string, number>;   // "operations:<id>" ou "pref:<clé>" → updatedAt de la version modifiée
};
```

Une modification reste **en attente** tant qu'aucun fichier lu ou écrit par cet appareil ne la contient,
dans sa version ou une plus récente. Leur nombre s'affiche à l'écran de synchronisation. En mode assisté, une
modification proposée dans le fichier fusionné n'est confirmée qu'à la lecture suivante : l'application ne
peut pas savoir si l'original a été remplacé.

---

## 3. Fichier de synchronisation `finances-sync.json`

```ts
export type SyncDocument = {
  format: "finances-sync";
  schemaVersion: 1;             // plus récent que l'app → refus : « Mets l'application à jour »
  fileId: string;               // créé à la naissance du fichier
  revision: number;             // +1 à chaque écriture
  writtenAt: number; writtenBy: string;   // deviceId
  devices: Record<string, { label: string; lastRevision: number; lastMergeAt: number }>;
  landed: Record<string, number>;         // "collection:id" → révision d'arrivée de chaque pierre tombale
  collections: Collections;     // pierres tombales comprises
  preferences: Preferences;
};
```

---

## 4. Fusion (`core/merge.ts`, `core/sync.ts`)

`mergeDatasets(local, remote)` est une union pure, sans purge. `syncWithDocument({ local, remote, device, now })`
enchaîne toute une synchronisation et renvoie le jeu local, le document à écrire et un rapport.

1. **Ligne à ligne**, sur l'union des `id` :
   - présente d'un seul côté → reprise ;
   - présente des deux côtés → `updatedAt` le plus élevé gagne ;
   - égalité stricte → la version supprimée gagne, sinon la plus grande en JSON canonique
     (arbitraire mais déterministe : les deux appareils convergent).
2. **Supprimer**, c'est écrire `deletedAt = updatedAt = maintenant`. Une suppression gagne donc sur toute
   modification plus ancienne. Contre une modification plus récente, la modification gagne et la ligne revient.
3. **Horloge** : toute écriture pose `updatedAt = max(Date.now(), ancien updatedAt + 1)`.
4. **Préférences** : clé par clé selon `updatedAt[clé]`. `splits` et `safety` sont des clés atomiques.
5. **Occurrences générées** : identifiant uuid v5 (récurrence, mois), et `updatedAt` = celui de la version
   de la récurrence qui les a produites, jamais l'heure de génération. Deux appareils génèrent donc des
   lignes identiques, et toute action de l'utilisateur (annulation, modification) les bat, même si l'autre
   appareil génère plus tard.
6. **Registre et purge.** Chaque fusion écrite inscrit l'appareil (`lastRevision`, `lastMergeAt`). Chaque
   pierre tombale garde sa révision d'arrivée dans `landed`. Elle est purgée des deux côtés quand toutes
   les conditions suivantes sont réunies :
   - elle a plus de 90 jours ;
   - tous les appareils du registre ont fusionné à une révision ≥ son arrivée, donc l'ont vue ;
   - aucune ligne vivante ne la référence encore.

   Autres règles :
   - Un appareil qui n'a pas fusionné depuis 180 jours sort du registre.
   - Une pierre tombale locale de plus de 90 jours, absente du fichier, est écartée sans être renvoyée
     (le fichier l'a déjà purgée).
   - Sans fichier de synchronisation, rien n'est purgé.
7. **Retour d'un appareil évincé** : `findPurgedElsewhere` liste ses lignes vivantes absentes du fichier et
   antérieures à sa dernière fusion. Ces lignes ont forcément été supprimées puis purgées ailleurs.
   L'application les montre et demande avant de fusionner.
8. **Écriture** : seulement si le fichier a quelque chose à apprendre (`report.needsWrite`).
9. **Récurrence liée à une dette** (décision 24). Les occurrences sont décidées dans l'ordre chronologique :
   - dette soldée ou reste nul : rien ;
   - mode échéances : l'occurrence d'un mois n'existe que si l'échéancier restant prévoit une échéance
     ce mois-là. Cet échéancier est calculé avec les opérations datées jusqu'au jour de l'occurrence.
     Le montant est plafonné à celui de l'échéance, la dernière pouvant être réduite ;
   - mode libre : l'occurrence est plafonnée au reste dû ;
   - dette supprimée : la récurrence redevient ordinaire. Supprimer une dette arrête ses prélèvements
     (décision 29) ; ce cas ne se présente donc que si un autre appareil modifie le prélèvement après la
     suppression, sa version plus récente le faisant revivre.

   Après un versement ponctuel, les prélèvements suivent donc la fiche et ne paient jamais trop.

Propriétés testées sur 300 tirages aléatoires : commutativité, idempotence, associativité.

---

## 5. Interfaces de stockage

Les définitions font foi dans [`packages/storage/src/types.ts`](../packages/storage/src/types.ts). En résumé :

- **`LocalStore`** : `load`, `apply` (incrémental), `replace`, `snapshot` (5 copies tournantes),
  `getDevice` / `setDevice`, `requestPersistence`, `flush`. Deux implémentations : `IndexedDbLocalStore` et
  `TauriFileLocalStore`.
- **`SyncFile`** : deux formes.
  - `AutoSyncFile` (`choose`, `status`, `requestPermission`, `read`, `writeAtomic`, `forget`), implémentée
    par `createTauriSync` et `createFsAccessSync`.
  - `AssistedSyncFile` (`pickAndRead`, `offer`), implémentée par `createAssistedSync`.
- **`FileIO`** : exports et imports hors synchronisation. **`AppUpdates`** : branchée à l'étape 6.
- **`Platform`** : ce que chaque point d'entrée assemble et passe à `<App />`.

**`Repository`** est la seule porte d'entrée des données.
- Il ouvre le jeu local, en prend une copie de sauvegarde et génère les occurrences dues.
- Il valide chaque lot d'écriture en entier : tout le lot passe ou rien n'est écrit.
- Il compte les modifications en attente.
- `acceptMerge` refusionne avec ce qui a été saisi pendant la synchronisation : rien n'est perdu.

**`SyncEngine`** orchestre les passages, un à la fois.
- Mode automatique : lancement, retour au premier plan, et 2 s après une modification (une seule écriture
  pour une rafale).
- Mode assisté : sur demande. `syncNow` fusionne, puis `offerMerged` propose le fichier fusionné, depuis un
  geste de l'utilisateur (iOS refuse le partage sinon).
- Deux crochets demandent à l'utilisateur :
  - `confirmFirstJoin` : premier passage avec des données des deux côtés ;
  - `confirmDropPurged` : appareil évincé qui revient.
- L'état affiché (`SyncState`) comprend : mode, automatique ou non, statut, fichier, dernière fusion,
  dernier fichier proposé, modifications en attente, dernière erreur.

---

## 6. Comportement par plateforme

| | Bureau Tauri | Chromium bureau (PWA) | Safari, Firefox, mobiles |
|---|---|---|---|
| Stockage local | `$APPDATA/data.json`, écrit dans `.tmp` puis renommé | IndexedDB, un store par collection | IndexedDB |
| Copies tournantes | `$APPDATA/backups/`, 5 fichiers | store `snapshots`, 5 entrées | idem |
| Sync | auto : lancement, focus, 2 s après modification | auto, même rythme ; permission redemandée si expirée | assistée, sur bouton |
| Écriture atomique | commande Rust : `.tmp` dans le même dossier, `fsync`, `rename` | `createWritable()` écrit dans un fichier d'échange que Chromium substitue à `close()`. L'API web ne permet pas de renommer un fichier de l'utilisateur, c'est le seul mécanisme atomique disponible. | le navigateur livre le fichier complet ; c'est l'utilisateur qui écrase l'original |
| Choix du mode | fixe | détection de `showOpenFilePicker`, hors mobile | par défaut |

**Déroulé d'une synchronisation automatique.** Lire le fichier. S'il est illisible (JSON tronqué par
un cloud en cours d'envoi, par exemple), abandonner sans rien écrire et réessayer au prochain focus.
Sinon valider, fusionner, adopter le résultat localement, écrire le fichier fusionné, puis retirer
de `dirty` ce que le fichier contient désormais. Chaque
écriture est précédée d'une lecture : aucune écriture n'est faite à l'aveugle.

**Déroulé assisté.** Bouton « Synchroniser » → sélecteur de fichiers → fusion → le local est à jour →
bouton « Enregistrer le fichier fusionné » → partage natif (« Enregistrer dans Fichiers » sur iOS) ou
téléchargement. Ce second geste est indispensable : iOS refuse le partage qui ne suit pas immédiatement
un geste de l'utilisateur. L'écran dit en clair que la synchronisation n'a lieu qu'à la demande et que l'app ne peut
pas vérifier que l'original a bien été remplacé. Sur iPhone, le comportement exact de « Enregistrer dans
Fichiers » face à un fichier de même nom (remplacer, ou créer une copie) sera vérifié sur un appareil réel
avant d'écrire la consigne affichée.

**Pourquoi des commandes Rust sur bureau.** Le fichier temporaire vit à côté du fichier choisi. Or
`plugin-dialog` n'ouvre la portée de `plugin-fs` qu'au fichier choisi, et pour la seule session en
cours. `sync_file.rs` expose donc six commandes, dont le contrat est décrit dans
[`packages/storage/src/tauri/sync.ts`](../packages/storage/src/tauri/sync.ts) :
`sync_choose`, `sync_status`, `sync_target_name`, `sync_read`, `sync_write_atomic`, `sync_forget`.
`sync_choose` ouvre le dialogue côté Rust et mémorise le chemin ; en création, il crée un fichier vide.
Les commandes n'agissent que sur le chemin mémorisé, et le front ne peut pas leur en passer un autre.
`plugin-fs` reste limité à `$APPDATA`.

Le chemin est gardé dans `$APPDATA/sync-target.txt`, sous une ligne d'en-tête. `plugin-fs` n'a pas le
droit d'y toucher (règle `deny` de `capabilities/default.json`). `plugin-store`, qui n'écrit que du JSON,
ne peut pas en produire un valide. Le front ne peut donc pas rediriger la synchronisation vers un autre
fichier. `build.rs` déclare les six commandes : seules celles que liste la capacité sont appelables.
Un fichier choisi pour un export ou un import n'est accessible que pendant la session où il a été choisi.
La CSP n'autorise que les fichiers de l'application et l'IPC de Tauri : aucune requête réseau n'est
possible, même par erreur.

**Premier lancement.** Données vides, un écran d'accueil et trois choix : commencer avec les catégories
par défaut (celles de l'ancienne app), importer un fichier, ou rejoindre un fichier de synchronisation
existant. Aucune donnée n'est semée d'office, pour éviter les doublons de catégories quand un appareil
neuf rejoint un fichier.

**Première fusion d'un appareil qui a déjà des données locales** avec un fichier non vide : avertissement
avant de fusionner. Les deux jeux seront réunis, et ce qui a été saisi des deux côtés apparaîtra en double.

---

## 7. Reprise de `mes-finances.json`

- Montants : `Math.round(x * 100)`, avec échec si `|x·100 − arrondi| > 1e-6`.
- Identifiants : uuid v5 dérivés de l'identifiant d'origine (réimporter sur un autre appareil ne duplique rien).
- Anciens objectifs sans `pinned` / `done` / `archived` / `targetMode` : `false` / `false` / `false` /
  `"manual"`. `safety.pinned` : `true`.
- **Vérification croisée** : un calculateur minimal qui lit l'ancien format en euros recalcule les
  totaux par mois, les soldes par compte et l'avancement de chaque objectif. Les résultats sont comparés
  au centime près avec ceux de `core` sur les données converties. Le moindre écart, ou le moindre champ
  inconnu, fait échouer l'import sans rien écrire. L'export fourni ne contient ni transfert, ni récurrence,
  ni annulation, ni rattachement à un objectif : ces cas seront refusés tant que leur format n'est pas connu.
- Le vrai fichier n'entre jamais dans le dépôt. Les tests utilisent une fixture synthétique au même format.

---

## 8. Décisions

### Validées le 23/09/2026

| # | Sujet | Décision |
|---|---|---|
| 1 | Suppression contre modification plus récente | La plus récente gagne : la ligne revient. |
| 2 | Purge à 90 jours | Seulement une fois vue par tous les appareils du registre ; éviction après 180 jours d'absence. |
| 3 | Identifiants | uuid v5 déterministes pour occurrences, annulations et import ; uuid v4 ailleurs. |
| 4 | Horloge, égalités | `max(maintenant, ancien + 1)` ; à égalité, suppression puis JSON canonique. |
| 5 | Occurrence du mois en cours | Créée le jour venu. Avant, listée dans « Prévu ce mois », en lecture seule. Le jour du mois se choisit à la création, y compris depuis « répéter chaque mois ». |
| 6 | Suppression manuelle d'une opération générée | Vaut annulation (Skip). |
| 7 | Revenu moyen | Les N mois civils qui précèdent le mois affiché (N = 3, 6 ou 12, au choix). Un mois vide compte pour 0. La fenêtre ne remonte pas avant le mois de la première opération. Si aucun mois de la fenêtre n'a d'opération : message, jamais 0. « Non vide » = au moins une opération de n'importe quel type. |
| 8 | Dépenses moyennes (précaution, capacité) | Même règle et même N que le revenu moyen, relativement au mois en cours. |
| 9 | Mois restants avant échéance | Mois entamés (23/09 → 05/04 = 7) ; minimum 1 tant que l'échéance n'est pas passée. |
| 10 | « Atteint » | Drapeau manuel. La carte propose « Marquer atteint » quand l'avancement couvre la cible. Précaution : constituée ≥ objectif. |
| 11 | Résumé des postes | Somme des postes réglés sur somme des postes. « Réglé » n'entre dans aucun calcul. |
| 12 | Date de référence | Année en cours : opérations datées jusqu'à aujourd'hui. Année passée : jusqu'au 31/12. L'écran Mois compte tout le mois. |
| 13 | Tableau de bord annuel | Moyennes sur les mois écoulés (même règle que 7). Taux d'épargne = Σ mis de côté ÷ Σ revenus. Courbe = épargne et placements en fin de mois. Classement = besoins et envies. Total épargne = rôles `epargne` et `invest`. |
| 14 | « Reste sur le courant » | Balance du mois. |
| 15 | Arrondis | Au centime le plus proche, demi loin de zéro ; répartition en points de base. |
| 16 | Import | Tout champ ou cas inconnu fait échouer l'import. |
| 17 | Updater bureau | Vérification sur clic seulement ; plugins `updater` et `process` en plus. |
| 18 | Noms | Cashmyr · `io.github.aiebou.cashmyr` · dépôt `Aiebou/Cashmyr` · base `/Cashmyr/` · PWA `https://aiebou.github.io/Cashmyr/` · updater `https://github.com/Aiebou/Cashmyr/releases/latest/download/latest.json`. |

| 19 | Moyennes annuelles | Mois en cours exclu, car incomplet. |
| 20 | Purge | Jamais pour une pierre tombale encore référencée par une ligne vivante. |
| 21 | Sans fichier de synchronisation | Aucune purge. |
| 22 | Échéance passée, cible couverte, non marquée atteinte | Pas de rouge ; la carte propose « Marquer atteint ». |
| 23 | Reprise d'une récurrence en pause | Les mois de pause sont marqués « ignorés », rétablissables un par un. |
| 24 | Prélèvement d'une dette après un versement ponctuel | Les prélèvements suivent l'échéancier restant (§4.9). |
| 25 | Reste supérieur à l'échéancier | Prochaine = première date, solde = dernière, excédent signalé (`uncovered`). Total renseigné > montant × nombre refusé à la saisie. |
| 26 | Dette sans catégorie ou sans compte | Le versement dans le budget les demande, la dette retient le choix ; prélèvement impossible sans eux. |
| 27 | Date de référence du réglé | Comme la décision 12. |
| 28 | Total dû | Dettes « je dois » ni archivées ni soldées. |
| 29 | Suppression d'une dette | Arrête aussi ses prélèvements : celui créé depuis la fiche et toute récurrence portant son `debtId`. Les opérations déjà générées restent dans le budget. |
| 30 | Suppression d'un compte | Refusée tant qu'une opération, une récurrence, une dette ou un objectif vivants y font référence ; l'écran dit lesquels. |
| 31 | Suppression d'une catégorie utilisée | Ses opérations, récurrences et dettes passent à une catégorie de même nature, existante ou créée sur place ; un changement d'usage des mois passés est annoncé, montant à l'appui. Inutilisée : suppression directe, après confirmation. |
| 32 | Import JSON | Fusion, avec la règle de la synchronisation : pour chaque ligne et chaque réglage, la version la plus récente gagne. Accepte un export Cashmyr ou un `finances-sync.json` ; refuse tout le reste en entier. |
| 33 | Restauration d'une copie | La copie gagne partout : ses lignes sont réécrites avec un horodatage plus récent, les lignes vivantes créées depuis deviennent des suppressions, chaque réglage reprend sa valeur. Une copie de l'état actuel est prise avant ; en synchronisation automatique, un passage d'abord. |

Lectures validées avec la section dettes :
- Total : `principal` s'il est > 0.
- Mode libre : pas d'échéancier.
- Échéances couvertes : jamais sous 0.
- Prochaine échéance : « dans N jours » pour N de 0 à 6.
- Date de solde : toujours la dernière date de l'échéancier (modèle aligné sur la fin).
- Prélèvement créé depuis une dette : du mois de la prochaine échéance à celui de la dernière, avec un
  identifiant dérivé de la dette.
- Le drapeau « soldée » est manuel ; la carte propose « Marquer soldée » quand le reste est nul.
- Charge mensuelle rapportée au revenu moyen du mois en cours.
- Les couleurs personnalisées font partie du schéma dès maintenant, l'interface arrive à l'étape 4 ;
  `categoryColors` est une seule clé de fusion.

Pour l'étape 4 : le surtitre du bandeau dit « aujourd'hui » pour l'année en cours comme pour une année
future, et le test des champs masqués demande `jsdom` et Testing Library.
Écran Dettes, choix d'interface validés le 23/09/2026 :
- Le sens d'une dette ne se modifie plus dès qu'une opération ou un prélèvement y est rattaché ; sinon
  chaque opération changerait de signe dans le réglé.
- Modifier la dette ne touche pas au prélèvement. La carte signale l'écart et propose « Mettre à jour le
  prélèvement », qui le recrée depuis la prochaine échéance sans relancer un prélèvement en pause.
- Supprimer une dette arrête ses prélèvements (décision 29) ; la confirmation le dit.
- Hors budget, le champ date du versement disparaît : `paidManual` n'a pas de date.
- Sans échéancier, un montant total est exigé à la saisie : un total nul rendrait la dette réglée d'office.

Paramètres, choix d'interface validés le 23/09/2026 :
- Export CSV : colonnes et format de l'ancienne application (champs entre guillemets, `;`, CRLF, montant
  sans signe), plus un BOM UTF-8 pour Excel ; montants en euros à virgule, deux décimales.
- Les exports s'appellent `cashmyr-sauvegarde-AAAA-MM-JJ.json` et `cashmyr-operations-AAAA-MM-JJ.csv` ;
  le `.gitignore` les exclut.
- Une couleur choisie s'enregistre à la fermeture du sélecteur ; un bouton rend la couleur du thème.
- Les questions de la synchronisation et des suppressions s'affichent dans une fenêtre de l'application,
  plus par `window.confirm`.
- Une récurrence dont le premier mois est passé crée aussitôt les mois dont le jour est venu : la fenêtre
  le dit avant d'enregistrer.

Enveloppe Tauri, choix à valider :
- Une seule instance : relancer l'application ramène la fenêtre ouverte, au lieu d'ouvrir une seconde
  instance qui écrirait dans le même `data.json` (plugin `single-instance`).
- Barre de menus macOS en français (Cashmyr, Édition, Présentation, Fenêtre, Aide) ; ⌘N reste à
  « Nouvelle opération ». `Info.plist` déclare le français : les dialogues du système le sont aussi.
- « Créer un nouveau fichier » propose `finances-sync.json` ; un fichier existant choisi à cet endroit
  n'est pas vidé, il est fusionné. Une écriture dans un fichier qui a disparu est refusée plutôt que de
  le recréer en silence ; l'écriture garde les droits du fichier d'origine.
- macOS 12 minimum : l'interface utilise `color-mix()` (Safari 16.2), que le WebView système doit
  connaître. Fenêtre de 1240 × 840, 380 × 560 au minimum.
- Glisser-déposer natif des fichiers désactivé sur la fenêtre, pour que le réordonnancement des blocs
  (glisser-déposer HTML) marche aussi sous Windows.
- Icône : l'anneau des trois usages (besoins 50 %, envies 30 %, mise de côté 20 %) sur une tuile claire.
- L'updater (clés, `latest.json`, bouton « Rechercher une mise à jour ») arrive avec la première
  Release, à l'étape 6, comme prévu au §5.

Pour l'étape 5 : il faut un export récent contenant une dette, des couleurs, `goal` / `debt` sur les
opérations, un transfert, une récurrence, une annulation, et l'en-tête CSV.
