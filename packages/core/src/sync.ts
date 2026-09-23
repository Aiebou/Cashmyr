import { defaultPreferences, emptyCollections } from "./dataset";
import { mergeDatasets, type MergeReport } from "./merge";
import {
  COLLECTION_NAMES,
  SCHEMA_VERSION,
  type AnyRecord,
  type CollectionName,
  type Collections,
  type Dataset,
  type Preferences,
} from "./model";
import { validateDataset, ValidationError } from "./validate";

export const DAY_MS = 86_400_000;
/** Âge à partir duquel une pierre tombale peut être purgée. */
export const TOMBSTONE_TTL_MS = 90 * DAY_MS;
/** Un appareil qui n'a pas fusionné depuis ce délai sort du registre et ne bloque plus les purges. */
export const DEVICE_EVICTION_MS = 180 * DAY_MS;
/** Un appareil à jour réécrit quand même son passage au-delà de ce délai, pour ne pas être évincé. */
const REGISTER_REFRESH_MS = 30 * DAY_MS;

export const SYNC_FORMAT = "finances-sync";

export type DeviceEntry = {
  label: string;
  /** Dernière révision du fichier produite par une fusion de cet appareil. */
  lastRevision: number;
  lastMergeAt: number;
};

export type SyncDocument = {
  format: typeof SYNC_FORMAT;
  schemaVersion: typeof SCHEMA_VERSION;
  /** Créé à la naissance du fichier ; distingue deux fichiers de synchronisation. */
  fileId: string;
  /** +1 à chaque écriture. */
  revision: number;
  writtenAt: number;
  writtenBy: string;
  devices: Record<string, DeviceEntry>;
  /** Révision à laquelle chaque pierre tombale est arrivée dans le fichier, clé "collection:id". */
  landed: Record<string, number>;
  collections: Collections;
  preferences: Preferences;
};

export function newSyncDocument(fileId: string): SyncDocument {
  return {
    format: SYNC_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    fileId,
    revision: 0,
    writtenAt: 0,
    writtenBy: "",
    devices: {},
    landed: {},
    collections: emptyCollections(),
    preferences: defaultPreferences(),
  };
}

export const documentDataset = (doc: SyncDocument): Dataset => ({
  schemaVersion: doc.schemaVersion,
  collections: doc.collections,
  preferences: doc.preferences,
});

const keyOf = (name: CollectionName, id: string) => `${name}:${id}`;

/** Identifiants référencés par au moins une ligne vivante. */
function referencedIds(collections: Collections): Set<string> {
  const refs = new Set<string>();
  const add = (id: string | undefined) => {
    if (id) refs.add(id);
  };
  for (const op of collections.operations) {
    if (op.deletedAt !== null) continue;
    add(op.categoryId);
    add(op.accountId);
    add(op.fromAccountId);
    add(op.toAccountId);
    add(op.goalId);
    add(op.debtId);
    add(op.recurrenceId);
  }
  for (const rec of collections.recurrences) {
    if (rec.deletedAt !== null) continue;
    add(rec.categoryId);
    add(rec.accountId);
    add(rec.fromAccountId);
    add(rec.toAccountId);
    add(rec.goalId);
    add(rec.debtId);
  }
  for (const d of collections.debts) {
    if (d.deletedAt !== null) continue;
    add(d.categoryId ?? undefined);
    add(d.accountId ?? undefined);
    add(d.recurrenceId ?? undefined);
  }
  for (const g of collections.goals) if (g.deletedAt === null) g.accountIds.forEach(add);
  for (const s of collections.goalSteps) if (s.deletedAt === null) add(s.goalId);
  for (const s of collections.skips) if (s.deletedAt === null) add(s.recurrenceId);
  return refs;
}

export type SyncReport = MergeReport & {
  revision: number;
  /** Pierres tombales retirées des deux côtés. */
  purged: number;
  /** Pierres tombales périmées que seul cet appareil gardait encore. */
  droppedLocalTombstones: number;
  /** Appareils retirés du registre pour inactivité. */
  evictedDevices: string[];
  /** Faux si le fichier n'a rien à apprendre de cette fusion : inutile de le réécrire. */
  needsWrite: boolean;
};

/**
 * Une synchronisation complète, sans effet de bord :
 * fusion ligne à ligne, registre des appareils, purge des pierres tombales
 * vues par tous les appareils actifs. Renvoie le jeu local et le document à écrire.
 */
export function syncWithDocument(args: {
  local: Dataset;
  remote: SyncDocument;
  device: { id: string; label: string };
  now: number;
}): { dataset: Dataset; document: SyncDocument; report: SyncReport } {
  const { remote, device, now } = args;
  const horizon = now - TOMBSTONE_TTL_MS;

  // 1. Pierres tombales périmées absentes du fichier : le fichier les a déjà purgées.
  //    Sauf si une ligne vivante, d'un côté ou de l'autre, y fait encore référence.
  let droppedLocalTombstones = 0;
  const stillReferenced = new Set([...referencedIds(args.local.collections), ...referencedIds(remote.collections)]);
  const localCollections = {} as Record<CollectionName, AnyRecord[]>;
  for (const name of COLLECTION_NAMES) {
    const remoteIds = new Set(remote.collections[name].map((r) => r.id));
    localCollections[name] = args.local.collections[name].filter((r) => {
      const stale =
        r.deletedAt !== null && r.deletedAt < horizon && !remoteIds.has(r.id) && !stillReferenced.has(r.id);
      if (stale) droppedLocalTombstones++;
      return !stale;
    });
  }
  const local: Dataset = { ...args.local, collections: localCollections as Collections };

  // 2. Fusion.
  const { data: merged, report } = mergeDatasets(local, documentDataset(remote));
  const revision = remote.revision + 1;

  // 3. Registre des appareils.
  const devices: Record<string, DeviceEntry> = {};
  const evictedDevices: string[] = [];
  for (const [id, entry] of Object.entries(remote.devices)) {
    if (id === device.id) continue;
    if (entry.lastMergeAt < now - DEVICE_EVICTION_MS) evictedDevices.push(id);
    else devices[id] = entry;
  }
  devices[device.id] = { label: device.label, lastRevision: revision, lastMergeAt: now };

  // 4. Arrivée des pierres tombales, puis purge de celles que tous les appareils actifs ont vues.
  const remoteById = new Map<string, AnyRecord>();
  for (const name of COLLECTION_NAMES) for (const r of remote.collections[name]) remoteById.set(keyOf(name, r.id), r);
  const refs = referencedIds(merged.collections);
  const minSeen = Math.min(...Object.values(devices).map((d) => d.lastRevision));
  const landed: Record<string, number> = {};
  const collections = {} as Record<CollectionName, AnyRecord[]>;
  let purged = 0;
  for (const name of COLLECTION_NAMES) {
    collections[name] = merged.collections[name].filter((r) => {
      if (r.deletedAt === null) return true;
      const key = keyOf(name, r.id);
      const before = remoteById.get(key);
      const arrived =
        before && before.deletedAt !== null && before.updatedAt === r.updatedAt
          ? (remote.landed[key] ?? remote.revision)
          : revision;
      if (r.deletedAt < horizon && !refs.has(r.id) && minSeen >= arrived) {
        purged++;
        return false;
      }
      landed[key] = arrived;
      return true;
    });
  }

  const dataset: Dataset = { ...merged, collections: collections as Collections };
  const document: SyncDocument = {
    format: SYNC_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    fileId: remote.fileId,
    revision,
    writtenAt: now,
    writtenBy: device.id,
    devices,
    landed,
    collections: dataset.collections,
    preferences: dataset.preferences,
  };

  const mine = remote.devices[device.id];
  const needsWrite =
    report.sent > 0 ||
    report.preferencesSent.length > 0 ||
    purged > 0 ||
    evictedDevices.length > 0 ||
    !mine ||
    mine.label !== device.label ||
    mine.lastRevision < remote.revision ||
    mine.lastMergeAt < now - REGISTER_REFRESH_MS;

  return {
    dataset,
    document,
    report: { ...report, revision, purged, droppedLocalTombstones, evictedDevices, needsWrite },
  };
}

export type RecordRef = { collection: CollectionName; id: string };

/**
 * Appareil évincé du registre qui revient : ses lignes vivantes absentes du fichier
 * et antérieures à sa dernière fusion y étaient forcément présentes, puis ont été
 * supprimées et purgées ailleurs. À soumettre à l'utilisateur avant de fusionner.
 */
export function findPurgedElsewhere(
  local: Dataset,
  remote: SyncDocument,
  device: { id: string; knownFileId: string | null; lastMergeAt: number | null },
): RecordRef[] {
  if (device.knownFileId !== remote.fileId || device.lastMergeAt === null || device.id in remote.devices) return [];
  const suspects: RecordRef[] = [];
  for (const name of COLLECTION_NAMES) {
    const remoteIds = new Set(remote.collections[name].map((r) => r.id));
    for (const r of local.collections[name]) {
      if (r.deletedAt === null && !remoteIds.has(r.id) && r.updatedAt <= device.lastMergeAt) {
        suspects.push({ collection: name, id: r.id });
      }
    }
  }
  return suspects;
}

/** Retire des lignes du jeu local (réponse « les écarter » à `findPurgedElsewhere`). */
export function dropRecords(data: Dataset, refs: RecordRef[]): Dataset {
  const drop = new Set(refs.map((r) => keyOf(r.collection, r.id)));
  const collections = {} as Record<CollectionName, AnyRecord[]>;
  for (const name of COLLECTION_NAMES) {
    collections[name] = data.collections[name].filter((r) => !drop.has(keyOf(name, r.id)));
  }
  return { ...data, collections: collections as Collections };
}

export type SyncFileErrorCode = "unreadable" | "not-a-sync-file" | "newer-schema" | "invalid";

export class SyncFileError extends Error {
  constructor(
    readonly code: SyncFileErrorCode,
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "SyncFileError";
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNat = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Lit et valide le contenu du fichier de synchronisation. Lève `SyncFileError` sans rien corriger. */
export function parseSyncDocument(text: string): SyncDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SyncFileError(
      "unreadable",
      "Fichier de synchronisation illisible. Il est peut-être en cours d'envoi par ton service cloud : nouvelle tentative plus tard.",
    );
  }
  if (!isObj(raw) || raw.format !== SYNC_FORMAT) {
    throw new SyncFileError("not-a-sync-file", "Ce fichier n'est pas un fichier de synchronisation Cashmyr.");
  }
  if (typeof raw.schemaVersion !== "number" || raw.schemaVersion > SCHEMA_VERSION) {
    throw new SyncFileError(
      "newer-schema",
      "Ce fichier a été écrit par une version plus récente de Cashmyr. Mets l'application à jour sur cet appareil.",
    );
  }
  const issues = validateDataset({
    schemaVersion: raw.schemaVersion,
    collections: raw.collections,
    preferences: raw.preferences,
  });
  if (typeof raw.fileId !== "string" || raw.fileId === "") issues.push("fileId manquant");
  for (const key of ["revision", "writtenAt"] as const) if (!isNat(raw[key])) issues.push(`${key} invalide`);
  if (typeof raw.writtenBy !== "string") issues.push("writtenBy invalide");
  if (!isObj(raw.devices)) issues.push("devices invalide");
  else {
    for (const [id, d] of Object.entries(raw.devices)) {
      if (!isObj(d) || typeof d.label !== "string" || !isNat(d.lastRevision) || !isNat(d.lastMergeAt)) {
        issues.push(`devices.${id} invalide`);
      }
    }
  }
  if (!isObj(raw.landed) || !Object.values(raw.landed).every(isNat)) issues.push("landed invalide");
  if (issues.length > 0) {
    throw new SyncFileError("invalid", new ValidationError(issues).message, issues);
  }
  return raw as SyncDocument;
}

export const serializeSyncDocument = (doc: SyncDocument): string => `${JSON.stringify(doc)}\n`;
