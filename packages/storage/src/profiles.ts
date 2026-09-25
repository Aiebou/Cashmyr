import { cleanName, nameKey } from "@cashmyr/core";

/** Identifiant du premier profil : les données d'avant les profils, restées à leur place (décision 55). */
export const PRINCIPAL = "principal";
export const FIRST_PROFILE_NAME = "Mon budget";
/** Fichier de synchronisation proposé au premier profil ; les autres y ajoutent leur nom. */
export const SYNC_FILE_NAME = "finances-sync.json";

export type ProfileEntry = {
  /** `principal` pour le premier profil, uuid v4 pour les suivants. */
  id: string;
  /** Non vide, unique sur l'appareil à la casse, aux accents et aux espaces près. */
  name: string;
  createdAt: number;
  /** `fileId` du fichier de synchronisation du profil, tenu à jour à chaque fusion (décision 57). */
  syncFileId: string | null;
};

/** Profils de l'appareil (§9), jamais synchronisés. */
export type ProfileRegistry = {
  version: 1;
  profiles: ProfileEntry[];
  /** Bureau : recherche d'une mise à jour au lancement, réglage de l'appareil (décisions 46 et 59). */
  checkUpdatesOnLaunch: boolean;
};

/** Où l'appareil garde son registre. `read` renvoie null s'il n'a jamais été écrit. */
export interface ProfileRegistryStore {
  read(): Promise<ProfileRegistry | null>;
  write(registry: ProfileRegistry): Promise<void>;
}

export class ProfileError extends Error {
  override name = "ProfileError";
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Seuls identifiants admis, ici comme côté Rust : ils deviennent des noms de dossier ou de base. */
export const isProfileId = (id: string): boolean => id === PRINCIPAL || UUID_V4.test(id);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function isEntry(v: unknown): v is ProfileEntry {
  return (
    isObj(v) &&
    typeof v.id === "string" &&
    isProfileId(v.id) &&
    typeof v.name === "string" &&
    cleanName(v.name) !== "" &&
    typeof v.createdAt === "number" &&
    (v.syncFileId === null || typeof v.syncFileId === "string")
  );
}

/** Registre relu tel qu'écrit ; tout écart le fait refuser plutôt que deviner les profils. */
export function parseProfileRegistry(value: unknown): ProfileRegistry {
  if (
    !isObj(value) ||
    value.version !== 1 ||
    !Array.isArray(value.profiles) ||
    value.profiles.length === 0 ||
    !value.profiles.every(isEntry) ||
    typeof value.checkUpdatesOnLaunch !== "boolean"
  ) {
    throw new ProfileError("Le registre des profils de cet appareil est illisible.");
  }
  const ids = new Set(value.profiles.map((p) => p.id));
  const names = new Set(value.profiles.map((p) => nameKey(p.name)));
  if (ids.size !== value.profiles.length || names.size !== value.profiles.length) {
    throw new ProfileError("Le registre des profils de cet appareil est illisible.");
  }
  return value as ProfileRegistry;
}

/** Registre d'un appareil qui ne l'a jamais écrit : un seul profil, « Mon budget » (décision 55). */
export function implicitRegistry(principal: { syncFileId: string | null; checkUpdatesOnLaunch: boolean }): ProfileRegistry {
  return {
    version: 1,
    profiles: [{ id: PRINCIPAL, name: FIRST_PROFILE_NAME, createdAt: 0, syncFileId: principal.syncFileId }],
    checkUpdatesOnLaunch: principal.checkUpdatesOnLaunch,
  };
}

function checkName(registry: ProfileRegistry, name: string, self: string | null): string {
  const clean = cleanName(name);
  if (clean === "") throw new ProfileError("Donne un nom au profil.");
  const other = registry.profiles.find((p) => p.id !== self && nameKey(p.name) === nameKey(clean));
  if (other) throw new ProfileError(`Le profil « ${other.name} » existe déjà sur cet appareil.`);
  return clean;
}

export function addProfile(registry: ProfileRegistry, profile: { id: string; name: string }, now: number): ProfileRegistry {
  if (!isProfileId(profile.id) || registry.profiles.some((p) => p.id === profile.id)) {
    throw new ProfileError("Identifiant de profil inutilisable.");
  }
  const name = checkName(registry, profile.name, null);
  return { ...registry, profiles: [...registry.profiles, { id: profile.id, name, createdAt: now, syncFileId: null }] };
}

export function renameProfile(registry: ProfileRegistry, id: string, name: string): ProfileRegistry {
  if (!registry.profiles.some((p) => p.id === id)) throw new ProfileError("Profil introuvable.");
  const clean = checkName(registry, name, id);
  return { ...registry, profiles: registry.profiles.map((p) => (p.id === id ? { ...p, name: clean } : p)) };
}

/** Retire un profil du registre ; le dernier ne se retire pas (décision 56). */
export function removeProfile(registry: ProfileRegistry, id: string): ProfileRegistry {
  if (!registry.profiles.some((p) => p.id === id)) throw new ProfileError("Profil introuvable.");
  if (registry.profiles.length === 1) throw new ProfileError("Le dernier profil de l'appareil ne se supprime pas.");
  return { ...registry, profiles: registry.profiles.filter((p) => p.id !== id) };
}

export function setProfileFile(registry: ProfileRegistry, id: string, fileId: string | null): ProfileRegistry {
  return { ...registry, profiles: registry.profiles.map((p) => (p.id === id ? { ...p, syncFileId: fileId } : p)) };
}

/** Autre profil de l'appareil qui utilise déjà ce fichier de synchronisation (décision 57). */
export function fileOwner(registry: ProfileRegistry, self: string, fileId: string): ProfileEntry | undefined {
  return registry.profiles.find((p) => p.id !== self && p.syncFileId === fileId);
}

/** Nom proposé pour le fichier de synchronisation d'un profil : `finances-sync-foyer.json`. */
export function syncFileNameFor(profile: Pick<ProfileEntry, "id" | "name">): string {
  if (profile.id === PRINCIPAL) return SYNC_FILE_NAME;
  const slug = nameKey(profile.name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `finances-sync-${slug || profile.id.slice(0, 8)}.json`;
}
