import { canonicalJson, mergeDatasets } from "./merge";
import {
  COLLECTION_NAMES,
  PREF_KEYS,
  SCHEMA_VERSION,
  type AnyRecord,
  type Changes,
  type CollectionName,
  type Dataset,
  type Meta,
  type PrefKey,
  type Preferences,
} from "./model";
import { nextStamp } from "./records";
import { parseSyncDocument, SyncFileError } from "./sync";
import { validateDataset } from "./validate";

export class BackupError extends Error {
  override name = "BackupError";
  constructor(
    readonly code: "unreadable" | "legacy" | "newer-schema" | "invalid" | "unknown",
    message: string,
  ) {
    super(message);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Export JSON : le jeu complet, pierres tombales comprises, pour qu'un import propage aussi les suppressions. */
export const serializeBackup = (data: Dataset): string => `${JSON.stringify(data, null, 2)}\n`;

/**
 * Lit une sauvegarde : un export JSON de Cashmyr, ou un fichier `finances-sync.json`.
 * Tout autre contenu est refusé en entier, sans rien retenir.
 */
export function parseBackup(text: string): Dataset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("unreadable", "Ce fichier n'est pas un JSON lisible.");
  }
  if (!isObj(raw)) throw new BackupError("unknown", "Ce fichier n'est pas une sauvegarde Cashmyr.");
  if (raw.format === "finances-sync") {
    try {
      const doc = parseSyncDocument(text);
      return { schemaVersion: SCHEMA_VERSION, collections: doc.collections, preferences: doc.preferences };
    } catch (e) {
      if (e instanceof SyncFileError && e.code === "newer-schema") throw new BackupError("newer-schema", e.message);
      throw new BackupError("invalid", e instanceof Error ? e.message : String(e));
    }
  }
  if ("settings" in raw && "months" in raw) {
    throw new BackupError("legacy", "Ce fichier vient de l'ancienne application : sa reprise passe par l'import dédié.");
  }
  if (typeof raw.schemaVersion !== "number" || !isObj(raw.collections)) {
    throw new BackupError("unknown", "Ce fichier n'est pas une sauvegarde Cashmyr.");
  }
  if (raw.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError("newer-schema", "Cette sauvegarde vient d'une version plus récente de Cashmyr. Mets l'application à jour.");
  }
  const issues = validateDataset(raw);
  if (issues.length > 0) {
    throw new BackupError("invalid", `Sauvegarde refusée : ${issues[0]}${issues.length > 1 ? ` (et ${issues.length - 1} autres problèmes)` : ""}.`);
  }
  return raw as Dataset;
}

const byId = <T extends Meta>(list: readonly T[]) => new Map(list.map((r) => [r.id, r]));

export type ImportResult = {
  changes: Changes;
  preferences: Preferences;
  /** Lignes ajoutées ou remplacées par une version plus récente. */
  rows: number;
  /** Préférences dont la version importée est plus récente. */
  preferencesChanged: PrefKey[];
};

/**
 * Décision 32 : un import fusionne, avec la règle de la synchronisation. Pour chaque ligne,
 * la version la plus récente gagne ; un import ancien n'apporte que ce qui manque.
 */
export function importBackup(current: Dataset, imported: Dataset): ImportResult {
  const { data: merged, report } = mergeDatasets(current, imported);
  const changes: Changes = {};
  let rows = 0;
  for (const name of COLLECTION_NAMES) {
    const before = byId<AnyRecord>(current.collections[name]);
    const changed = (merged.collections[name] as AnyRecord[]).filter((r) => {
      const b = before.get(r.id);
      return !b || canonicalJson(b) !== canonicalJson(r);
    });
    if (changed.length > 0) {
      (changes as Record<CollectionName, AnyRecord[]>)[name] = changed;
      rows += changed.length;
    }
  }
  return { changes, preferences: merged.preferences, rows, preferencesChanged: report.preferencesReceived };
}

export type RestoreResult = {
  changes: Changes;
  preferences: Preferences;
  /** Lignes que la copie rétablit ou modifie. */
  restored: number;
  /** Lignes créées depuis la copie, supprimées. */
  removed: number;
  /** Réglages dont la valeur change. */
  preferencesChanged: PrefKey[];
};

const withoutStamp = ({ updatedAt: _stamp, ...rest }: AnyRecord) => canonicalJson(rest);

/**
 * Décision 33 : restaurer une copie la fait gagner partout. Chaque ligne de la copie est
 * réécrite avec un horodatage plus récent que tout ce que cet appareil connaît ; les
 * lignes vivantes absentes de la copie deviennent des suppressions ; chaque préférence
 * reprend la valeur de la copie. Les autres appareils l'adoptent à la fusion suivante.
 */
export function restoreEverywhere(current: Dataset, snapshot: Dataset, now: number): RestoreResult {
  const changes: Changes = {};
  let restored = 0;
  let removed = 0;
  for (const name of COLLECTION_NAMES) {
    const before = byId<AnyRecord>(current.collections[name]);
    const kept = new Set<string>();
    const out: AnyRecord[] = [];
    for (const s of snapshot.collections[name] as AnyRecord[]) {
      kept.add(s.id);
      const b = before.get(s.id);
      const stamp = nextStamp(now, { updatedAt: Math.max(b?.updatedAt ?? 0, s.updatedAt) });
      out.push({ ...s, updatedAt: stamp });
      if (!b ? s.deletedAt === null : withoutStamp(b) !== withoutStamp(s)) restored++;
    }
    for (const b of before.values()) {
      if (kept.has(b.id) || b.deletedAt !== null) continue;
      const stamp = nextStamp(now, b);
      out.push({ ...b, updatedAt: stamp, deletedAt: stamp });
      removed++;
    }
    if (out.length > 0) (changes as Record<CollectionName, AnyRecord[]>)[name] = out;
  }
  const updatedAt = Object.fromEntries(
    PREF_KEYS.map((k) => [
      k,
      nextStamp(now, { updatedAt: Math.max(current.preferences.updatedAt[k], snapshot.preferences.updatedAt[k]) }),
    ]),
  ) as Record<PrefKey, number>;
  const preferencesChanged = PREF_KEYS.filter(
    (k) => canonicalJson(current.preferences[k]) !== canonicalJson(snapshot.preferences[k]),
  );
  return { changes, preferences: { ...snapshot.preferences, updatedAt }, restored, removed, preferencesChanged };
}
