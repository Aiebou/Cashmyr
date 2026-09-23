import { monthOf } from "./dates";
import {
  COLLECTION_NAMES,
  DASH_BLOCKS,
  PREF_KEYS,
  SCHEMA_VERSION,
  type Account,
  type AnyRecord,
  type Category,
  type Changes,
  type CollectionName,
  type Collections,
  type DashBlock,
  type Dataset,
  type Debt,
  type Goal,
  type Meta,
  type Month,
  type Operation,
  type PrefKey,
  type Preferences,
  type Recurrence,
} from "./model";
import { nextStamp } from "./records";

export function defaultPreferences(): Preferences {
  const updatedAt = Object.fromEntries(PREF_KEYS.map((k) => [k, 0])) as Record<PrefKey, number>;
  return {
    splits: { besoin: 5000, envie: 3000, invest: 2000 },
    basis: "avg",
    averageWindow: 6,
    safety: { mode: "months", months: 4, amount: 0, hidden: false, pinned: true },
    dashOrder: [...DASH_BLOCKS],
    theme: "system",
    categoryColors: {},
    bucketColors: {},
    updatedAt,
  };
}

export function emptyCollections(): Collections {
  return {
    categories: [],
    accounts: [],
    operations: [],
    goals: [],
    goalSteps: [],
    debts: [],
    recurrences: [],
    skips: [],
  };
}

/**
 * Ordre des blocs du tableau de bord : les clés connues dans l'ordre enregistré,
 * sans doublon ; celles qui manquent sont ajoutées en fin de liste ; les inconnues sont retirées.
 */
export function normalizeDashOrder(order: readonly unknown[]): DashBlock[] {
  const out: DashBlock[] = [];
  for (const key of order) {
    if (DASH_BLOCKS.includes(key as DashBlock) && !out.includes(key as DashBlock)) out.push(key as DashBlock);
  }
  for (const key of DASH_BLOCKS) if (!out.includes(key)) out.push(key);
  return out;
}

export function emptyDataset(): Dataset {
  return { schemaVersion: SCHEMA_VERSION, collections: emptyCollections(), preferences: defaultPreferences() };
}

function upsert<T extends Meta>(records: readonly T[], incoming: readonly T[]): T[] {
  if (incoming.length === 0) return records as T[];
  const byId = new Map(incoming.map((r) => [r.id, r]));
  const out = records.map((r) => {
    const next = byId.get(r.id);
    if (next) byId.delete(r.id);
    return next ?? r;
  });
  for (const r of byId.values()) out.push(r);
  return out;
}

/** Insère ou remplace les lignes fournies, par identifiant. Ne modifie pas `data`. */
export function applyChanges(data: Dataset, changes: Changes): Dataset {
  const collections = { ...data.collections };
  for (const name of COLLECTION_NAMES) {
    const incoming = changes[name];
    if (incoming && incoming.length > 0) {
      (collections as Record<CollectionName, AnyRecord[]>)[name] = upsert<AnyRecord>(
        collections[name],
        incoming,
      );
    }
  }
  return { ...data, collections };
}

export function mergeChanges(...parts: Changes[]): Changes {
  const out: Changes = {};
  for (const part of parts) {
    for (const name of COLLECTION_NAMES) {
      const incoming = part[name];
      if (!incoming || incoming.length === 0) continue;
      (out as Record<CollectionName, AnyRecord[]>)[name] = upsert<AnyRecord>(out[name] ?? [], incoming);
    }
  }
  return out;
}

export function countChanges(changes: Changes): number {
  return COLLECTION_NAMES.reduce((n, name) => n + (changes[name]?.length ?? 0), 0);
}

/** Modifie une préférence et horodate sa clé seule. */
export function setPreference<K extends PrefKey>(
  prefs: Preferences,
  key: K,
  value: Preferences[K],
  now: number,
): Preferences {
  return {
    ...prefs,
    [key]: value,
    updatedAt: { ...prefs.updatedAt, [key]: nextStamp(now, { updatedAt: prefs.updatedAt[key] }) },
  };
}

/** Index de lecture, calculé une fois par version du jeu de données. */
export type DatasetIndex = {
  categories: Map<string, Category>;
  accounts: Map<string, Account>;
  goals: Map<string, Goal>;
  debts: Map<string, Debt>;
  recurrences: Map<string, Recurrence>;
  operations: Map<string, Operation>;
  /** Opérations vivantes, par mois de leur date. */
  opsByMonth: Map<Month, Operation[]>;
  /** Opérations vivantes, tous mois confondus. */
  liveOps: Operation[];
};

const cache = new WeakMap<Collections, DatasetIndex>();

const byId = <T extends Meta>(records: readonly T[]) => new Map(records.map((r) => [r.id, r]));

export function indexOf(data: Dataset): DatasetIndex {
  const hit = cache.get(data.collections);
  if (hit) return hit;
  const c = data.collections;
  const liveOps = c.operations.filter((o) => o.deletedAt === null);
  const opsByMonth = new Map<Month, Operation[]>();
  for (const op of liveOps) {
    const m = monthOf(op.date);
    const list = opsByMonth.get(m);
    if (list) list.push(op);
    else opsByMonth.set(m, [op]);
  }
  const index: DatasetIndex = {
    categories: byId(c.categories),
    accounts: byId(c.accounts),
    goals: byId(c.goals),
    debts: byId(c.debts),
    recurrences: byId(c.recurrences),
    operations: byId(c.operations),
    opsByMonth,
    liveOps,
  };
  cache.set(c, index);
  return index;
}
