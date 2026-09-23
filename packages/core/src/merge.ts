import {
  COLLECTION_NAMES,
  PREF_KEYS,
  type AnyRecord,
  type CollectionName,
  type Collections,
  type Dataset,
  type Meta,
  type PrefKey,
  type Preferences,
} from "./model";

/** JSON à clés triées : deux contenus égaux donnent la même chaîne. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Version gagnante d'une même ligne.
 * 1. `updatedAt` le plus élevé. Supprimer étant une écriture datée, une suppression
 *    gagne sur toute modification plus ancienne et perd contre une plus récente.
 * 2. À égalité stricte, la version supprimée.
 * 3. Sinon le plus grand JSON canonique : arbitraire mais identique sur tous les appareils.
 */
export function pickWinner<T extends Meta>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  const aDeleted = a.deletedAt !== null;
  const bDeleted = b.deletedAt !== null;
  if (aDeleted !== bDeleted) return aDeleted ? a : b;
  return canonicalJson(a) >= canonicalJson(b) ? a : b;
}

const sameVersion = (a: Meta, b: Meta) =>
  a.updatedAt === b.updatedAt && a.deletedAt === b.deletedAt && canonicalJson(a) === canonicalJson(b);

export type CollectionMergeStats = { received: number; sent: number };

/** Fusion ligne à ligne. Résultat trié par identifiant, donc indépendant de l'ordre des entrées. */
export function mergeCollection<T extends Meta>(
  local: readonly T[],
  remote: readonly T[],
): { merged: T[]; stats: CollectionMergeStats } {
  const localById = new Map(local.map((r) => [r.id, r]));
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const ids = [...new Set([...localById.keys(), ...remoteById.keys()])].sort();
  const merged: T[] = [];
  const stats = { received: 0, sent: 0 };
  for (const id of ids) {
    const l = localById.get(id);
    const r = remoteById.get(id);
    if (l && r) {
      const w = pickWinner(l, r);
      merged.push(w);
      if (w !== l && !sameVersion(w, l)) stats.received++;
      if (w !== r && !sameVersion(w, r)) stats.sent++;
    } else if (l) {
      merged.push(l);
      stats.sent++;
    } else if (r) {
      merged.push(r);
      stats.received++;
    }
  }
  return { merged, stats };
}

/** Fusion clé par clé selon `updatedAt[clé]`. `splits` et `safety` sont des clés entières. */
export function mergePreferences(
  local: Preferences,
  remote: Preferences,
): { merged: Preferences; received: PrefKey[]; sent: PrefKey[] } {
  const merged = { ...local, updatedAt: { ...local.updatedAt } } as Preferences;
  const received: PrefKey[] = [];
  const sent: PrefKey[] = [];
  for (const key of PREF_KEYS) {
    const lt = local.updatedAt[key];
    const rt = remote.updatedAt[key];
    const lv = canonicalJson(local[key]);
    const rv = canonicalJson(remote[key]);
    const remoteWins = rt !== lt ? rt > lt : rv > lv;
    const winner = remoteWins ? remote : local;
    (merged as Record<PrefKey, unknown>)[key] = winner[key];
    merged.updatedAt[key] = winner.updatedAt[key];
    if (lv === rv && lt === rt) continue;
    if (remoteWins) received.push(key);
    else sent.push(key);
  }
  return { merged, received, sent };
}

export type MergeReport = {
  /** Lignes que la fusion change sur cet appareil. */
  received: number;
  /** Lignes que la fusion apporte au fichier. */
  sent: number;
  preferencesReceived: PrefKey[];
  preferencesSent: PrefKey[];
  byCollection: Record<CollectionName, CollectionMergeStats>;
};

export function mergeDatasets(local: Dataset, remote: Dataset): { data: Dataset; report: MergeReport } {
  if (local.schemaVersion !== remote.schemaVersion) {
    throw new Error("Fusion impossible entre deux versions de schéma différentes : migrer d'abord.");
  }
  const collections = {} as Record<CollectionName, AnyRecord[]>;
  const byCollection = {} as Record<CollectionName, CollectionMergeStats>;
  let received = 0;
  let sent = 0;
  for (const name of COLLECTION_NAMES) {
    const { merged, stats } = mergeCollection<AnyRecord>(local.collections[name], remote.collections[name]);
    collections[name] = merged;
    byCollection[name] = stats;
    received += stats.received;
    sent += stats.sent;
  }
  const prefs = mergePreferences(local.preferences, remote.preferences);
  return {
    data: { schemaVersion: local.schemaVersion, collections: collections as Collections, preferences: prefs.merged },
    report: {
      received,
      sent,
      preferencesReceived: prefs.received,
      preferencesSent: prefs.sent,
      byCollection,
    },
  };
}
