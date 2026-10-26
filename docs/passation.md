# Passation de Cashmyr

État au 25/10/2026, pour reprendre le développement sur un autre Mac à partir d'un clone neuf du dépôt.

- **Version publiée** : 0.5.0, le 25/10/2026, tag `v0.5.0` sur la fusion de la PR de version (`release-0.5.0`).
  - [Release](https://github.com/Aiebou/Cashmyr/releases/tag/v0.5.0), avec `latest.json` contrôlé par
    `check-latest.mjs` (clé `EFBCA89EB0CD97C`).
  - PWA en ligne sur <https://aiebou.github.io/Cashmyr/>.
- **Contenu de la 0.5.0** : le lot sans changement de format de la liste du 25/10 (voir §6) : Mes comptes (PR #22),
  « Catégories » et « Haut de page » (PR #23), taux d'endettement (PR #24, décisions 69 et 70), menu latéral du grand
  écran (PR #25).
- **Lot 0.6.0 en cours** (format 3), une pile de PR à fusionner ensemble juste avant le tag, jamais une seule : la PWA
  publiée écrirait sinon un format que les applications de bureau en 0.5 refuseraient.
  - PR #27, `format-3-budgets` : modèle, mise à niveau et calculs (décisions 71 à 82) ;
  - `budgets-interface`, empilée dessus : Paramètres → Budgets, types, menu « Type » (décisions 83 à 87) ;
  - `types-comptes`, empilée sur la précédente : types d'un compte, part réservée à la saisie, carte de
    précaution (point 18) ;
  - `objectifs-types`, empilée sur la précédente : objectif d'un type d'épargne (point 7, décision 88).
- **Tests** : 513 tests TypeScript et 15 tests Rust passent sur la dernière branche de la pile (core 268, storage 97, ui 148). La séquence
  d'installation du §3 a été vérifiée sur un clone neuf le 23/10/2026.

La référence reste [`architecture.md`](architecture.md) : modèle de données, règles de calcul et de fusion, et les
88 décisions numérotées du §8. Ce document résume. En cas d'écart, `architecture.md` et le code font foi. Le cahier
des charges d'origine est dans [`cahier-des-charges.md`](cahier-des-charges.md).

## Sommaire

1. [Avancement, étape par étape](#1-avancement-étape-par-étape)
2. [Décisions d'architecture et leurs raisons](#2-décisions-darchitecture-et-leurs-raisons)
3. [Installer, tester, lancer](#3-installer-tester-lancer)
4. [Publier une version](#4-publier-une-version)
5. [Fichiers présents uniquement sur l'ancien Mac](#5-fichiers-présents-uniquement-sur-lancien-mac)
6. [Ce qui reste à faire, dans l'ordre](#6-ce-qui-reste-à-faire-dans-lordre)
7. [Pièges rencontrés](#7-pièges-rencontrés)

---

## 1. Avancement, étape par étape

Le [cahier des charges](cahier-des-charges.md) du 23/09/2026 fixait un déroulé en six étapes, la première à valider avant d'écrire le reste.
Chaque étape a ensuite été validée avant la suivante. Toutes sont terminées et validées.

| Étape | Contenu | Commits sur `main` | Date |
|---|---|---|---|
| 1 | Architecture : arborescence, schéma des collections, interfaces des adaptateurs (`docs/architecture.md`) | 011a8d9 | 23/09 |
| 2 | `packages/core` et ses tests : calculs, dettes, fusion | 011a8d9 | 23/09 |
| 3 | `packages/storage` : dépôt local, moteur de synchronisation, trois adaptateurs, test de bout en bout à trois appareils | e48552f | 23/09 |
| 4 | Interface, écran par écran : saisie, Mois, Objectifs, Tableau de bord, Dettes, Mes comptes, Opérations, Paramètres ; enveloppe Tauri | d4a5b70 à 7cf6829 | 23/09 |
| 5 | Reprise de `mes-finances.json` (ancienne application), lecture stricte et vérification croisée | 10fd079, 923ecdb | 23 et 24/09 |
| 6 | Workflows GitHub, PWA hors ligne, updater du bureau, première Release, Pages | 04b6a48, PR #1 | 24/09 |

Versions publiées depuis :

| Version | Date | PR | Contenu |
|---|---|---|---|
| 0.1.0 | 24/09/2026 | #1 | Première Release (04b6a48), nouvelle clé de l'updater |
| 0.1.1 | 24/09/2026 | #2, #3 | Garde-fou de la clé dans `latest.json`, installateurs Windows en français |
| 0.1.2 | 25/09/2026 | #4 à #7 | Écran de secours quand les données locales sont abîmées (décisions 38 à 40) |
| 0.2.0 | 26/09/2026 | #8 à #11 | Montants au centime, valeurs déclarées et trois totaux, cibles du mois, camemberts, remise à zéro, mise à jour au lancement, format 2 (tags, ordre des comptes). Décisions 41 à 50 |
| 0.3.0 | 26/09/2026 | #12, #13 | Profils : un budget complet par profil, choix au lancement, Paramètres → Profils. Décisions 51 à 61 |
| 0.4.0 | 26/09/2026 | #14, #15 | En-tête (synchro à gauche, menu du profil), total choisi dans le titre du bandeau, tuile « + Profil », tutoriel. Décisions 62 à 67 |
| 0.4.1 | 25/10/2026 | #16 à #21 | Passation et `CLAUDE.md`, cahier des charges, documentation à jour, jeux d'essai neutralisés, catégories par défaut aux noms génériques. Décision 68 |
| 0.5.0 | 25/10/2026 | #22 à #26 | « Vos comptes » avant « Mouvements de l'année », modification d'un compte depuis Mes comptes ; « Catégories », « Haut de page » sur téléphone ; taux d'endettement dans Dettes et dans les indicateurs de l'année ; menu latéral repliable sur grand écran. Décisions 69 et 70 |

Dates de publication des Releases, heure de Paris : la 0.1.2, la 0.2.0 et la 0.3.0 sont sorties peu après minuit, la 0.4.0 le matin, la 0.4.1 vers 1 h 30, la 0.5.0 le même jour. GitHub, en UTC, les date de la veille.

Demandes reçues après le cahier des charges, toutes livrées sauf une :
- 23/09 : dettes et 7e onglet, menu « Ajouter », couleurs personnalisables ;
- 25/09 : liste « Modifications à apporter (v0.1.2) », devenue la 0.2.0 et, pour les profils, la 0.3.0 ;
- 26/09 : liste « Maj de la v0.3.0 », devenue la 0.4.0 ;
- 24/10 : jeux d'essai publics et catégories par défaut sans éléments personnels (décision 68), livrés en 0.4.1 ;
- 25/10 : liste « DTI, budgets, ergonomie » : la partie sans changement de format livrée en 0.5.0, le reste en
  cours (§6).

**Reporté** : le type de compte « Compte professionnel ». Il changerait le format des données, et sa place dans
les calculs reste à définir ; un « profil professionnel » est l'autre piste. Rien n'est commencé
(`architecture.md` §8, après la décision 68).

## 2. Décisions d'architecture et leurs raisons

### Les choix de structure

- **Deux cibles, un seul code.**
  - Une PWA sur GitHub Pages, installable et partageable gratuitement.
  - Une application de bureau Tauri v2, distribuée en binaires sur GitHub Releases.
- **Stack imposée** : React 18 et TypeScript, Vite, pnpm workspaces sans Turborepo ni Nx, Zustand, CSS modules,
  graphiques en SVG écrits à la main, Vitest. TypeScript tourne en `strict` avec `noUncheckedIndexedAccess`, un choix
  de l'étape 1 (`tsconfig.base.json`).
  - *Raison :* imposée par le cahier des charges, qui exclut aussi Redux, Tailwind, les librairies de composants et
    de graphiques.
- **Paquets** : `core` ← `storage` ← `ui` ← `apps/*`.
  - `core` est pur : ni React, ni stockage, ni `Date.now()` implicite. Tout calcul s'y teste sans navigateur.
  - `storage` a trois entrées : la racine, `web` et `tauri`. La PWA n'importe jamais l'entrée `tauri`, et inversement.
  - `ui` ne détecte jamais la plateforme : un écran lit une capacité de `platform`, par exemple
    `platform.sync.mode === "assisted"`. *Raison :* le cahier des charges interdit « un `if (isTauri)` dispersé dans
    les composants ».
- **Montants en centimes entiers** (`Cents`, `Number.isSafeInteger`).
  - Arrondi au centime le plus proche, la moitié loin de zéro (décision 15) ; répartitions en points de base.
  - *Raison :* « Aucun flottant ne doit atteindre la base. »
- **Aucun serveur, aucun appel réseau à l'exécution.** Une CSP l'impose sur les deux cibles.
  - Exception acceptée : la recherche de mise à jour (décision 46). Le bureau lit le `latest.json` de la dernière
    Release, au lancement, sauf si l'appareil l'a désactivée, et sur clic. La PWA laisse son service worker
    regarder si une nouvelle version existe. Hors ligne, rien ne s'affiche.
  - Les polices sont embarquées en woff2, jamais chargées depuis Google Fonts.
- **`Repository`** est la seule porte d'entrée des données. Chaque lot d'écriture est validé en entier : tout passe
  ou rien. Aucune correction silencieuse : un import douteux échoue (décision 16).

### Synchronisation et fusion (§3 et §4 d'`architecture.md`)

- **Un fichier, `finances-sync.json`, dans le dossier cloud de chacun** (iCloud Drive, Dropbox, Syncthing…).
  Chaque appareil reste sa propre source de vérité et marche à 100 % sans synchronisation.
- **Fusion ligne à ligne, la plus récente gagne.** C'est un LWW (« last writer wins », la dernière écriture gagne) sur `updatedAt`, avec pierres tombales (`deletedAt`).
  - À égalité, la suppression gagne, puis le JSON canonique le plus grand (décision 4). *Raison :* arbitraire mais
    déterministe, donc les appareils convergent.
  - L'horloge vaut `max(maintenant, ancien + 1)`.
  - Les préférences fusionnent clé par clé.
  - La fusion est commutative, idempotente et associative, ce que les tests vérifient sur 300 tirages aléatoires.
- **Identifiants** : uuid v5 déterministes pour les occurrences, les annulations et l'import, uuid v4 ailleurs
  (décision 3). *Raison :* deux appareils qui génèrent la même occurrence produisent la même ligne.
- **Purge** : une pierre tombale part après 90 jours seulement si tous les appareils du registre l'ont vue et
  qu'aucune ligne vivante ne la référence. Un appareil absent depuis 180 jours sort du registre. Sans fichier, rien
  n'est purgé (décisions 2, 20 et 21).
- **Écriture atomique** : sur le bureau, commandes Rust (fichier temporaire, `fsync`, puis renommage) ; sous Chromium,
  `createWritable()` ; en mode assisté, l'utilisateur remplace lui-même l'original. Sur le bureau, le chemin du
  fichier choisi n'est jamais exposé à `plugin-fs` (règle `deny` sur `sync-target.txt`).
- **Modes** :
  - bureau, Chrome et Edge : automatique (au lancement, au retour au premier plan, 2 s après une modification) ;
  - Safari, Firefox et mobile : assisté, en deux gestes, « Synchroniser » puis « Enregistrer le fichier fusionné ».
    *Raison :* iOS refuse un partage qui ne suit pas un geste de l'utilisateur.

### Format des données

- **Format 2 depuis la 0.2.0** (décision 50) : collection `tags`, `tagId` sur les opérations et les récurrences,
  `position` sur les comptes. Le format 1 est mis à niveau à la lecture.
- Une version plus ancienne refuse un format plus récent (« Mets l'application à jour ») sans rien écrire.
- La 0.3.0, la 0.4.0 et la 0.5.0 n'ont pas changé le format (décisions 60 et 67).
- **Format 3 pour la 0.6.0** (décisions 71 à 82) : budgets et types à la place des usages, comptes et opérations
  rattachés aux types, précaution devenue l'objectif d'un type ; base IndexedDB en version 3. La mise à niveau
  est une fonction pure (`packages/core/src/migrate/format3.ts`) : deux appareils obtiennent les mêmes lignes.
- **Tout nouveau champ synchronisé change le format**, parce que la validation refuse les champs inconnus. Il faut
  alors :
  - une version de schéma et sa migration ;
  - une version de la base IndexedDB si un magasin s'ajoute ;
  - une fusion juste avant le tag (voir la fin du §4).

### Les décisions numérotées, par thème

Le détail et la formulation exacte sont au §8 d'`architecture.md`. Les raisons qui y sont écrites sont reprises ici.

- **Récurrences (5, 6, 23)**
  - L'occurrence du mois en cours apparaît le jour venu. Avant, elle est listée dans « Prévu ce mois ».
  - Supprimer une opération générée vaut annulation (un `Skip`).
  - Une récurrence reprise après une pause marque les mois de pause « ignorés ».
- **Moyennes et dates de référence (7, 8, 9, 12, 13, 14, 19, 27)**
  - Les mois vides comptent pour 0, et la fenêtre ne remonte pas avant la première opération.
  - Si aucun mois de la fenêtre n'a d'opération, l'écran affiche un message, jamais 0.
  - Le mois en cours est exclu des moyennes annuelles. *Raison :* il est incomplet.
- **Objectifs (10, 11, 22)** : « Atteint » est un drapeau manuel, et la carte propose de le poser.
- **Dettes (24 à 29, 41)**
  - Les prélèvements suivent l'échéancier restant. *Raison :* ils ne paient jamais trop.
  - Supprimer une dette arrête ses prélèvements.
  - Deux des trois champs (total, montant par échéance, nombre) donnent le troisième, en arrondissant vers le haut
    avec une dernière échéance réduite. *Raison :* le total ne dépasse jamais l'échéancier.
- **Comptes et totaux (30, 42, 43, 44, 49, 62)**
  - Trois totaux au choix pour le bandeau. Par défaut : soldes des comptes courants plus valeurs déclarées des
    autres comptes.
  - La valeur déclarée n'a pas d'historique : elle ne compte que si elle a été déclarée au plus tard à la date
    affichée.
  - Le patrimoine net suit les valeurs déclarées. L'épargne de précaution et les courbes restent en capital injecté.
  - L'ordre des comptes est synchronisé.
- **Catégories et tags (31, 47, 48, 68)**
  - Même nom, même tag : l'identifiant se déduit du nom normalisé. *Raison :* deux appareils qui créent hors ligne un
    tag de même nom obtiennent le même tag.
  - Un tag au plus par opération. Supprimer un tag ne réécrit rien.
  - Quatre catégories par défaut ont reçu des noms génériques, horodatés 2 : une catégorie jamais modifiée prend le
    nouveau nom à la synchronisation, un nom choisi par l'utilisateur gagne toujours (décision 68).
- **Import, restauration, secours, remise à zéro (16, 32 à 40, 45)**
  - L'import JSON fusionne. Restaurer une copie la fait gagner partout.
  - À la reprise de l'ancien fichier, Cashmyr gagne. *Raison :* réimporter n'ajoute que ce qui manque.
  - L'écran de secours remet la copie telle quelle, puis la synchronisation passe.
  - La remise à zéro se fait en deux gestes, « cet appareil » ou « partout », chacun précédé d'une copie.
- **Bureau et noms (17 remplacée par 46, 18)**
  - Identifiant `io.github.aiebou.cashmyr`, base `/Cashmyr/`.
  - Updater : `https://github.com/Aiebou/Cashmyr/releases/latest/download/latest.json`.
- **Profils (51 à 61, 63, 64)**
  - Chaque profil est un budget complet et indépendant, avec son propre fichier de synchronisation.
  - Pas de verrou ; l'argent versé d'un profil à l'autre se saisit deux fois.
  - À partir de deux profils, l'écran « Qui utilise Cashmyr ? » s'affiche à chaque lancement.
  - Un fichier ne sert qu'à un profil par appareil. *Raison :* sinon deux profils se fondraient l'un dans l'autre.
  - Supprimer un profil ne le retire que de cet appareil.
  - Le premier profil reprend les données existantes sans les déplacer. *Raison :* un retour à la 0.2.0 les retrouve
    telles quelles.
- **Tutoriel (65 à 67)**
  - Il ne s'adresse qu'aux profils ouverts pour la première fois à partir de la 0.4.0.
  - Chaque onglet se présente à sa première visite. « Passer » ne ferme que l'onglet en cours.
  - La mémoire est propre à l'appareil et au profil (`DeviceState.tour`). *Raison :* le format des données ne change
    pas.

### Les choix de publication (fin du §8)

- **macOS : un seul `.dmg` universel**, macOS 12 minimum.
  - Il faut macOS 12 parce que l'interface utilise `color-mix()`.
  - Signature ad hoc (`signingIdentity: "-"`). *Raison :* sans elle, un Mac Apple Silicon déclare l'application
    « endommagée ». Ce n'est pas une signature par une autorité : Gatekeeper avertit, et le README explique comment
    ouvrir l'application malgré tout. Consigne : ne pas contourner ces mécanismes.
- **Release en brouillon** jusqu'à ce que `latest.json` couvre les quatre plateformes, signées par la clé de
  `tauri.conf.json`. Le garde-fou est `.github/scripts/check-latest.mjs`. *Raison :* l'updater ne voit jamais une
  Release à moitié remplie, ni une Release signée par la mauvaise clé.
- **PWA en mode « prompt »** : la nouvelle version attend le clic sur « Recharger », et toute la coquille est
  précachée.
- **Updater avec sa propre paire de clés**, la clé privée en secret de dépôt. Les archives signées ne sont produites
  qu'en Release (`tauri.release.conf.json`). Un build local n'a donc pas besoin de la clé.

## 3. Installer, tester, lancer

Séquence vérifiée le 23/10/2026 sur un clone neuf de `main` (f633a6b) : tout passe sans contournement.

### Prérequis (une seule fois)

| Outil | Version | Remarque |
|---|---|---|
| Xcode ou ses Command Line Tools | récent | `xcode-select --install`. Nécessaire à Rust et à Tauri. |
| Node | 24, comme la CI (`engines` : 22 ou plus) | Installateur de nodejs.org ou gestionnaire de versions. Node 25 et suivants ne livrent plus Corepack, d'où le choix de Node 24. |
| pnpm | 12.5.1, fixé par `packageManager` | Fourni par Corepack, voir ci-dessous. Ignorer l'annonce « Update available » de pnpm. |
| Rust | stable (1.98.1 sur l'ancien Mac), avec `clippy` et `rustfmt` | Installer par rustup. |
| Homebrew | récent | Installateur de <https://brew.sh> ; il indique la ligne à ajouter à `~/.zprofile`. |
| gh | récent | `brew install gh`, puis `gh auth login --scopes workflow` et `gh auth setup-git`. Sans la portée `workflow`, GitHub refuse tout push qui modifie `.github/workflows/`. |

```bash
xcode-select --install
```

```bash
mkdir -p ~/.local/bin && corepack enable --install-directory ~/.local/bin pnpm
```

Avec l'installateur de nodejs.org, `/usr/local/bin` appartient à root : `corepack enable` sans `--install-directory`
échoue. Mets ensuite `~/.local/bin`
dans le PATH de ton shell. Ajoute aussi `~/.cargo/bin` et `/opt/homebrew/bin` : le shell des commandes de Claude Code
ne les voit pas toujours. La ligne utilisée sur l'ancien Mac :

```bash
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
```

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

```bash
rustup component add clippy rustfmt
```

`rustup target add aarch64-apple-darwin x86_64-apple-darwin` ne sert que pour construire soi-même le `.dmg`
universel. La Release s'en charge en CI.

**Identité Git** :
- Avant le premier commit : `git config --global user.name Aiebou`, puis, dans le dépôt,
  `git config user.email <adresse noreply>` (GitHub → Settings → Emails). Sur l'ancien Mac, l'adresse « noreply »
  était réglée dans `.git/config` du dépôt, et `~/.gitconfig` portait une autre adresse.
- **Les commits de fusion** faits par `gh pr merge` sont écrits par GitHub avec l'adresse principale du compte : les
  fusions des PR #1 à #15 portent déjà l'adresse personnelle. Pour l'éviter à l'avenir, cocher GitHub → Settings →
  Emails → « Keep my email addresses private ». Réécrire l'historique de `main` serait ta décision.

### Cloner et vérifier

```bash
git clone https://github.com/Aiebou/Cashmyr.git "$HOME/Desktop/Application gestion de finance personnelle"
```

```bash
cd "$HOME/Desktop/Application gestion de finance personnelle"
```

Ce chemin garde le nom du dossier de mémoire de Claude Code (§5) ; un `git clone` sans destination crée `Cashmyr/`.

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm test:rust
```

À noter :
- Au premier appel de `pnpm`, Corepack télécharge la 12.5.1 et peut demander confirmation. `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`
  supprime la question ; sans terminal, comme dans le shell de Claude Code, elle n'est pas posée.
- `pnpm test` couvre core, storage et ui ; les apps n'ont pas de tests.
- `pnpm test:rust` vaut `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.

La CI passe en plus `cargo fmt` et `clippy`, depuis `apps/desktop/src-tauri`. À lancer avant de pousser du Rust :

```bash
(cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test)
```

Ce qui a été mesuré sur le clone neuf :

| Commande | Durée | Résultat |
|---|---|---|
| `pnpm typecheck` | 5 s | core, storage, ui, web, desktop |
| `pnpm test` | 11 s | core 227, storage 97, ui 128 (core en compte 228 depuis la décision 68) |
| `pnpm build:web` | 3 s | `apps/web/dist`, 13 entrées précachées |
| `cargo clippy --all-targets -- -D warnings` | 44 s | 0 avertissement |
| `cargo test` | 41 s | 15 tests |

Ces durées valent avec des caches déjà remplis. Sur un Mac neuf, prévois en plus :
- le téléchargement de 429 paquets npm et d'environ 520 crates ;
- deux compilations Rust complètes ;
- environ 2,6 Go de `target/`.

`cargo clippy` et `cargo test` n'ont pas besoin du frontend construit : `apps/desktop/dist` n'est requis que par
`tauri build`, qui le crée lui-même.

### Lancer

```bash
pnpm dev:web
```

- La PWA s'ouvre sur <http://localhost:5173/>, avec la base `/` en dev.
- Le port est fixe (`strictPort`) : s'il est pris, le serveur s'arrête.
- En dev, ni service worker ni CSP.

```bash
pnpm dev:desktop
```

- Fenêtre Tauri, Vite sur le port 1420. La première fois, toute la partie Rust se compile.
- **Attention** : le mode dev a le même identifiant que l'application installée. Il lit et écrit donc tes vraies
  données dans `~/Library/Application Support/io.github.aiebou.cashmyr/`.
- Quitte Cashmyr installé avant de lancer le mode dev : l'instance unique ramènerait l'autre fenêtre.
- Pour un essai isolé, voir [§7, « Tauri et bureau »](#tauri-et-bureau).

Pour essayer la PWA construite (service worker, hors ligne, bandeau « Nouvelle version disponible ») :

```bash
pnpm build:web && pnpm --filter @cashmyr/web preview --port 4173 --strictPort
```

Elle s'ouvre sur <http://localhost:4173/Cashmyr/>, avec la barre finale : `/Cashmyr` sans elle donne une 404.

Pour construire l'application de bureau en local :

```bash
pnpm build:desktop
```

Ce build produit un `.app` et un `.dmg` dans `apps/desktop/src-tauri/target/release/bundle/`. **Ne laisse pas ce
`Cashmyr.app` en place** (voir §7). Pour seulement vérifier que tout compile, `pnpm --filter @cashmyr/desktop tauri
build --no-bundle` ne crée pas de bundle.

### Aperçu dans Claude Code

`.claude/launch.json` est ignoré par Git, car il contient le chemin de `pnpm` propre à la machine. Recrée-le :

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "web", "runtimeExecutable": "<sortie de command -v pnpm>", "runtimeArgs": ["--dir", "apps/web", "dev"], "port": 5173 },
    { "name": "web-build", "runtimeExecutable": "<sortie de command -v pnpm>", "runtimeArgs": ["--dir", "apps/web", "preview", "--port", "4173", "--strictPort"], "port": 4173 }
  ]
}
```

`web-build` sert le dernier `apps/web/dist` : lance `pnpm build:web` avant, puis ouvre `/Cashmyr/`.

## 4. Publier une version

**CI** (`ci.yml`) : à chaque PR et à chaque push sur `main`, deux jobs.
- « Types et tests », sur Ubuntu : `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`.
- « Enveloppe Tauri », sur macOS : `cargo fmt --check`, `clippy -D warnings`, `cargo test`.

**PWA** (`deploy-pages.yml`) : chaque push sur `main`, donc chaque fusion, repasse les types et les tests,
construit `apps/web` et publie sur Pages. Une fusion est donc une mise en ligne.

**Bureau** (`release.yml`) : seulement au push d'un tag `v*`.
1. Le job `prepare` vérifie que le tag concorde avec la version de `apps/desktop/package.json`, de `apps/web/package.json`
   et de `apps/desktop/src-tauri/Cargo.toml`. Il repasse les tests, puis crée le brouillon de Release avec le texte
   de `.github/release-notes.md`.
2. La matrice construit macOS universel, Windows et Linux par `tauri-action`, en signant avec les secrets
   `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Le job `publish` contrôle `latest.json` avec `check-latest.mjs`, puis publie.

Procédure suivie pour chaque version :

1. Sur la branche de la dernière PR de la version :
   - mettre le numéro dans `apps/web/package.json`, `apps/desktop/package.json` et
     `apps/desktop/src-tauri/Cargo.toml` (`tauri.conf.json` lit `../package.json`) ;
   - mettre à jour `Cargo.lock` avec `cargo update -p cashmyr --offline --manifest-path apps/desktop/src-tauri/Cargo.toml` (`--offline` suppose le
     cache Cargo rempli, par exemple après `pnpm test:rust`) ;
   - réécrire la section « Nouveautés de la X.Y.Z » de `.github/release-notes.md` ;
   - laisser `packages/*` en 0.1.0 : ces paquets ne sont pas versionnés.
2. Attendre la CI verte et la validation de l'interface par l'utilisateur. Fusionner ensuite en commit de fusion :
   `gh pr merge N --merge --match-head-commit <sha complet>`.
3. Revenir sur `main` à jour (`git switch main && git pull --ff-only`), puis poser et pousser le tag annoté sur le
   commit de fusion, après confirmation :
   `git tag -a vX.Y.Z -m "Cashmyr X.Y.Z" <sha>` puis `git push origin vX.Y.Z`.
4. Suivre `deploy-pages.yml` et `release.yml` : `gh run list --workflow release.yml -L 1` donne l'identifiant, puis
   `gh run watch <id> --exit-status`.
5. Une fois la Release publiée, vérifier `latest.json` : 13 entrées sur les dernières versions, toutes signées par
   `EFBCA89EB0CD97C`.
   - Télécharger le fichier : `gh release download vX.Y.Z -p latest.json -D <dossier temporaire>`.
   - Puis le contrôler :
     `node .github/scripts/check-latest.mjs <dossier>/latest.json apps/desktop/src-tauri/tauri.conf.json X.Y.Z`.

Une PR qui change le format des données se fusionne **juste avant le tag**. Sinon la PWA, publiée à la fusion,
écrirait un fichier que les applications de bureau restées à la version précédente refuseraient.

## 5. Fichiers présents uniquement sur l'ancien Mac

Inventaire du 23/10/2026. Il relève des noms, des tailles et des dates. Seul le début de la transcription a été
relu, pour en tirer le cahier des charges ; aucun autre contenu n'a été ouvert. Il couvre ce qui est ignoré par Git
ou hors du dépôt, et qu'un clone ne ramène pas. Les sorties de build (`node_modules`, `target`, `dist`), les fichiers
générés (`src-tauri/gen/`, `src-tauri/permissions/`) et les `.DS_Store` sont exclus.

### À transférer ou à vérifier

| Emplacement | Ce que c'est | Existe ailleurs ? | Que faire |
|---|---|---|---|
| `~/.tauri/cashmyr.key` | Clé privée de l'updater (identifiant `EFBCA89EB0CD97C`), protégée par un mot de passe | Dans le secret `TAURI_SIGNING_PRIVATE_KEY`, mais GitHub ne permet pas de relire un secret | **Copier de façon chiffrée** (gestionnaire de mots de passe, AirDrop), puis `chmod 600`. Jamais dans le dépôt. Sans elle, si le secret devait être recréé, plus aucune mise à jour ne serait acceptée par les applications installées. |
| Mot de passe de cette clé | Il n'est pas sur le disque, à ma connaissance | Dans le secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, non relisible | S'assurer de l'avoir noté là où tu ranges tes mots de passe |
| `~/.tauri/cashmyr.key.pub` | Clé publique | Déjà dans `tauri.conf.json` (`pubkey`) | La copier avec la clé privée |
| `<dépôt>/mes-finances.json` et `<dépôt>/mes-finances.csv` | Exports de l'ancienne application, source de la reprise de l'étape 5 | Non | Copier de façon sûre s'ils servent encore, **hors du dépôt** : à l'intérieur, un `git add -f` suffirait à les publier |
| `<dépôt>/cashmyr-sauvegarde-2026-09-24.json` | Sauvegarde exportée par Cashmyr | Non | Copier de façon sûre si besoin |
| `~/Library/Application Support/io.github.aiebou.cashmyr/` | Données de l'application de bureau : `data.json`, `backups/`, `profils.json`, `profils/`, `device.json`, `sync-target.txt` | En partie : le fichier de synchronisation contient ce qui a été synchronisé | **Avant de partir**, ouvrir Cashmyr et laisser la synchronisation passer. Ne pas copier `device.json` ni `sync-target.txt`, propres à l'appareil (identifiant, chemin absolu). Sur le nouveau Mac : installer Cashmyr, puis « Rejoindre mon fichier de synchronisation ». |
| `finances-sync.json`, dans le dossier cloud choisi | Fichier de synchronisation | Oui, dans le cloud | Rien à copier : il arrive avec le même compte. Vérifier qu'il est téléchargé avant de le rejoindre. |
| Chrome, dans le profil où la PWA a été ouverte : `IndexedDB/https_aiebou.github.io_0.indexeddb.leveldb` | Données de la PWA publiée, ouverte dans Chrome | Non : Chrome ne synchronise pas IndexedDB | Si ce navigateur tient des données hors synchronisation : l'ouvrir et synchroniser, ou exporter une sauvegarde. Ne pas copier le dossier. |
| Même profil Chrome : `IndexedDB/http_localhost_5173.indexeddb.leveldb` | Données de la PWA en développement | Non | Données d'essai : à ignorer, sauf si elles comptent |
| Safari | Stockage éventuel de la PWA, invérifiable (dossiers aux noms hachés) | Inconnu | Si tu as utilisé la PWA dans Safari, même démarche que pour Chrome |
| `~/.claude/projects/-Users-aiebou-Desktop-Application-gestion-de-finance-personnelle/memory/` | Mémoire de Claude Code pour ce projet (ses notes et leur index `MEMORY.md`) | Non | L'essentiel est repris dans `CLAUDE.md` et ce document. Pour la garder telle quelle, la copier dans `~/.claude/projects/<chemin absolu du nouveau clone, chaque caractère autre qu'une lettre ou un chiffre remplacé par « - »>/memory/`. Cloner au même chemin garde le même nom de dossier. |
| La transcription de la session (fichier `.jsonl` du dossier du projet sous `~/.claude/projects/`, et `~/.claude/file-history/`) | Transcription de la session de développement (environ 56 Mo) | Non | Le cahier des charges qu'elle contenait est maintenant dans `docs/cahier-des-charges.md`. Copie facultative, pour garder l'historique de la session. Elle peut contenir des extraits de données réelles : ne jamais la publier, ne l'ouvrir que sur demande explicite. |
| Note sur le projet dans le coffre Obsidian (iCloud Drive, dossier `CASHMYR`) | Notes personnelles | Oui, iCloud Drive | Rien à copier ; ne pas la verser dans le dépôt sans la relire |

### À recréer, sans copier

| Emplacement | Ce que c'est | Que faire |
|---|---|---|
| `.claude/launch.json` (dans le dépôt, ignoré) | Configurations d'aperçu `web` et `web-build` | Le recréer (§3) |
| Fichiers du shell (`~/.zshrc`…) | PATH | Remettre la ligne PATH du §3. Ne pas copier le fichier tel quel : n'y reprendre que cette ligne. |
| `~/.gitconfig` et `.git/config` local | `user.name`, `user.email` | `git config` (§3) |
| `~/.config/gh/`, trousseau macOS | Connexion de `gh` et identifiants Git | `gh auth login`, puis `gh auth setup-git`. Le jeton doit avoir *Contents*, *Workflows* et *Pull requests* en écriture. |
| `~/.local/bin/pnpm`, `~/.cargo`, `~/.rustup`, `/opt/homebrew/bin/gh`, `/usr/local/bin/node` | Outils | Réinstaller (§3) |
| `/Applications/Cashmyr.app` (0.5.0) | Application installée | La retélécharger depuis la Release |
| `~/Library/WebKit/io.github.aiebou.cashmyr/`, `~/Library/Caches/io.github.aiebou.cashmyr/`, `~/Library/Preferences/io.github.aiebou.cashmyr.plist` | WebView, cache, préférences macOS | Recréés tout seuls |

Rien d'autre n'a été trouvé : aucun `.env`, `.pem`, `.p12` ni autre clé liée au projet, aucun autre clone, aucun
export Cashmyr dans `~/Documents`, `~/Downloads` ou iCloud Drive, aucun hook Git.

## 6. Ce qui reste à faire, dans l'ordre

### Avant de quitter l'ancien Mac

1. Ouvrir Cashmyr (bureau) et attendre que la synchronisation passe : plus aucune modification en attente. Par
   sécurité, exporter aussi une sauvegarde (Paramètres → Sauvegardes), à ranger hors du dépôt dans un endroit
   chiffré. Si la PWA a servi dans Chrome ou Safari, faire de même dans le navigateur.
2. Copier de façon chiffrée `~/.tauri/cashmyr.key` et `cashmyr.key.pub`. Vérifier que le mot de passe de la clé est
   bien noté.
3. Copier les fichiers de données qui servent encore : `mes-finances.json`, `mes-finances.csv` et
   `cashmyr-sauvegarde-2026-09-24.json`.
4. Copier le dossier `memory/` de Claude Code et, si tu veux garder l'historique, la transcription de la session.

### Sur le nouveau Mac

1. Installer les outils, cloner, `pnpm install`, puis lancer les vérifications du §3.
2. Remettre l'identité Git, reconnecter `gh` (`gh auth login --scopes workflow`, `gh auth setup-git`) et recréer
   `.claude/launch.json`.
3. Si tu as copié la mémoire de Claude Code, la placer sous le nouveau chemin.
4. Installer Cashmyr 0.5.0 depuis la Release. Au premier lancement, l'application non signée s'ouvre par Réglages
   Système → Confidentialité et sécurité → « Ouvrir quand même » (voir le README). Ensuite, rejoindre le fichier de
   synchronisation depuis le dossier cloud.

### Suite du développement

Restent, du plus pressé au moins pressé :

1. **La liste du 25/10/2026**, dont toutes les règles ont été validées ce jour-là (décisions à inscrire au §8 à
   partir de la 69, chacune dans la PR qui l'applique). Découpage convenu :
   - 0.5.0, sans changement de format, publiée : Mes comptes, « Catégories » et bouton « Haut de page » sur
     téléphone, le DTI (onglet Dettes et indicateurs de l'année), le menu latéral du grand écran ;
   - 0.6.0, format 3, PR empilées et fusionnées juste avant le tag : budgets et types modulables (modèle, calculs,
     migration, nouvelles catégories par défaut appliquées aussi aux profils existants), leur interface, puis les
     comptes rattachés aux types, avec les parts réservées et la précaution.
2. **Essayer dans une vraie fenêtre de bureau ce qui n'a été vérifié que par les tests** : le parcours des profils
   (créer, changer, supprimer, rejoindre un fichier depuis un profil), puis l'écran de secours, vu seulement dans la
   PWA. Faire ces essais avec la recette d'essai isolé du §7, jamais sur les vraies données.
3. **Vérifier sur un vrai iPhone** ce que fait « Enregistrer dans Fichiers » face à un fichier de même nom. C'est
   encore au futur dans `architecture.md` (§6, iOS) ; le README n'en donne qu'une mise en garde générale.
4. **« Compte professionnel » ou « profil professionnel »** : reporté le 26/09/2026, à rediscuter. Toute piste qui
   touche aux calculs ou au format passe d'abord par des questions chiffrées.

## 7. Pièges rencontrés

### Clé, Release et updater

- **Mauvais mot de passe de clé** : « Wrong password for that key » à la fin de `tauri build`, après 10 à 14 minutes.
  - Pour la 0.1.0, le secret du mot de passe ne contenait pas le bon.
  - Avant de mettre un secret à jour, l'utilisateur teste lui-même la clé en local avec
    `pnpm --filter @cashmyr/desktop tauri signer sign`, en lisant le mot de passe par `read -rs` (jamais Claude).
  - Mettre les deux secrets à jour ensemble, puis « Re-run failed jobs ».
- **Mauvaise clé avec le bon mot de passe** : la Release se construit, mais les applications installées refusent la
  mise à jour, sans aucun signal. C'est ce que bloque `check-latest.mjs` : ne pas le retirer.
- **Une relance reprend le brouillon existant**, avec le texte de `release-notes.md` lu à sa création. Réécrire les
  notes avant de poser le tag.
- **`--match-head-commit`** refuse un SHA abrégé : passer `$(git rev-parse <sha>)`.
- **PR empilées** : après la fusion de la PR parente, `gh pr edit N --base main`, et vérifier que la tête n'a pas
  changé depuis la CI verte.
- **Les installateurs Windows ne se construisent pas sur macOS** : leur premier vrai test, c'est le tag. Le `.msi`
  s'appelle `…_x64_fr-FR.msi`, et `windows/fr-FR.wxl` traduit les quatre textes propres à Tauri.
- **Un build local fait avec une clé d'essai** donne un binaire qui refuse les vraies mises à jour. Après tout essai
  de clé, supprimer les sorties de build.

### Tauri et bureau

- **Un `Cashmyr.app` laissé dans `src-tauri/target/…/bundle`** est proposé par Spotlight et capte les lancements, à
  cause de l'instance unique. L'utilisateur ne voyait plus la mise à jour de l'application installée. Supprimer tout
  bundle local après un essai.
- **Le mode dev partage les données de l'application installée** (même identifiant). Pour un essai isolé :
  - construire avec un autre `identifier` via `--config` ;
  - lancer le binaire avec `HOME=<dossier temporaire>` ;
  - supprimer ensuite `~/Library/WebKit/<id>` et `~/Library/Caches/<id>`, que la WebView crée dans le vrai
    `~/Library`.
- **`plugin-store` réenregistre ses stores à la fermeture.** Avant de supprimer un profil, `profile_remove` ferme son
  `device.json`, sinon il serait recréé en quittant.
- **Portée de `plugin-fs`** : elle est limitée à `$APPDATA`, avec un `deny` sur `sync-target.txt` et
  `profils/*/sync-target.txt`. Elle n'a été éprouvée que pour des sous-dossiers (`backups/`, `mis-de-cote/`). Tout
  ce qui touche au fichier choisi passe par des commandes Rust, y compris l'écriture atomique.
- **Compilation** :
  - `serde_json` doit être une dépendance normale, sinon `generate_context!` ne compile pas dès qu'un plugin a une
    configuration ;
  - crates.io annonce Tauri 3 en alpha : rester en `"2"`, aligné sur les paquets `@tauri-apps/*`.
- **Réglages qui doivent rester** :
  - `CFBundleDevelopmentRegion` à `fr` dans `Info.plist`, pour des dialogues natifs en français ;
  - `dragDropEnabled: false`, pour que le glisser-déposer HTML marche sous Windows.
- **Contrôle de l'application par Claude Code** :
  - les clics en arrière-plan n'atteignent pas la WebView ;
  - le dialogue d'enregistrement n'autorise que Documents et Bureau ;
  - la capture d'écran a été refusée par l'utilisateur.

### Environnement

- **`pnpm` introuvable dans les scripts racine** (`sh: pnpm: command not found`) : les scripts rappellent `pnpm`
  dans un sous-shell. appeler pnpm par son chemin complet ne suffit pas, `~/.local/bin` doit être dans le PATH.
- **Le Python de python.org n'a pas de certificats racine** : `urllib` échoue. Passer par `curl` ou `gh`.
- **macOS n'a pas `timeout`**, et son `sed` est celui de BSD : `sed -i ''`.
- **zsh** :
  - mettre les globs entre guillemets (`--include='*.ts'`) ;
  - `echo ===` échoue : zsh lit `=mot` comme une commande ;
  - zsh ne découpe pas `$var` en mots, ce qui avait cassé un script de surveillance des Releases : écrire `${=var}`
    ou passer par un tableau ;
  - la saisie masquée s'écrit `read -rs "?invite"`.

### Vite, PWA, aperçu

- **Vite garde en cache un import introuvable.** Un fichier importé avant d'exister donne une erreur 500, même une
  fois créé : redémarrer le serveur de dev.
- **`vite preview`** tourne en `command: "serve"`. La base `/Cashmyr/` est donc conditionnée à
  `command === "build" || isPreview`.
- **Le service worker et la CSP n'existent qu'au build** : pour tester le hors-ligne, utiliser la configuration
  `web-build`.
- **IndexedDB est propre à chaque origine et à chaque navigateur.** Le navigateur de l'aperçu repart parfois vide :
  réinjecter un jeu de données fictif, jamais tes données.

### Tests

- **Le tutoriel s'ouvre sur tout appareil neuf** et masque les écrans. Les aides de test créent l'appareil sans
  `tour` ; passer `tour: []` pour tester le tutoriel lui-même.
- **jsdom** :
  - un import CSS `?raw` renvoie `''` ;
  - `import.meta.url` n'est pas une URL de fichier ;
  - le style calculé n'est pas fiable : vérifier `[hidden]` dans un vrai navigateur.
- **Formats français** : Intl écrit une espace fine insécable (U+202F) entre les milliers et une espace insécable
  (U+00A0) avant « € » ; l'interface écrit le signe moins U+2212. Les normaliser dans les expressions régulières des
  tests.
- **Requêtes ambiguës** (plusieurs `alert`, plusieurs `role="banner"`, plusieurs toasts) : utiliser `within(…)` ou
  `getAllByRole(…)[0]`. `cleanup()` ne démonte pas les écrans de `startApp` : `document.body.replaceChildren()` dans
  `afterEach`.
- **Jamais de vraies données dans les fixtures.** Éprouver la reprise sur le vrai fichier seulement à la demande de
  l'utilisateur, avec une sonde temporaire jamais ajoutée à Git, qui n'affiche ni montant ni nom, supprimée aussitôt.
- **Délai de 5 s** : sur le Mac mini (Node 26), trois tests de `ui` (tutoriel, tags) dépassent ce délai quand toute la
  suite tourne, sur `main` comme sur une branche. Ils passent seuls et en CI.
- **Un format « plus récent »** s'écrit `SCHEMA_VERSION + 1` dans les tests, jamais en dur.

### CSS et textes

- **`backdrop-filter` change le bloc de référence** des descendants en `position: fixed`. Le flou de l'en-tête a
  ainsi décalé le menu du profil. Solution retenue : `width: max-content; max-width: calc(100vw - 32px)`.
- **`display: grid` l'emporte sur l'attribut `hidden`** : la règle globale `[hidden] { display: none !important }`
  est indispensable.
- **Écrans étroits (300 à 400 px)** : sous 400 px, « Ajouter » passe en icône seule. Tester aussi la fenêtre du
  bureau.
- **Pas d'italique** : aucune police italique n'est embarquée, et le navigateur en fabriquerait une. Utiliser une
  graisse ou une couleur plus légère.
- **Couleurs des graphiques** : cinq parts au plus, dont « Autres » hachuré. Faire passer toute nouvelle palette à un
  validateur de couleurs (daltonisme, contraste, en clair et en sombre) ; celui utilisé est un outil de Claude Code,
  pas un script du dépôt.
- **Textes** :
  - l'interface tutoie partout ;
  - virgule décimale partout ;
  - élision (« d'octobre ») et « 1er » ;
  - un espace placé hors du `<span>` (`{" "}`) garde le nom accessible lisible ;
  - BOM UTF-8 en tête du CSV, pour Excel.
- **macOS ignore la casse** : le motif `Icon?` du `.gitignore` excluait aussi `icons/`. Il a été remplacé par le nom
  exact.

### Façon de travailler, à garder

- Ne jamais trancher seul une règle de calcul financier ou de fusion. Poser la question avec un exemple chiffré :
  les questions abstraites ont donné des réponses qu'il a fallu faire préciser.
- Signaler toute demande qui contredit une décision validée avant de trancher. Inscrire chaque décision au §8
  d'`architecture.md` dans la PR qui l'applique.
- Une modification, une branche depuis `main`, une PR (pas en brouillon). Fusion en commit de fusion, une fois la CI
  verte et l'interface validée par l'utilisateur. Les branches distantes sont gardées.
- Jamais d'auto-merge sans demande. Toujours confirmer avant de pousser un tag ou de forcer un push.
