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
├── .github/
│   ├── release-notes.md         texte de chaque Release
│   ├── scripts/check-latest.mjs contrôle de latest.json avant publication (plateformes, version, clé)
│   └── workflows/
│       ├── ci.yml               typecheck + vitest, et fmt + clippy + tests Rust sur macOS, à chaque push et PR
│       ├── deploy-pages.yml     main → tests → build apps/web → actions/deploy-pages
│       └── release.yml          tag v* → versions et tests → brouillon → tauri-action (macOS universel,
│                                Windows, Linux) → publication une fois latest.json complet
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
│   │   │   ├── accounts.ts      soldes, entrées/sorties, valeur déclarée dans les totaux (décisions 42 à 44)
│   │   │   ├── safety.ts        constituée, objectif, capacité
│   │   │   ├── goals.ts         cible, avancement, échéance, mensualité, filtrage
│   │   │   ├── debts.ts         total, réglé, reste, échéancier, charge, total dû, filtrage
│   │   │   └── year.ts          indicateurs annuels, séries 12 mois, classement
│   │   ├── debts.ts             versement ponctuel, prélèvement créé depuis une dette
│   │   ├── colors.ts            accesseur unique de couleur, choix et réinitialisation
│   │   ├── reset.ts             remise à zéro partout, catégories de l'accueil (décision 45)
│   │   ├── tags.ts              identité, création, renommage, suppression et totaux des tags (47, 48)
│   │   ├── defaults.ts          catégories par défaut, aux identifiants de l'ancienne application
│   │   ├── recurrence.ts        matérialisation idempotente, annulation, rétablissement
│   │   ├── merge.ts             fusion ligne à ligne, préférences clé à clé
│   │   ├── sync.ts              document de synchronisation, registre, purge
│   │   ├── migrate/
│   │   │   ├── schema.ts        mises à niveau du format (1 → 2), décision 50
│   │   │   ├── legacy.ts        import de mes-finances.json : lecture stricte, conversion
│   │   │   └── legacy-check.ts  vérification croisée, calculateur de l'ancien format en euros
│   │   └── index.ts
│   └── test/                    *.test.ts, une fixture synthétique (jamais tes données)
│
├── packages/storage/            dépôt local, moteur de synchronisation, adaptateurs par plateforme
│   └── src/
│       ├── types.ts             Platform, LocalStore, SyncFile, FileIO, AppUpdates, DeviceState (§5)
│       ├── repository.ts        Repository : jeu en mémoire, validation, récurrences, modifications en attente
│       ├── engine.ts            SyncEngine : lire → fusionner → adopter → écrire, différé 2 s, état affiché
│       ├── recovery.ts          écran de secours : copies vérifiées, restauration, retour à zéro (décisions 38 à 40)
│       ├── reset.ts             remise à zéro de cet appareil (décision 45)
│       ├── web/                 entrée « @cashmyr/storage/web » : IndexedDB, File System Access,
│       │                        mode assisté, exports, détection du mode, service worker (updates.ts)
│       └── tauri/               entrée « @cashmyr/storage/tauri » : fichier local atomique,
│                                commandes Rust de synchronisation, dialogues natifs, updater (updates.ts)
│   test/                        adaptateurs, dépôt, moteur, et bout en bout à trois appareils
│
├── packages/ui/                 tous les écrans, aucune détection de plateforme
│   └── src/
│       ├── App.tsx              reçoit `platform: Platform` en prop, le fournit par contexte
│       ├── store/               Zustand : données, préférences, période affichée, UI
│       ├── screens/             Dashboard, Month, Goals, Accounts, Operations, Settings, Sync, Recovery
│       ├── components/          OperationModal, Gauge, SegmentedBar, BarChart12, LineChart,
│       │                        ReorderableBlock, PeriodPicker, EmptyState…
│       ├── theme/               tokens.css (clair / sombre), fonts/*.woff2 + OFL.txt
│       └── format.ts            Intl.NumberFormat fr-FR
│
└── apps/
    ├── web/                     index.html, main.tsx, vite.config.ts (base = /Cashmyr/, vite-plugin-pwa :
    │   │                        manifeste et précache ; CSP en balise meta)
    │   ├── icons/maskable.svg   source des icônes maskable et apple-touch-icon
    │   ├── public/              icons/ (192, 512, maskable 192 et 512), apple-touch-icon.png
    │   └── src/platform.ts      assemble la Platform web (IDB + fs-access ou assisted, service worker)
    └── desktop/                 index.html, main.tsx, vite.config.ts (port 1420, base relative)
        ├── src/platform.ts      assemble la Platform bureau
        └── src-tauri/           Cargo.toml, build.rs (permissions des commandes), tauri.conf.json,
                                 tauri.release.conf.json (archives signées de l'updater, en Release seulement),
                                 windows/fr-FR.wxl (textes de Tauri dans le .msi, en français),
                                 Info.plist (français), capabilities/default.json,
                                 icons/ (icon.svg est la source, « pnpm tauri icon » en tire le reste),
                                 src/{main.rs, lib.rs, menu.rs, sync_file.rs}
```

**Sens des dépendances** : `core` ← `storage` ← `ui` ← `apps/*`. `storage` a trois entrées : la racine (types,
dépôt, moteur), `web` et `tauri`. La PWA n'importe jamais l'entrée `tauri`, et inversement. `ui` n'importe de `storage` que les
*types*, plus les fonctions qui agissent sur le stockage local sans passer par le dépôt : écran de secours
(`recoverLocalData`, `recoveryCopies`) et remise à zéro de l'appareil (`resetDevice`). Chaque `apps/*/src/platform.ts` instancie les implémentations et les passe à `<App platform />`.
Un écran qui doit se comporter différemment lit une capacité de `platform` (par exemple
`platform.sync.mode === "assisted"`), jamais la cible.

**Dépendances d'exécution** : `react`, `react-dom`, `zustand`, `idb`, `uuid`, `@tauri-apps/api` et les
plugins côté bureau (`dialog`, `fs`, `store`, `updater`, `process`, plus `single-instance` côté Rust seulement),
`workbox-window` côté web. **Développement** : `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`,
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
  declaredValue?: Cents; declaredAt?: Day;   // épargne, placement, autre : entre dans le total (décisions 42 à 44)
  color: SeriesColor;         // ÉCART
  position?: number;          // format 2 : ordre choisi, synchronisé ; absent = après les autres (décision 49)
};

export type Operation = Meta & {
  date: Day; amount: Cents; type: OpType; note: string;
  categoryId?: string; accountId?: string;      // in / out : obligatoires tous les deux
  fromAccountId?: string; toAccountId?: string; // tx : obligatoires, distincts
  goalId?: string;
  debtId?: string;                              // comme goalId ; peut coexister avec lui
  recurrenceId?: string;
  tagId?: string;                               // format 2 : un tag au plus (décisions 47 et 48)
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
  tagId?: string;             // format 2 : propagé aux occurrences
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

export type Tag = Meta & { name: string };   // format 2 ; identifiant déduit du nom à la création (décision 47)

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
  tags: Tag[];                // format 2
};

export type Dataset = { schemaVersion: 2; collections: Collections; preferences: Preferences };
// 1 : versions 0.1.x. 2 : version 0.2.0 (tags, ordre des comptes). Mise à niveau à la lecture (décision 50).
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
- Tag : nom non vide, sans espace en bord ; le `tagId` d'une opération ou d'une récurrence désigne un tag existant,
  vivant ou supprimé.
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
  display?: { bannerTotal?: "declared" | "injected" | "injectedOutsideCurrent"; accountRoles?: Role[];
              hideMonthCharts?: boolean; checkUpdatesOnLaunch?: boolean };
                                   // choix d'affichage de l'appareil (0.2.0), absents = valeurs par défaut
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
  schemaVersion: 2;             // plus récent que l'app → refus : « Mets l'application à jour » ;
                                // plus ancien → mis à niveau à la lecture, réécrit au format courant
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
  `getDevice` / `setDevice`, `requestPersistence`, `flush`. Pour l'écran de secours : `readRaw`, `setAside`
  (copie de côté, sans retirer), `clear`, `listSetAside` / `readSetAside` / `removeSetAside`. Deux
  implémentations : `IndexedDbLocalStore` et `TauriFileLocalStore`.
- **Données refusées à l'ouverture** : `Repository.open` lève `LocalDataError` (« illisible » ou
  « invalide ») sans prendre de copie ; `startApp` affiche alors l'écran de secours, qui s'appuie sur
  `recoveryCopies` et `recoverLocalData`. Des données d'une version plus récente de Cashmyr lèvent une autre
  erreur : elles ne sont pas abîmées et ne doivent pas être mises de côté.
- **`SyncFile`** : deux formes.
  - `AutoSyncFile` (`choose`, `status`, `requestPermission`, `read`, `writeAtomic`, `forget`), implémentée
    par `createTauriSync` et `createFsAccessSync`.
  - `AssistedSyncFile` (`pickAndRead`, `offer`), implémentée par `createAssistedSync`.
- **`FileIO`** : exports et imports hors synchronisation.
- **`AppUpdates`** : version en service, `onAvailable` (une nouvelle version est prête, `kind` « reload » ou
  « restart »), `onOfflineReady` (PWA) et `check` (bureau, au lancement et sur clic, décision 46). `createPwaUpdates` enveloppe le
  `registerSW` de vite-plugin-pwa, `createTauriUpdates` les plugins `updater` et `process`.
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
| Stockage local | `$APPDATA/data.json`, écrit dans `.tmp` puis renommé | IndexedDB, un store par collection (base en version 2 depuis la 0.2.0 : store `tags`) | IndexedDB |
| Copies tournantes | `$APPDATA/backups/`, 5 fichiers | store `snapshots`, 5 entrées | idem |
| Données locales illisibles ou invalides au démarrage | rien n'est écrit ni copié ; écran de secours (décisions 38 à 40). Version abîmée gardée dans `$APPDATA/mis-de-cote/`, un fichier par incident | écran de secours ; la dernière version abîmée gardée dans le magasin `meta` | idem |
| Sync | auto : lancement, focus, 2 s après modification | auto, même rythme ; permission redemandée si expirée | assistée, sur bouton |
| Écriture atomique | commande Rust : `.tmp` dans le même dossier, `fsync`, `rename` | `createWritable()` écrit dans un fichier d'échange que Chromium substitue à `close()`. L'API web ne permet pas de renommer un fichier de l'utilisateur, c'est le seul mécanisme atomique disponible. | le navigateur livre le fichier complet ; c'est l'utilisateur qui écrase l'original |
| Choix du mode | fixe | détection de `showOpenFilePicker`, hors mobile | par défaut |
| Mise à jour de l'application | au lancement, désactivable, et sur clic (« Rechercher une mise à jour ») : `latest.json` de la dernière Release, paquet vérifié par sa signature, installé sur clic puis redémarrage (décision 46) | le navigateur regarde à l'ouverture si le service worker a changé ; la nouvelle version attend, un bandeau propose « Recharger » | idem |

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
possible, même par erreur. La recherche de mise à jour passe par Rust (plugin `updater`), au lancement si
l'appareil ne l'a pas désactivée, et sur clic (décision 46).
La PWA porte la même CSP, en balise meta puisque GitHub Pages ne permet pas d'en-têtes.

**Premier lancement.** Données vides, un écran d'accueil et trois choix : commencer avec les catégories
par défaut (celles de l'ancienne app), importer un fichier, ou rejoindre un fichier de synchronisation
existant. Aucune donnée n'est semée d'office, pour éviter les doublons de catégories quand un appareil
neuf rejoint un fichier.

**Première fusion d'un appareil qui a déjà des données locales** avec un fichier non vide : avertissement
avant de fusionner. Les deux jeux seront réunis, et ce qui a été saisi des deux côtés apparaîtra en double.

---

## 7. Reprise de `mes-finances.json`

Le code est dans [`packages/core/src/migrate/`](../packages/core/src/migrate/). L'ancienne application est
l'artifact claude.ai « Mes finances » ; ses formats sont tirés de son code et confirmés par un export réel
(24/09/2026). L'import est proposé à l'accueil (« Reprendre mes données ») et dans Paramètres (« Importer un
fichier »), qui reconnaissent seuls une sauvegarde Cashmyr, un `finances-sync.json` ou l'ancien export.

- **Lecture stricte.** Chaque objet (`settings.v` = 2) doit avoir exactement ses champs connus : une clé en
  trop ou une obligatoire qui manque, une valeur inconnue, une catégorie ou un compte introuvable, une
  opération rangée dans un autre mois que sa date : l'import échoue en entier, et une fenêtre liste les
  raisons avec leur chemin dans le fichier.
- **Formats repris.** Transfert : `t: "tx"`, `from`, `to`. Rattachements : `goal`, `debt` sur une opération ou
  une récurrence. Opération générée : `rec`. Mois annulé : `skips`, liste d'identifiants de récurrences.
  Récurrence : `label`, `amt`, `t`, `day`, `start`, `end`, `active` (absent = active). Postes d'objectif :
  `steps` `{id, label, amount, done}`. Dates `doneAt` et `settledAt`. Valeur déclarée : `mv` (sans date).
  Couleurs : `catColors` par catégorie, `bucketColors` par usage. Précaution : `pinned` absent = épinglée.
- Montants : `Math.round(x * 100)`, avec échec si `|x·100 − arrondi| > 1e-6`. Répartition : fractions en
  points de base, avec échec si la somme ne fait pas 100 %.
- Identifiants : uuid v5 dérivés de l'identifiant d'origine. Une opération générée prend l'identifiant de
  l'occurrence de son mois, celui que Cashmyr lui aurait donné : il la reconnaît et ne la génère pas une
  seconde fois ; une deuxième pour le même mois reste une opération rattachée. Un mois annulé prend
  l'identifiant d'une annulation Cashmyr. Les catégories par défaut portent les identifiants de l'ancien
  fichier (`r1`… `d30`) : commencer avec elles, puis reprendre, n'en crée pas de doublon.
- Horodatage : toutes les lignes reprises portent `updatedAt = 1` (décision 34), ainsi que les réglages
  venus du fichier. Le thème, que l'ancienne application n'avait pas, garde 0 et ne remplace rien.
- Anciens objectifs sans `pinned` / `done` / `archived` / `targetMode` : `false` / `false` / `false` /
  `"manual"`. Couleurs de série dans l'ordre du fichier, comme à la création.
- Dette dont la catégorie n'est pas de la nature attendue (décision 35) : reprise sans catégorie. Liens vers un
  objectif, une dette ou une récurrence supprimés (décision 36) : écartés et comptés. Transfert entre deux
  comptes d'épargne rattaché à un objectif (décision 37) : l'import est refusé.
- **Vérification croisée** : un calculateur minimal refait, sur l'ancien format et en euros, les calculs de
  l'ancienne application tels qu'écrits dans son code : pour chaque mois, le nombre d'opérations, les revenus,
  besoins, envies, mise de côté et reste ; le solde de chaque compte ; l'avancement et la cible de chaque
  objectif ; le réglé de chaque dette. Chaque résultat est comparé au centime près avec celui de `core` sur les
  données converties, et chaque catégorie doit garder nom, type et usage. Le moindre écart fait échouer l'import
  sans rien écrire. La confirmation dit ce qui a été vérifié et ce qui est laissé de côté.
- Après la reprise, Cashmyr applique ses propres règles : il génère les mois de récurrence absents du fichier
  le jour venu, et le prélèvement d'une dette suit l'échéancier restant (décision 24).
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
| 17 | Updater bureau | Vérification sur clic seulement ; plugins `updater` et `process` en plus. **Remplacée par la décision 46** (0.2.0). |
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
| 34 | Import de l'ancien fichier sur un appareil qui a des données | Cashmyr gagne : les lignes reprises portent un horodatage fixe très ancien. Réimporter n'ajoute que ce qui manque et n'écrase ni une modification ni une suppression faites dans Cashmyr ; deux appareils qui importent le même fichier produisent les mêmes lignes. |
| 35 | Dette de l'ancien fichier dont la catégorie n'a pas la nature attendue (dette basculée de « je dois » à « on me doit ») | Reprise sans catégorie ; Cashmyr la demande au prochain versement (décision 26). La confirmation le dit. |
| 36 | Liens vers un objectif, une dette ou une récurrence supprimés dans l'ancienne application | Écartés, comme elle le faisait ; la vérification croisée prouve que rien ne change et la confirmation dit combien. |
| 37 | Transfert entre deux comptes d'épargne rattaché à un objectif | L'ancienne application le comptait +montant, Cashmyr 0 : l'import est refusé, avec l'opération en cause. |
| 38 | Restauration depuis l'écran de secours | La copie reprend sa place telle quelle, avec ses dates d'origine, puis la synchronisation normale passe : ce qui est plus récent dans le fichier revient. Seul ce qui n'avait été saisi que sur cet appareil après la copie est perdu. (Différent de Paramètres → Restaurer, décision 33, où la copie gagne partout.) |
| 39 | Écran de secours sans copie utilisable | « Repartir de zéro », après confirmation : l'appareil repart vide (écran d'accueil) et la synchronisation, si elle est en place, ramène tout ce qui avait été synchronisé. |
| 40 | Version abîmée | Gardée de côté automatiquement avant toute restauration (bureau : un fichier par incident ; web : la dernière), et enregistrable depuis l'écran de secours comme depuis Paramètres → Sauvegardes. |

### Validées le 25/09/2026 (version 0.2.0)

| # | Sujet | Décision |
|---|---|---|
| 41 | Montant total, montant par échéance et nombre d'échéances d'une dette | Deux champs remplis donnent le troisième, à la création comme à la modification, en mode échéancier seulement. Montant = total ÷ nombre, arrondi au centime supérieur : la dernière échéance est réduite, comme l'échéancier le fait déjà (1 000 € en 3 → 333,34 €, la dernière 333,32 €). Nombre = total ÷ montant, arrondi à l'entier supérieur (1 000 € par 300 € → 4, la dernière 100 €). Total = montant × nombre. Le total ne dépasse donc jamais l'échéancier. |
| 42 | Total du bandeau des comptes | Trois totaux au choix, propre à chaque appareil : **par défaut**, soldes des comptes courants plus valeur déclarée des comptes épargne, placement et autre ; tout en capital injecté (le total d'avant) ; capital injecté hors comptes courants. Un compte courant ne compte jamais que son solde. Un compte épargne, placement ou autre sans valeur déclarée compte pour son capital injecté, et le bandeau comme Mes comptes le signalent (« valeur non déclarée », rouge discret). La ligne « Valeur déclarée : écart » devient « Valeur injectée (hors comptes courants) ». |
| 43 | Valeur déclarée et date affichée | Elle n'a pas d'historique : elle ne compte que si elle a été déclarée au plus tard à la date affichée (31/12 d'une année passée), sinon le capital injecté. Une valeur sans date, reprise de l'ancienne application, ne compte que pour aujourd'hui. |
| 44 | Patrimoine net | Total en valeurs déclarées (décision 42, quel que soit le total choisi) moins le total dû. L'épargne de précaution, la courbe d'épargne et les indicateurs de l'année restent en capital injecté. |
| 45 | Remise à zéro | Deux gestes, chacun confirmé, chacun précédé d'une copie de sauvegarde. **Cet appareil** : les modifications en attente partent d'abord dans le fichier (synchronisation automatique), le fichier est oublié, les données locales et l'état de l'appareil (sauf son identifiant et son nom) sont retirés, l'application repart de l'accueil ; le fichier et les autres appareils ne changent pas. **Partout** : un passage de synchronisation, puis chaque ligne vivante devient une suppression et chaque réglage reprend sa valeur par défaut, horodatés maintenant ; la synchronisation porte l'effacement partout, et une ligne modifiée ailleurs après l'effacement revient (décision 1). Réimporter ensuite une sauvegarde ou l'ancien fichier ne rend rien (décisions 32 et 34) ; « Restaurer » la copie prise juste avant (décision 33) remet tout. L'accueil revient dès qu'il ne reste aucune ligne vivante ; ses catégories par défaut reprennent alors les suppressions qu'il connaît avec un horodatage plus récent. |
| 46 | Recherche de mise à jour (bureau) | Au lancement, sauf si l'appareil l'a désactivée (Paramètres → Application, activée par défaut), et sur clic. Hors ligne, elle échoue sans rien afficher. Rien ne s'installe sans le clic de l'utilisateur. Remplace la décision 17. |
| 47 | Identité d'un tag | Même nom, même tag, à la casse, aux accents et aux espaces près : l'identifiant se déduit du nom à la création, et deux appareils qui créent le même nom avant de se synchroniser créent le même tag. Renommer garde l'identité ; un tag créé ensuite sous l'ancien nom d'un tag renommé reçoit un autre identifiant. Deux tags vivants ne portent jamais le même nom. |
| 48 | Usage d'un tag | Un tag au plus par opération, transferts compris ; une récurrence taguée le transmet à chaque occurrence. Filtre dans Opérations ; le total d'un tag porte sur le mois affiché : entrées, sorties, solde, les transferts listés sans compter. Colonne « Tag » en fin d'export CSV. Supprimer un tag ne réécrit rien : les opérations le gardent sans l'afficher (ni dans l'export), et le retrouvent si un tag de ce nom est recréé. |
| 49 | Ordre des comptes | Choisi dans Mes comptes, synchronisé (une position par compte, comme les objectifs et les dettes), et suivi partout : bandeau, listes, saisie, Paramètres. Un compte sans position vient après, dans l'ordre d'arrivée ; à position égale (deux appareils qui réordonnent en même temps), l'ordre alphabétique départage. |
| 50 | Format 2 des données | Collection `tags`, `tagId` sur les opérations et les récurrences, `position` sur les comptes. Données locales, copies de sauvegarde, sauvegardes importées et fichier de synchronisation du format 1 sont mis à niveau à la lecture, puis réécrits au format 2. Une version 0.1.x refuse un fichier au format 2 (« Mets l'application à jour ») sans rien écrire ni perdre : chaque appareil doit passer en 0.2.0. |

### Validées les 25 et 26/09/2026 (profils, version 0.3.0)

| # | Sujet | Décision |
|---|---|---|
| 51 | Profil | Un profil est un budget complet et indépendant : catégories, comptes, opérations, tags, objectifs, dettes, récurrences et réglages, avec son propre fichier de synchronisation et ses copies de sauvegarde. Rien n'est partagé ni additionné d'un profil à l'autre, et il n'y a pas de vue d'ensemble. « Foyer » est un profil comme un autre ; partager un profil, c'est partager son fichier. Le format des données ne change pas. |
| 52 | Accès aux profils | Pas de verrou : sur un appareil, chacun peut ouvrir tous les profils. Un profil reste privé en ne l'installant que sur son propre appareil. |
| 53 | Argent versé d'un profil à l'autre | Deux saisies sans lien : une sortie dans un profil, une entrée dans l'autre. |
| 54 | Ouverture | Avec un seul profil, il s'ouvre directement. Avec au moins deux, l'écran « Qui utilise Cashmyr ? » s'affiche à chaque lancement. Changer de profil en cours de route relance l'application sur l'autre profil sans repasser par ce choix ; un rechargement pour mise à jour garde aussi le profil ouvert. |
| 55 | Premier profil | Les données déjà présentes deviennent le profil « Mon budget », sans être déplacées. On le renomme dans Paramètres → Profils, et la création du deuxième profil propose de le nommer. |
| 56 | Supprimer un profil | Le profil n'est retiré que de cet appareil. En synchronisation automatique, les modifications en attente partent d'abord dans le fichier. Ensuite, ses données locales quittent l'appareil, copies de sauvegarde et versions mises de côté comprises. Le fichier et les autres appareils ne changent pas : rejoindre le fichier depuis un nouveau profil le fait revenir. Sans fichier, la confirmation propose d'abord d'enregistrer une sauvegarde et demande de taper le nom du profil. Le dernier profil ne se supprime pas : la remise à zéro (décision 45) le remplace. |
| 57 | Un fichier, un profil | Sur un appareil, un fichier de synchronisation ne sert qu'à un profil. Rejoindre depuis un profil le fichier d'un autre profil de l'appareil (même `fileId`) est refusé, en nommant ce profil ; sinon les deux profils se fondraient l'un dans l'autre au fil des synchronisations. |
| 58 | Supprimer un profil en synchronisation assistée | S'il reste des modifications qui ne sont pas dans le fichier, c'est le cas « sans fichier » de la décision 56 : sauvegarde proposée d'abord, nom du profil à taper. |
| 59 | Réglages de l'appareil ou du profil | La recherche de mise à jour au lancement vaut pour tout l'appareil. Le total du bandeau, le filtre de Mes comptes et les camemberts masqués sont propres à chaque profil sur l'appareil. |
| 60 | Version des profils | 0.3.0, sans changement de format des données : un appareil en 0.2.0 peut rejoindre le fichier de n'importe quel profil. |

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

Enveloppe Tauri, choix validés le 23/09/2026 :
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

Reprise, choix d'interface validés le 24/09/2026 :
- L'accueil gagne une troisième carte, « Reprendre mes données » ; Paramètres, « Importer un fichier ».
  Les deux passent par le même parcours, qui reconnaît le type de fichier.
- Un refus s'affiche dans une fenêtre, jusqu'à six raisons avec leur chemin dans le fichier, et non dans un
  message qui s'efface.
- La confirmation dit ce que contient l'ancien fichier et ce que la vérification a trouvé identique. Sur un
  appareil déjà en service, elle annonce seulement ce qui change vraiment : une ligne identique à
  l'horodatage près ne compte pas (même règle pour l'import d'une sauvegarde).

Reprise, choix validés le 24/09/2026 : décisions 35 à 37 ci-dessus. L'en-tête CSV avec la colonne `Dette`
est repris par l'export CSV.

Publication (étape 6), choix validés le 24/09/2026 :
- **macOS : un seul `.dmg` universel** (Apple Silicon et Intel), macOS 12 minimum. Signature ad hoc
  (`signingIdentity: "-"`) : sans elle, un Mac Apple Silicon déclare l'application « endommagée » et
  refuse de l'ouvrir. Ce n'est pas une signature par une autorité et elle ne contourne rien : Gatekeeper
  avertit comme prévu. **Écart avec la consigne** : depuis macOS 15, le clic droit → « Ouvrir » ne suffit
  plus ; le README donne aussi le chemin Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».
- **Release** : le tag doit porter le numéro de `apps/desktop/package.json`, `apps/web/package.json` et
  `Cargo.toml`, et les tests passent avant toute construction. Les binaires arrivent dans un brouillon, publié
  seulement quand `latest.json` couvre macOS (deux architectures), Windows et Linux à la bonne version :
  l'updater ne voit jamais une Release à moitié remplie. Une Release déjà publiée n'est jamais modifiée.
- **Garde-fou de la clé** (ajouté après la 0.1.0) : chaque signature de `latest.json` doit porter
  l'identifiant de la clé publique de `tauri.conf.json` au commit du tag. Un secret contenant une autre clé
  privée, avec son bon mot de passe, construirait sans erreur des paquets que les applications installées
  refuseraient ; la publication est bloquée à la place (`.github/scripts/check-latest.mjs`).
- Les archives signées de l'updater ne sont produites qu'en Release (`tauri.release.conf.json`) : un
  `pnpm build:desktop` local n'a pas besoin de la clé privée.
- Windows : l'updater installe le `-setup.exe` (NSIS) en mode passif, une petite fenêtre de progression,
  sans droits d'administrateur. Les deux installateurs sont en français seulement, comme l'application
  (à partir de la version qui suit la 0.1.0) : NSIS avec la traduction fournie par Tauri, `.msi` en `fr-FR` avec
  `windows/fr-FR.wxl` pour les quatre textes propres à Tauri. Le `.msi` s'appelle `…_x64_fr-FR.msi`. Linux : l'updater met à jour l'AppImage ; `.deb` et `.rpm` se mettent à
  jour à la main.
- **PWA** : service worker en mode « prompt ». La nouvelle version se télécharge en arrière-plan puis attend.
  Le bandeau « Nouvelle version disponible. » propose « Recharger » ou « Plus tard ». Paramètres → Application
  garde le bouton tant que la version attend. Toute la coquille est précachée (pages, scripts, styles, polices,
  icônes), rien n'est mis en cache à l'exécution. À la première visite, un message dit que l'application
  fonctionne désormais hors ligne.
- Avant de recharger ou de redémarrer : un passage de synchronisation s'il reste des modifications en
  attente (mode automatique), puis les écritures locales se terminent.
- Paramètres gagne une huitième section, « Application » : version en service et, sur le bureau, « Rechercher une
  mise à jour ». Une vérification impossible donne la raison technique entre parenthèses, en anglais, telle que
  Tauri la renvoie.
- Icônes de la PWA : tuile de l'icône de bureau pour « any » ; pour « maskable » et l'apple-touch-icon, fond plein
  et anneau réduit à 85 %, dans la zone sûre.
- La CI passe aussi `cargo fmt`, `clippy` et les tests Rust, sur macOS ; la publication Pages repasse types et
  tests avant de construire.

Écran de secours, choix d'interface validés le 24/09/2026 (décisions 38 à 40 ci-dessus) :
- Il remplace l'application au démarrage, sur le bureau comme sur le web, et remplace aussi la marche à suivre
  à la main que l'écran d'échec du bureau donnait depuis la PR #4.
- Chaque copie est vérifiée comme au démarrage ; une copie abîmée est listée (« abîmée elle aussi ») sans
  bouton. La plus récente utilisable a le bouton principal. « Repartir de zéro » n'apparaît que s'il n'existe
  aucune copie utilisable, et demande une confirmation sur place.
- Bureau : la version abîmée est copiée dans `mis-de-cote/data-<horodatage>.json`, et non renommée à la
  racine : la portée de `plugin-fs` n'est éprouvée que pour les sous-dossiers, comme `backups/`.
- La version abîmée est copiée de côté *avant* que la copie la remplace, d'une seule écriture : une panne au
  milieu laisse l'appareil tel quel, et l'écran de secours revient au lancement suivant.
- Les modifications en attente sont ramenées à la copie : une ligne absente de la copie n'a plus rien à
  envoyer ; une ligne plus ancienne reste à envoyer dans la version de la copie.
- Données d'une version plus récente de Cashmyr : pas d'écran de secours, le message demande de mettre
  l'application à jour.
- Paramètres → Sauvegardes gagne une carte « Versions abîmées mises de côté » (Enregistrer, Supprimer après
  confirmation), visible seulement s'il y en a.

Version 0.2.0, choix validés le 25/09/2026 :
- **Montants au centime partout**, gros chiffres compris (bandeaux, jauges, indicateurs) ; cela remplace l'arrondi
  à l'euro de l'étape 4. Seules les graduations des axes des graphiques restent rondes.
- **Répartition** : au-delà de sa cible, la jauge des besoins ou des envies passe en rouge pour la part qui dépasse,
  et sa légende dit « dépassée de … » en rouge, avec une icône. L'épargne au-delà de sa cible n'est pas un avertissement.
- **Tableau de bord** : sous le bandeau, « Cibles de <mois> » reprend les trois jauges de la Répartition du mois en
  cours (besoins et envies : reste ou dépassement ; épargne : encore à mettre de côté), pour l'année en cours seulement,
  avec « Voir le mois ». Ce bloc n'entre pas dans l'ordre des blocs (`dashOrder`), qui ne change pas de format.
- **Bandeau des comptes** : un sélecteur « Total affiché » à droite du titre (décision 42). Dans la légende, un
  compte épargne, placement ou autre montre sa valeur déclarée, et dessous « injecté … » ou « valeur non déclarée ».
- **Mes comptes** : chaque compte dans sa propre tuile. Un filtre à puces (« Tous », puis les types présents) agit sur
  « Mouvements de l'année » et « Vos comptes », pas sur le bandeau. La valeur déclarée passe en avant, avec le
  capital injecté, l'écart et la date dessous.
- **Choix d'affichage propres à l'appareil** : total du bandeau et filtre de Mes comptes vivent dans l'état de
  l'appareil (`DeviceState.display`), jamais synchronisés et jamais comptés comme modifications en attente.
- **Paramètres → Comptes** : un compte courant n'a plus de champ « Valeur déclarée », sauf s'il en porte une (reprise),
  signalée comme ignorée.
- **Écran Mois, camemberts** : « Dépenses par poste » (toutes les dépenses, épargne comprise, sans les transferts) au-dessus
  de « Revenus par source ». Grand écran (≥ 980 px) : colonne de droite, figée sous l'en-tête au défilement, les deux
  cartes tenant dans la fenêtre du bureau ; écran moyen : côte à côte sous l'en-tête du mois ; téléphone : l'une sous
  l'autre. « Masquer » et « Afficher les graphiques » : choix de l'appareil.
- **Forme des camemberts** : anneau, total au centre, et au survol ou au focus d'une part (ou de sa ligne de légende) sa
  valeur et sa part. Cinq parts au plus : les quatre plus gros postes, puis « Autres », hachuré, dont la légende détaille
  les postes à la demande. La légende sert de tableau : chaque ligne a son montant et son pourcentage. Dépenses rangées
  par usage, dans la couleur de l'usage : la couleur, puis alternativement plus claire et plus foncée, pour que deux parts
  voisines tranchent toujours (vérifié au validateur de palettes, en clair et en sombre, dernière part contre première
  comprise) ; revenus dans la couleur de chaque source, comme le bandeau des revenus.
- **Paramètres → Sauvegardes** : carte « Remise à zéro », « Effacer cet appareil… » et « Tout effacer, partout… »
  (décision 45), chacun avec une confirmation qui dit ce qui se passe selon la synchronisation en place.
- **Paramètres → Application** (bureau) : case « Rechercher une mise à jour au lancement », cochée par défaut (décision 46).
- **Échéancier calculé** (décision 41) : quand les trois champs sont remplis, c'est celui modifié le moins
  récemment qui se recalcule. Sur une dette enregistrée dont un seul champ est modifié, le total est gardé en
  priorité, puis le montant par échéance. Le champ calculé le dit sous le champ (« Calculé… »), avec le montant de
  la dernière échéance quand elle est réduite. Un champ tout juste calculé ne sert pas de base au calcul suivant
  pendant la frappe. En remboursement libre, rien ne se calcule.
- **Tags** : champ « Tag » dans la saisie d'une opération et d'une récurrence, avec les tags existants proposés ; un nom
  nouveau est annoncé (« Nouveau tag … »), puis créé à l'enregistrement. Le tag s'affiche en étiquette dans les listes
  d'opérations. Paramètres gagne une section « Tags » (renommer sur place, supprimer après confirmation, nombre
  d'opérations et de récurrences par tag).
- **Ordre des comptes** : « Modifier l'ordre » sur la carte « Vos comptes » fait apparaître sur chaque tuile une poignée
  de glisser-déposer et deux flèches ; « Terminé » les retire. Avec un filtre actif, on déplace parmi les comptes montrés.

---

## 9. Profils (version 0.3.0)

Décisions 51 à 60. Chaque profil a son propre stockage local, avec la même forme qu'aujourd'hui : `LocalStore`,
`SyncFile`, `Repository` et `SyncEngine` ne voient jamais qu'un profil, et seul le moteur gagne un crochet
(décision 57). Au-dessus d'eux, un registre propre à l'appareil dit quels profils existent.

### Registre des profils

```ts
type ProfileEntry = {
  id: string;             // « principal » pour le premier profil, uuid v4 pour les suivants
  name: string;           // non vide, unique sur l'appareil à la casse, aux accents et aux espaces près
  createdAt: number;
  syncFileId: string | null;  // fileId du fichier de synchronisation du profil, tenu à jour à chaque fusion
};
type ProfileRegistry = {
  version: 1;
  profiles: ProfileEntry[];
  checkUpdatesOnLaunch: boolean;  // bureau : réglage de l'appareil, plus d'un profil (décisions 46 et 59)
};
```

- Jamais synchronisé : chaque appareil a ses profils.
- **Registre absent** : un seul profil, « Mon budget », d'identifiant `principal`. Le registre n'est écrit
  qu'au premier renommage ou à la création d'un deuxième profil. Un appareil qui n'en crée pas n'écrit donc
  rien de nouveau, et un retour à la 0.2.0 retrouve ses données telles quelles.
- **Registre présent** : il fait foi, même quand `principal` en a été retiré.
- Au premier enregistrement, `checkUpdatesOnLaunch` reprend la valeur que `principal` avait dans
  `DeviceState.display`.

### Stockage par plateforme

| | Bureau Tauri | PWA |
|---|---|---|
| Registre | `$APPDATA/profils.json`, écrit dans `.tmp` puis renommé | base IndexedDB `cashmyr-profils` |
| Profil `principal` | emplacement actuel : `data.json`, `backups/`, `mis-de-cote/`, `device.json`, `sync-target.txt` à la racine de `$APPDATA` | base `cashmyr` |
| Autres profils | même disposition dans `$APPDATA/profils/<id>/` | base `cashmyr-<id>` |

Tout ce qui est propre à un profil reste dans son stockage : `DeviceState` (modifications en attente, choix
d'affichage, fichier de synchronisation) et, sur le web, le handle du fichier. Chaque profil a donc son
`deviceId`, et un appareil apparaît une fois dans le registre de chaque fichier qu'il rejoint.

**Commandes Rust.** Les six commandes de synchronisation agissent sur le profil choisi au démarrage.
- `profile_select(id)` : Rust n'accepte que `principal` ou un uuid v4, et un dossier `profils/<id>/`
  existant. Le front ne peut donc toujours pas diriger la synchronisation hors des fichiers choisis dans
  le dialogue.
- `profile_remove(id)` retire le stockage d'un profil, `sync-target.txt` compris, puisque `plugin-fs` n'a
  pas le droit d'y toucher.
- La règle `deny` de `capabilities/default.json` couvre aussi `$APPDATA/profils/*/sync-target.txt`.
- « Créer un nouveau fichier » propose `finances-sync.json` pour `principal` et
  `finances-sync-<nom>.json` pour les autres profils.

### Démarrage et changement de profil

- `apps/*/src/platform.ts` ne construit plus une `Platform` mais un hôte : il lit le registre et ouvre un
  profil (`openProfile(id)` → `Platform`). `files` et `updates` ne dépendent pas du profil.
- `startApp` lit le registre et ouvre directement le profil s'il est seul. Sinon, il ouvre celui qu'a noté
  la session (`sessionStorage`, posé par un changement de profil ou un rechargement), et à défaut affiche
  « Qui utilise Cashmyr ? ». Le reste du démarrage ne change pas, écran de secours compris : il porte sur le
  profil ouvert, avec un lien « Changer de profil ».
- La recherche de mise à jour au lancement ne dépend d'aucun profil : elle part avant le choix.
- **En-tête** : dès qu'il y a deux profils, le nom du profil ouvert s'y affiche. Il ouvre un menu avec les
  autres profils et « Gérer les profils ».
- **Changer de profil** passe par le même chemin qu'un rechargement pour mise à jour : un passage de
  synchronisation s'il reste des modifications en attente (mode automatique), la fin des écritures, puis
  la relance sur l'autre profil.
- **Web** : deux onglets peuvent montrer deux profils différents, puisque ce sont deux bases.

### Paramètres → Profils

Nouvelle section, visible même avec un seul profil.
- **Liste** : les profils de l'appareil, avec renommer sur place et supprimer.
- **« Nouveau profil »** demande un nom. Pour le deuxième profil, elle propose aussi de renommer « Mon
  budget ». Le registre est ensuite enregistré, puis l'application se relance sur le nouveau profil, qui
  arrive sur l'accueil : catégories par défaut, reprise ou sauvegarde, ou fichier à rejoindre.
- **Supprimer** suit les décisions 56 et 58. Le profil ouvert se supprime aussi : l'application se relance sur le
  choix, ou directement sur le profil qui reste.
- **Remise à zéro** (décision 45) : elle porte sur le profil ouvert, et ses libellés le nomment dès qu'il
  y a deux profils.

### Synchronisation

- **Un fichier, un profil** (décision 57) : le registre garde le `fileId` du fichier de chaque profil. Avant la
  première fusion avec un fichier, le moteur appelle un nouveau crochet, `checkFileFree(fileId)` ; si un autre
  profil de l'appareil a ce `fileId`, le passage s'arrête sans rien écrire et le message nomme ce profil.
- Le reste ne change pas : chaque profil se synchronise seul, avec son fichier, au rythme du §6.
