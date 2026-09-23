import { describe, expect, it } from "vitest";
import {
  COLLECTION_NAMES,
  mergeDatasets,
  nextStamp,
  pickWinner,
  setPreference,
  tombstone,
  touch,
  type Dataset,
  type Operation,
} from "../src";
import { dataset, eur, expense, world } from "./fixtures";

const { cats, accs, build } = world();
const op = (amount: number, updatedAt = 100): Operation => ({
  ...expense("2026-09-10", eur(amount), cats.courses.id, accs.courant.id),
  updatedAt,
});
const withOps = (...ops: Operation[]) => build({ operations: ops });
const find = (d: Dataset, id: string) => d.collections.operations.find((o) => o.id === id);

describe("fusion ligne à ligne", () => {
  it("une ligne présente d'un seul côté est reprise, dans les deux sens", () => {
    const a = op(10);
    const b = op(20);
    const { data, report } = mergeDatasets(withOps(a), withOps(b));
    expect(data.collections.operations.map((o) => o.id).sort()).toEqual([a.id, b.id].sort());
    expect(report).toMatchObject({ received: 1, sent: 1 });
  });

  it("modification concurrente : la version la plus récente gagne", () => {
    const base = op(10, 100);
    const local = touch(base, { amount: eur(11) }, 200);
    const remote = touch(base, { amount: eur(12) }, 300);
    expect(find(mergeDatasets(withOps(local), withOps(remote)).data, base.id)?.amount).toBe(eur(12));
    expect(find(mergeDatasets(withOps(remote), withOps(local)).data, base.id)?.amount).toBe(eur(12));
  });

  it("suppression contre modification plus ancienne : la suppression gagne et se propage", () => {
    const base = op(10, 100);
    const edited = touch(base, { amount: eur(11) }, 200);
    const deleted = tombstone(base, 300);
    const { data, report } = mergeDatasets(withOps(edited), withOps(deleted));
    expect(find(data, base.id)?.deletedAt).toBe(300);
    expect(report.received).toBe(1);
    // L'autre appareil reçoit aussi la pierre tombale.
    expect(find(mergeDatasets(withOps(deleted), withOps(edited)).data, base.id)?.deletedAt).toBe(300);
  });

  it("suppression contre modification plus récente : la ligne revient", () => {
    const base = op(10, 100);
    const deleted = tombstone(base, 200);
    const edited = touch(base, { amount: eur(11) }, 300);
    const merged = find(mergeDatasets(withOps(deleted), withOps(edited)).data, base.id);
    expect(merged).toMatchObject({ deletedAt: null, amount: eur(11) });
  });

  it("égalité stricte : la suppression gagne, sinon un départage identique des deux côtés", () => {
    const base = op(10, 100);
    const deleted = { ...base, updatedAt: 200, deletedAt: 200 };
    const edited = { ...base, updatedAt: 200, amount: eur(11) };
    expect(pickWinner(deleted, edited)).toBe(deleted);
    expect(pickWinner(edited, deleted)).toBe(deleted);
    const other = { ...base, updatedAt: 200, amount: eur(12) };
    expect(pickWinner(edited, other)).toEqual(pickWinner(other, edited));
  });

  it("une écriture après avoir vu une version datée dans le futur la bat quand même", () => {
    const future = op(10, 5_000_000);
    const stamp = nextStamp(1_000, future);
    expect(stamp).toBe(5_000_001);
    const edited = touch(future, { amount: eur(99) }, 1_000);
    expect(pickWinner(edited, future)).toBe(edited);
  });

  it("deux jeux identiques : rien à recevoir ni à envoyer", () => {
    const a = op(10);
    expect(mergeDatasets(withOps(a), withOps({ ...a })).report).toMatchObject({ received: 0, sent: 0 });
  });
});

describe("fusion des préférences clé par clé", () => {
  it("chaque clé garde sa version la plus récente, indépendamment des autres", () => {
    const base = dataset({});
    const local = { ...base, preferences: setPreference(base.preferences, "splits", { besoin: 6000, envie: 2000, invest: 2000 }, 100) };
    let remotePrefs = setPreference(base.preferences, "theme", "dark", 200);
    remotePrefs = setPreference(remotePrefs, "splits", { besoin: 4000, envie: 4000, invest: 2000 }, 50);
    const remote = { ...base, preferences: remotePrefs };

    const { data, report } = mergeDatasets(local, remote);
    expect(data.preferences.splits).toEqual({ besoin: 6000, envie: 2000, invest: 2000 });
    expect(data.preferences.theme).toBe("dark");
    expect(data.preferences.updatedAt).toMatchObject({ splits: 100, theme: 200 });
    expect(report.preferencesReceived).toEqual(["theme"]);
    expect(report.preferencesSent).toEqual(["splits"]);
  });
});

// ── Propriétés sur des jeux générés ─────────────────────────────────────────

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un jeu tiré au hasard dans un petit univers d'identifiants, pour forcer les collisions. */
function randomDataset(seed: number): Dataset {
  const rand = prng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const ops: Operation[] = [];
  for (let i = 0; i < 12; i++) {
    if (rand() < 0.4) continue;
    const updatedAt = 1 + Math.floor(rand() * 6);
    const record: Operation = {
      id: `op-${i}`,
      updatedAt,
      deletedAt: rand() < 0.3 ? updatedAt : null,
      date: pick(["2026-07-01", "2026-08-15", "2026-09-10"]),
      amount: 1 + Math.floor(rand() * 3),
      type: "out",
      note: pick(["", "a", "b"]),
      categoryId: cats.courses.id,
      accountId: accs.courant.id,
    };
    ops.push(record);
  }
  let prefs = dataset({}).preferences;
  if (rand() < 0.5) prefs = setPreference(prefs, "theme", pick(["light", "dark"] as const), 1 + Math.floor(rand() * 3));
  if (rand() < 0.5) prefs = setPreference(prefs, "averageWindow", pick([3, 6, 12] as const), 1 + Math.floor(rand() * 3));
  return { ...build({ operations: ops }), preferences: prefs };
}

const normalize = (d: Dataset) =>
  JSON.stringify({
    collections: Object.fromEntries(
      COLLECTION_NAMES.map((n) => [n, [...d.collections[n]].sort((x, y) => x.id.localeCompare(y.id))]),
    ),
    preferences: d.preferences,
  });

describe("propriétés de la fusion (300 tirages)", () => {
  const seeds = Array.from({ length: 300 }, (_, i) => i + 1);

  it("commutative : fusionner A avec B ou B avec A donne le même résultat", () => {
    for (const s of seeds) {
      const a = randomDataset(s);
      const b = randomDataset(s * 7919);
      expect(normalize(mergeDatasets(a, b).data)).toBe(normalize(mergeDatasets(b, a).data));
    }
  });

  it("idempotente : fusionner A avec lui-même rend A", () => {
    for (const s of seeds) {
      const a = randomDataset(s);
      expect(normalize(mergeDatasets(a, a).data)).toBe(normalize(a));
    }
  });

  it("associative : l'ordre des synchronisations entre trois appareils est indifférent", () => {
    for (const s of seeds) {
      const [a, b, c] = [randomDataset(s), randomDataset(s + 1000), randomDataset(s + 2000)];
      const left = mergeDatasets(mergeDatasets(a, b).data, c).data;
      const right = mergeDatasets(a, mergeDatasets(b, c).data).data;
      expect(normalize(left)).toBe(normalize(right));
    }
  });
});
