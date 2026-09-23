import { describe, expect, it } from "vitest";
import {
  applyChanges,
  COLLECTION_NAMES,
  dropRecords,
  findPurgedElsewhere,
  newSyncDocument,
  parseSyncDocument,
  serializeSyncDocument,
  setPreference,
  SyncFileError,
  syncWithDocument,
  tombstone,
  touch,
  type Dataset,
  type SyncDocument,
} from "../src";
import { DAY, eur, expense, NOW, world } from "./fixtures";

const A = { id: "device-A", label: "Mac" };
const B = { id: "device-B", label: "iPhone" };
const C = { id: "device-C", label: "Vieux PC" };
const HOUR = 3_600_000;
const T0 = NOW;

const { cats, accs, build } = world();
const X = expense("2026-09-10", eur(42), cats.courses.id, accs.courant.id);
const base = build({ operations: [X] });
const doc0 = newSyncDocument("file-1");

const sync = (local: Dataset, remote: SyncDocument, device: typeof A, now: number) =>
  syncWithDocument({ local, remote, device, now });
const opIn = (d: { collections: Dataset["collections"] }, id: string) => d.collections.operations.find((o) => o.id === id);

const normalize = (d: { collections: Dataset["collections"]; preferences: Dataset["preferences"] }) =>
  JSON.stringify({
    collections: Object.fromEntries(
      COLLECTION_NAMES.map((n) => [n, [...d.collections[n]].sort((x, y) => x.id.localeCompare(y.id))]),
    ),
    preferences: d.preferences,
  });

describe("premier passage", () => {
  it("le fichier reçoit tout et l'appareil s'inscrit au registre", () => {
    const r = sync(base, doc0, A, T0);
    expect(r.document).toMatchObject({ fileId: "file-1", revision: 1, writtenBy: A.id, writtenAt: T0 });
    expect(r.document.devices).toEqual({ [A.id]: { label: "Mac", lastRevision: 1, lastMergeAt: T0 } });
    expect(r.document.collections.operations).toEqual([X]);
    expect(r.report).toMatchObject({ sent: 12, received: 0, needsWrite: true });
  });

  it("rien à écrire quand rien n'a changé et que l'appareil est à jour", () => {
    const first = sync(base, doc0, A, T0);
    const again = sync(first.dataset, first.document, A, T0 + 60_000);
    expect(again.report).toMatchObject({ received: 0, sent: 0, purged: 0, needsWrite: false });
  });
});

describe("deux jeux divergents", () => {
  it("convergent vers le même état après un aller-retour", () => {
    const a0 = sync(base, doc0, A, T0);
    const b0 = sync(base, a0.document, B, T0 + HOUR);

    const opA = expense("2026-09-12", eur(15), cats.resto.id, accs.courant.id);
    const opB = expense("2026-09-13", eur(60), cats.courses.id, accs.courant.id);
    const localA = applyChanges(a0.dataset, { operations: [opA, touch(X, { amount: eur(43) }, T0 + 2 * HOUR)] });
    const localB = {
      ...applyChanges(b0.dataset, { operations: [opB, touch(X, { note: "marché" }, T0 + 3 * HOUR)] }),
      preferences: setPreference(b0.dataset.preferences, "theme", "dark", T0 + 3 * HOUR),
    };

    const a1 = sync(localA, b0.document, A, T0 + 4 * HOUR);
    const b1 = sync(localB, a1.document, B, T0 + 5 * HOUR);
    const a2 = sync(a1.dataset, b1.document, A, T0 + 6 * HOUR);

    expect(normalize(a2.dataset)).toBe(normalize(b1.dataset));
    expect(normalize(a2.dataset)).toBe(normalize(b1.document));
    // La modification la plus récente de X (la note, par B) l'emporte en entier.
    expect(opIn(a2.dataset, X.id)).toMatchObject({ note: "marché", amount: eur(42) });
    expect(opIn(a2.dataset, opA.id)).toBeDefined();
    expect(opIn(a2.dataset, opB.id)).toBeDefined();
    expect(a2.dataset.preferences.theme).toBe("dark");
  });
});

describe("purge des pierres tombales", () => {
  it("n'a lieu qu'une fois la suppression vue par tous les appareils actifs", () => {
    const a = sync(base, doc0, A, T0);
    const b = sync(base, a.document, B, T0 + HOUR);
    const a2 = sync(applyChanges(a.dataset, { operations: [tombstone(X, T0 + DAY)] }), b.document, A, T0 + DAY);
    expect(a2.document.landed[`operations:${X.id}`]).toBe(3);

    // 100 jours plus tard, B n'a toujours pas synchronisé : on garde la pierre tombale.
    const a3 = sync(a2.dataset, a2.document, A, T0 + 100 * DAY);
    expect(a3.report.purged).toBe(0);
    expect(opIn(a3.document, X.id)?.deletedAt).toBe(T0 + DAY);

    // B voit enfin la suppression ; il était le dernier : purge des deux côtés.
    const b2 = sync(b.dataset, a3.document, B, T0 + 101 * DAY);
    expect(b2.report.purged).toBe(1);
    expect(opIn(b2.dataset, X.id)).toBeUndefined();
    expect(opIn(b2.document, X.id)).toBeUndefined();
    expect(b2.document.landed).toEqual({});

    // A garde encore sa pierre tombale en local : elle est écartée, pas renvoyée au fichier.
    const a4 = sync(a3.dataset, b2.document, A, T0 + 102 * DAY);
    expect(a4.report.droppedLocalTombstones).toBe(1);
    expect(opIn(a4.document, X.id)).toBeUndefined();
    expect(opIn(a4.dataset, X.id)).toBeUndefined();
  });

  it("jamais avant 90 jours, même vue par tous", () => {
    const a = sync(applyChanges(base, { operations: [tombstone(X, T0)] }), doc0, A, T0 + 89 * DAY);
    expect(a.report.purged).toBe(0);
    expect(sync(a.dataset, a.document, A, T0 + 91 * DAY).report.purged).toBe(1);
  });

  it("jamais une pierre tombale encore référencée par une ligne vivante", () => {
    const meal = expense("2026-09-11", eur(30), cats.resto.id, accs.courant.id);
    const local = applyChanges(build({ operations: [meal] }), {
      categories: [tombstone(cats.resto, T0), tombstone(cats.voyage, T0)],
    });
    const r = sync(local, doc0, A, T0 + 100 * DAY);
    const ids = r.document.collections.categories.map((c) => c.id);
    expect(ids).toContain(cats.resto.id);
    expect(ids).not.toContain(cats.voyage.id);
  });

  it("un appareil absent depuis 180 jours sort du registre ; à son retour, on repère ce qu'il ferait revenir", () => {
    const c = sync(base, doc0, C, T0);
    const a = sync(base, c.document, A, T0);
    const a2 = sync(applyChanges(a.dataset, { operations: [tombstone(X, T0 + DAY)] }), a.document, A, T0 + DAY);
    const a3 = sync(a2.dataset, a2.document, A, T0 + 200 * DAY);
    expect(a3.report.evictedDevices).toEqual([C.id]);
    expect(a3.report.purged).toBe(1);
    expect(Object.keys(a3.document.devices)).toEqual([A.id]);

    const suspects = findPurgedElsewhere(c.dataset, a3.document, { id: C.id, knownFileId: "file-1", lastMergeAt: T0 });
    expect(suspects).toEqual([{ collection: "operations", id: X.id }]);
    // Sans précaution, X reviendrait d'entre les morts :
    expect(opIn(sync(c.dataset, a3.document, C, T0 + 201 * DAY).document, X.id)?.deletedAt).toBeNull();
    // Écarté d'abord, il ne revient pas.
    const c2 = sync(dropRecords(c.dataset, suspects), a3.document, C, T0 + 201 * DAY);
    expect(opIn(c2.document, X.id)).toBeUndefined();
  });

  it("rien à signaler pour un appareil encore inscrit ou un autre fichier", () => {
    const a = sync(base, doc0, A, T0);
    expect(findPurgedElsewhere(base, a.document, { id: A.id, knownFileId: "file-1", lastMergeAt: T0 })).toEqual([]);
    expect(findPurgedElsewhere(base, a.document, { id: B.id, knownFileId: "file-2", lastMergeAt: T0 })).toEqual([]);
    expect(findPurgedElsewhere(base, a.document, { id: B.id, knownFileId: null, lastMergeAt: null })).toEqual([]);
  });
});

describe("lecture du fichier", () => {
  const written = sync(base, doc0, A, T0).document;

  it("relit exactement ce qu'elle a écrit", () => {
    expect(parseSyncDocument(serializeSyncDocument(written))).toEqual(written);
  });

  const code = (text: string) => {
    try {
      parseSyncDocument(text);
    } catch (e) {
      return (e as SyncFileError).code;
    }
    return "ok";
  };

  it("fichier tronqué par un envoi en cours : illisible, on ne touche à rien", () => {
    const text = serializeSyncDocument(written);
    expect(code(text.slice(0, text.length / 2))).toBe("unreadable");
  });

  it("autre fichier JSON : refusé", () => {
    expect(code(JSON.stringify({ settings: {}, months: {} }))).toBe("not-a-sync-file");
  });

  it("écrit par une version plus récente : refusé", () => {
    expect(code(JSON.stringify({ ...written, schemaVersion: 2 }))).toBe("newer-schema");
  });

  it("contenu invalide : refusé avec le détail", () => {
    const bad = { ...written, collections: { ...written.collections, operations: [{ ...X, amount: 12.5 }] } };
    expect(code(JSON.stringify(bad))).toBe("invalid");
    try {
      parseSyncDocument(JSON.stringify(bad));
    } catch (e) {
      expect((e as SyncFileError).issues.join("\n")).toMatch(/amount invalide : 12\.5/);
    }
  });
});
