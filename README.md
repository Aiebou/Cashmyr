# Cashmyr

Budget personnel hors ligne. Tu saisis tes revenus, tes dépenses et tes transferts ; Cashmyr en déduit tes
revenus, ta répartition besoins / envies / mise de côté, le solde de tes comptes, l'avancement de tes objectifs
et de tes dettes. Pas de compte, pas de serveur : tes données restent sur tes appareils, et tu les relies par un
fichier posé dans ton propre cloud.

## Installer

**Version web** : <https://aiebou.github.io/Cashmyr/>. Ouvre-la une première fois avec une connexion : elle
s'enregistre sur l'appareil et fonctionne ensuite hors ligne. Pour l'installer comme une application :

- Chrome ou Edge sur ordinateur : icône d'installation dans la barre d'adresse ;
- Chrome sur Android : menu ⋮ → « Installer l'application » (ou « Ajouter à l'écran d'accueil ») ;
- Safari sur iPhone ou iPad : Partager → « Sur l'écran d'accueil ».

**Application de bureau** : dans la [dernière Release](https://github.com/Aiebou/Cashmyr/releases/latest),
le `.dmg` universel pour macOS 12 ou plus récent, le `-setup.exe` pour Windows, l'`.AppImage`, le `.deb` ou le
`.rpm` pour Linux. Les versions suivantes sont proposées au lancement (Paramètres → Application permet de le
désactiver) et par « Rechercher une mise à jour » ; elles ne s'installent que sur ton clic.

### Installer l'application de bureau

Les binaires ne sont pas signés par une autorité de certification. Au premier lancement, Windows affiche
l'avertissement SmartScreen : clique sur « Informations complémentaires », puis « Exécuter quand même » ; sur macOS,
fais un clic droit sur Cashmyr puis « Ouvrir » (depuis macOS 15 : Réglages Système → Confidentialité et sécurité
→ « Ouvrir quand même »).

## Synchroniser tes appareils

Un seul fichier, `finances-sync.json`, dans un dossier que ton service synchronise (iCloud Drive, Google Drive,
Dropbox, OneDrive, Syncthing…). Crée-le depuis un premier appareil (Paramètres → Synchronisation), puis choisis-le
depuis les autres (« Rejoindre mon fichier de synchronisation » à l'accueil, ou « Choisir mon fichier » dans
Paramètres). À chaque fusion, la version la plus récente de chaque élément l'emporte.

| Plateforme | Ce qu'elle permet |
|---|---|
| Application de bureau (macOS, Windows, Linux) | Automatique : le fichier est choisi une fois ; Cashmyr le lit à l'ouverture et au retour sur la fenêtre, et y écrit deux secondes après chaque modification. |
| Chrome ou Edge sur ordinateur | Automatique, au même rythme. Le navigateur redemande parfois l'autorisation d'accéder au fichier : un bouton « Réautoriser » s'affiche. |
| Safari, Firefox, iPhone, Android | À la demande : « Synchroniser » ouvre le fichier et le fusionne avec l'appareil, puis « Enregistrer le fichier fusionné » le propose pour qu'il remplace l'original. Vérifie que c'est bien l'original qui est remplacé, et non une copie créée à côté : Cashmyr ne peut pas le vérifier. |

## Profils

Un même appareil peut porter plusieurs budgets : le tien, celui du foyer, celui d'un proche. Chaque profil a ses
comptes, ses opérations, ses réglages et son propre fichier de synchronisation ; rien ne passe d'un profil à l'autre.
Paramètres → Profils les crée, les renomme et les supprime. Dès qu'il y en a deux, Cashmyr demande à chaque lancement
qui l'utilise, et le nom du profil ouvert, en haut de l'écran, permet d'en changer.

- **Partager un profil**, celui du foyer par exemple : crée un profil sur chaque appareil concerné et fais-leur
  rejoindre le même fichier de synchronisation (`finances-sync-foyer.json`, par exemple).
- **Aucun verrou** : sur un appareil, chacun peut ouvrir tous les profils. Un budget privé reste sur ton propre appareil.
- **Supprimer un profil** ne le retire que de cet appareil : son fichier et les autres appareils ne changent pas.
- Tes données d'avant les profils forment le profil « Mon budget », que tu peux renommer.

## Où vivent tes données

- **Bureau** : `data.json` dans le dossier de l'application, avec ses cinq copies dans `backups/`. Les profils
  créés ensuite ont chacun leur dossier dans `profils/`.
  - macOS : `~/Library/Application Support/io.github.aiebou.cashmyr/`
  - Windows : `%APPDATA%\io.github.aiebou.cashmyr\`
  - Linux : `~/.local/share/io.github.aiebou.cashmyr/`
- **Version web** : dans le stockage du navigateur (IndexedDB, une base par profil), pour ce seul navigateur. Effacer les données du
  site les efface. Sur iPhone et iPad, utilise l'application ajoutée à l'écran d'accueil : elle a son propre
  stockage, séparé de Safari, que Safari n'efface pas après quelques jours sans visite.

Cashmyr n'envoie rien nulle part. Ses seuls accès au réseau : le navigateur qui regarde, à l'ouverture, si une
nouvelle version web existe (un bandeau propose alors de recharger), et, sur le bureau, la lecture de la dernière
version publiée, au lancement (désactivable) et par le bouton « Rechercher une mise à jour ». Hors ligne, Cashmyr
fonctionne de la même façon et ne signale rien.

## Sauvegarder

- **Copies automatiques** : une à chaque ouverture, les cinq dernières gardées sur l'appareil, restaurables
  depuis Paramètres → Sauvegardes.
- **Export** : Paramètres → Sauvegardes → « Exporter une sauvegarde (JSON) » écrit toutes tes données dans
  `cashmyr-sauvegarde-AAAA-MM-JJ.json`. « Importer un fichier » la fusionne avec l'appareil sans rien écraser de plus
  récent. Les opérations s'exportent aussi en CSV, pour un tableur.
- Le fichier de synchronisation contient lui aussi toutes tes données.
- Si les données de l'appareil sont abîmées, Cashmyr n'y touche pas et ouvre un écran de secours : repartir
  d'une copie automatique (ou de zéro s'il n'y en a aucune), la version abîmée étant gardée de côté.

L'export de l'ancienne application (`mes-finances.json`) se reprend par « Reprendre mes données » à l'accueil ou
« Importer un fichier » : chaque total est vérifié avant d'écrire, et au moindre doute rien n'est repris.

## Développer

Prérequis : Node 22 ou plus récent, pnpm (la version est fixée par `packageManager`) et, pour le bureau, Rust
stable avec les [prérequis de Tauri](https://tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm dev:web        # PWA sur http://localhost:5173
pnpm dev:desktop    # application de bureau
pnpm test           # tests TypeScript (core, storage, ui)
pnpm test:rust      # tests de l'enveloppe Tauri
pnpm typecheck
pnpm build:web      # apps/web/dist
pnpm build:desktop  # binaires de la plateforme en cours
```

L'architecture, le modèle de données et toutes les règles de calcul et de fusion sont décrits dans
[`docs/architecture.md`](docs/architecture.md).

**Publier.** Chaque push sur `main` passe les tests puis publie la PWA sur GitHub Pages. Pour une version de
bureau, mets le même numéro dans `apps/desktop/package.json`, `apps/web/package.json` et
`apps/desktop/src-tauri/Cargo.toml`, puis pousse le tag `vX.Y.Z` : le workflow construit les trois plateformes,
signe les paquets de l'updater avec la clé privée des secrets `TAURI_SIGNING_PRIVATE_KEY` et
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, et ne publie la Release qu'une fois chaque paquet présent et signé par
la clé publique de `tauri.conf.json`.

## Licence

[MIT](LICENSE). Polices Spectral et Archivo sous licence SIL Open Font License, embarquées dans
`packages/ui/src/theme/fonts/`.
