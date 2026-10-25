# Cashmyr

Application de budget personnel hors ligne : une PWA sur GitHub Pages (<https://aiebou.github.io/Cashmyr/>) et une
application de bureau Tauri v2, distribuée par les GitHub Releases. Un seul code ; la synchronisation passe par un
fichier, `finances-sync.json`, dans le dossier cloud de chacun. Le dépôt `Aiebou/Cashmyr` est **public**.

À lire avant de toucher au code :
- [`docs/architecture.md`](docs/architecture.md) : modèle de données, fusion, stockage par plateforme, profils (§9),
  et les décisions numérotées du §8, qui font foi.
- [`docs/cahier-des-charges.md`](docs/cahier-des-charges.md) : le cahier des charges d'origine (23/09/2026). Les
  décisions du §8 priment.
- [`docs/passation.md`](docs/passation.md) : avancement, installation sur un nouveau Mac, procédure de Release,
  fichiers hors dépôt, ce qui reste à faire et les pièges rencontrés.

## Règles non négociables (mots de l'utilisateur)

- « Aucune donnée personnelle ne doit jamais être commitée. » Les fixtures sont synthétiques. Les vrais fichiers ne
  s'ouvrent jamais sans demande explicite de l'utilisateur : `mes-finances*.json`/`.csv`, `cashmyr-*.json`/`.csv`,
  `finances-sync*.json`, tout `~/Library/Application Support/io.github.aiebou.cashmyr/`, les transcriptions de
  Claude Code. Jamais de montant ni de nom tiré des données de l'utilisateur, pas même dans une réponse.
- « Aucun appel réseau au runtime. L'application doit fonctionner entièrement hors ligne, avion activé, au premier
  lancement comme au centième. » Seules exceptions acceptées : la recherche de mise à jour du bureau (décision 46)
  et la vérification de nouvelle version par le service worker de la PWA.
- « Pose-moi une question dès qu'une règle métier est ambiguë. Ne devine jamais sur un calcul financier ni sur une
  règle de fusion. » Poser la question avec un exemple chiffré (« juin 3 000, juillet vide, août 2 000 → 2 500 ou
  1 667 ? ») : les questions abstraites ont donné des réponses qu'il a fallu faire préciser.
- « Si une de ces demandes contredit un choix que nous avions validé ensemble, signale-le-moi avant de trancher. »
- « Aucun serveur, aucun compte utilisateur, aucune donnée chez moi. »
- « Écriture atomique obligatoire : écrire dans un fichier temporaire à côté, puis renommer. »
- « La génération doit être strictement idempotente. » « Jamais de génération pour un mois futur. »
- « Fais échouer l'import bruyamment plutôt que d'accepter une conversion partielle. »
- « N'invente pas de capacité qui n'existe pas, et ne promets rien dans l'interface que la plateforme ne tienne pas. »
- « Polices embarquées en woff2 dans le dépôt, jamais chargées depuis Google Fonts. »
- « Active l'updater Tauri avec sa propre paire de clés, la clé privée en secret de dépôt. »
- « Les binaires ne seront pas signés par une autorité. » « N'essaie pas de contourner ces mécanismes. » La
  signature ad hoc reste.

## Conventions du code

- Monorepo pnpm, sens des dépendances : `packages/core` ← `packages/storage` ← `packages/ui` ← `apps/web`,
  `apps/desktop`.
  - `core` est pur : ni React, ni stockage, ni `Date.now()` implicite.
  - `ui` ne détecte jamais la plateforme : un écran lit une capacité de `platform`. Pas de `if (isTauri)`.
- Montants en centimes entiers (`Cents`), jamais de flottant stocké. L'affichage passe par `Intl` fr-FR, au centime
  partout, avec la virgule décimale.
- Fusion LWW ligne à ligne, sur `updatedAt`, avec pierres tombales. Les données passent toujours par `Repository`, et
  une violation d'invariant bloque l'écriture.
- Tout nouveau champ synchronisé change le format des données (validation stricte). Il faut alors une version de
  schéma et sa migration, une version de la base IndexedDB si un magasin s'ajoute, une décision validée avant le
  code, et une fusion juste avant le tag.
- Une règle tranchée s'inscrit comme décision numérotée au §8 d'`architecture.md`, dans la PR qui l'applique. La
  dernière est la 70.
- Interface en français, **au tutoiement**. Typographie française : élisions, « 1er », espaces insécables.
- Pas d'italique : aucune police italique n'est embarquée.

## Commandes

Le shell des commandes ne voit pas toujours les outils. Lancer d'abord :

```bash
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
```

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test              # core, storage, ui (Vitest)
pnpm test:rust         # tests de l'enveloppe Tauri
pnpm dev:web           # http://localhost:5173
pnpm dev:desktop       # vraies données de l'utilisateur : voir « Sécurité et pièges »
pnpm build:web
```

Avant de pousser du Rust, faire comme la CI :

```bash
(cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test)
```

`.claude/launch.json` est ignoré par Git. Il définit les aperçus `web` (port 5173) et `web-build` (port 4173, base
`/Cashmyr/`). Sa forme est dans `docs/passation.md` §3.

## Git, PR et Release

L'utilisateur autorise Claude à créer et à fusionner les PR avec `gh`, et à lire les journaux des workflows.

Pour une PR :
1. Une branche depuis `main`, puis `gh pr create --base main`, jamais en brouillon.
2. Suivre la CI.
3. Fusionner seulement une fois la CI verte **et** l'interface validée par l'utilisateur, en commit de fusion :
   `gh pr merge N --merge --match-head-commit <sha complet>`.
4. Garder les branches distantes. Revenir ensuite sur `main` : `git switch main && git pull --ff-only`.

Interdits sans demande ou confirmation :
- Jamais d'auto-merge sans demande.
- Toujours confirmer avant de pousser un tag ou de forcer un push.

Pour une Release, la procédure complète est au §4 de `docs/passation.md` :
- le numéro de version vit dans `apps/web/package.json`, `apps/desktop/package.json`,
  `apps/desktop/src-tauri/Cargo.toml` et `Cargo.lock` ;
- les notes sont dans `.github/release-notes.md` ;
- ensuite, un tag annoté `vX.Y.Z` sur le commit de fusion, puis le contrôle de `latest.json` avec
  `.github/scripts/check-latest.mjs`, clé `EFBCA89EB0CD97C`.

Une PR qui change le format des données se fusionne juste avant le tag. Chaque fusion sur `main` publie la PWA.

## Sécurité et pièges

- Ne jamais lire le contenu de `~/.tauri/`, des fichiers du shell (`~/.zshrc`…), de `~/.config/gh/`, du trousseau
  ni des profils de navigateur ; ne jamais afficher `git config --global user.email`.
  Ne jamais taper un mot de passe ou une clé, ne jamais afficher un secret.
- Ne pas laisser de `Cashmyr.app` construit dans `apps/desktop/src-tauri/target/…/bundle` : Spotlight le propose et,
  à cause de l'instance unique, il capte les lancements de l'application installée.
- Vite garde en cache un import introuvable : redémarrer le serveur de dev après avoir créé le fichier.
- Les aides de test créent un appareil sans tutoriel. Passer `tour: []` pour tester le tutoriel.
- Avant le premier commit d'un clone, vérifier sans l'afficher que `git config --local user.email` se termine par
  `@users.noreply.github.com`. Sinon, s'arrêter et demander à l'utilisateur de la régler (dépôt public).
- Ne pas lancer `pnpm dev:desktop`, `pnpm build:desktop` ni un binaire construit sans prévenir : ils ouvrent les
  vraies données. Pour un essai, suivre la recette isolée de `docs/passation.md` §7.
- Points ambigus : les lister numérotés, chacun avec une proposition ; l'utilisateur ne répond qu'aux numéros qu'il
  change, le reste vaut validation. Ne pas reposer une question déjà tranchée au §8.
- Les autres pièges sont dans `docs/passation.md` §7.
