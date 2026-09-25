import { describe, expect, it } from "vitest";
import {
  applyChanges,
  deleteTag,
  isOlderSchema,
  materializeRecurrences,
  mergeDatasets,
  newSyncDocument,
  orderAccounts,
  parseBackup,
  parseSyncDocument,
  renameTag,
  reorderAccounts,
  resolveTag,
  SCHEMA_VERSION,
  serializeSyncDocument,
  shownTag,
  tagIdFor,
  tagTotals,
  tagUsage,
  TagError,
  upgradeSchema,
  validateDataset,
  type Dataset,
} from "../src";
import { dataset, eur, expense, income, NOW, recurrence, transfer, world } from "./fixtures";

const { cats, accs } = world();
const base = () => dataset({ categories: Object.values(cats), accounts: Object.values(accs) });

/** Un jeu tel que l'écrivait la version 0.1 : format 1, sans collection des tags. */
function formatOne(data: Dataset): Record<string, unknown> {
  const { tags: _tags, ...collections } = data.collections;
  return { ...data, schemaVersion: 1, collections };
}

describe("format 2 et mise à niveau (décision 50)", () => {
  it("un jeu du format 1 passe au format 2 : collection des tags vide, rien d'autre ne change", () => {
    const old = formatOne(base());
    expect(isOlderSchema(old)).toBe(true);
    const upgraded = upgradeSchema(old) as unknown as Dataset;
    expect(upgraded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(upgraded.collections.tags).toEqual([]);
    expect(upgraded.collections.accounts).toEqual(base().collections.accounts);
    expect(validateDataset(upgraded)).toEqual([]);
    // Sans mise à niveau, la validation le refuse.
    expect(validateDataset(old)).not.toEqual([]);
  });

  it("le format courant, un format inconnu ou autre chose restent tels quels", () => {
    const current = base();
    expect(upgradeSchema(current)).toBe(current);
    const newer = { ...current, schemaVersion: SCHEMA_VERSION + 1 };
    expect(upgradeSchema(newer)).toBe(newer);
    expect(upgradeSchema("texte")).toBe("texte");
    expect(isOlderSchema(current)).toBe(false);
  });

  it("un fichier de synchronisation et une sauvegarde du format 1 sont lus et mis à niveau", () => {
    const doc = { ...newSyncDocument("file-1"), ...formatOne(base()) };
    const read = parseSyncDocument(serializeSyncDocument(doc as never));
    expect(read.schemaVersion).toBe(SCHEMA_VERSION);
    expect(read.collections.tags).toEqual([]);
    const backup = parseBackup(JSON.stringify(formatOne(base())));
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(backup.collections.accounts).toHaveLength(Object.values(accs).length);
  });
});

describe("tags (décisions 47 et 48)", () => {
  it("même nom, même tag : à la casse, aux accents et aux espaces près, sur deux appareils", () => {
    const a = resolveTag(base(), "Société A", NOW);
    const b = resolveTag(base(), "  societe   a ", NOW + 5);
    expect(a.tag.id).toBe(tagIdFor("SOCIÉTÉ A"));
    expect(b.tag.id).toBe(a.tag.id);
    const merged = mergeDatasets(applyChanges(base(), a.changes), applyChanges(base(), b.changes)).data;
    expect(merged.collections.tags.map((t) => t.name)).toEqual(["societe a"]);
    // Un tag qui existe est repris, sans écriture.
    expect(resolveTag(applyChanges(base(), a.changes), "SOCIÉTÉ A", NOW + 9).changes).toEqual({});
  });

  it("supprimé : les opérations le gardent sans l'afficher ; recréé sous le même nom, il revient avec elles", () => {
    const { tag, changes } = resolveTag(base(), "Propfirm FTMO", NOW);
    const op = income("2026-09-10", 1_999, cats.freelance.id, accs.courant.id, { tagId: tag.id });
    let data = applyChanges(base(), { ...changes, operations: [op] });
    data = applyChanges(data, deleteTag(data, tag.id, NOW + 10));
    expect(validateDataset(data)).toEqual([]);
    expect(data.collections.operations[0]!.tagId).toBe(tag.id);
    expect(shownTag(data, tag.id)).toBeUndefined();
    const again = resolveTag(data, "propfirm ftmo", NOW + 20);
    expect(again.tag).toMatchObject({ id: tag.id, deletedAt: null, name: "propfirm ftmo" });
    expect(again.tag.updatedAt).toBeGreaterThan(NOW + 10);
    expect(shownTag(applyChanges(data, again.changes), tag.id)?.name).toBe("propfirm ftmo");
  });

  it("renommer garde l'identité ; un nouveau tag reprenant l'ancien nom en reçoit une autre ; pas de doublon de nom", () => {
    const first = resolveTag(base(), "Projet", NOW);
    let data = applyChanges(base(), first.changes);
    data = applyChanges(data, renameTag(data, first.tag.id, "Société A", NOW + 1));
    expect(data.collections.tags[0]).toMatchObject({ id: first.tag.id, name: "Société A" });
    const second = resolveTag(data, "Projet", NOW + 2);
    expect(second.tag.id).not.toBe(first.tag.id);
    data = applyChanges(data, second.changes);
    expect(() => renameTag(data, second.tag.id, "société a", NOW + 3)).toThrow(TagError);
    expect(() => resolveTag(data, "   ", NOW)).toThrow(TagError);
  });

  it("la validation refuse un tag introuvable ou sans nom", () => {
    const op = expense("2026-09-10", 2_100, cats.resto.id, accs.courant.id, { tagId: "inconnu" });
    expect(validateDataset(applyChanges(base(), { operations: [op] })).join()).toMatch(/tagId : référence introuvable/);
    const blank = { ...resolveTag(base(), "x", NOW).tag, name: " " };
    expect(validateDataset(applyChanges(base(), { tags: [blank] })).join()).toMatch(/tags\[0\]\.name/);
  });

  it("une récurrence taguée transmet son tag à chaque occurrence", () => {
    const { tag, changes } = resolveTag(base(), "Abonnements pro", NOW);
    const rec = recurrence({ type: "out", amount: 2_100, dayOfMonth: 5, startMonth: "2026-08", categoryId: cats.resto.id, accountId: accs.courant.id, tagId: tag.id });
    const data = applyChanges(base(), { ...changes, recurrences: [rec] });
    const generated = materializeRecurrences(data, "2026-09-23", NOW);
    expect(generated.map((o) => o.tagId)).toEqual([tag.id, tag.id]);
    expect(tagUsage(applyChanges(data, { operations: generated })).get(tag.id)).toEqual({ operations: 2, recurrences: 1 });
  });

  it("totaux d'un tag : entrées, sorties, solde ; les transferts sont listés sans compter", () => {
    const ops = [
      income("2026-09-01", 1_999, cats.freelance.id, accs.courant.id),
      expense("2026-09-02", 2_100, cats.resto.id, accs.courant.id),
      transfer("2026-09-03", 50_000, accs.courant.id, accs.livret.id),
    ];
    expect(tagTotals(ops)).toEqual({ inflow: 1_999, outflow: 2_100, net: -101, transfers: 1 });
  });
});

describe("ordre des comptes (décision 49)", () => {
  it("positions d'abord, puis les comptes sans position dans l'ordre d'arrivée ; seules les lignes qui changent sont écrites", () => {
    const data = base();
    const ids = data.collections.accounts.map((a) => a.id);
    expect(orderAccounts(data.collections.accounts).map((a) => a.id)).toEqual(ids);
    const wanted = [ids[2]!, ids[0]!, ids[3]!, ids[1]!];
    const changes = reorderAccounts(data, wanted, NOW);
    const after = applyChanges(data, changes);
    expect(orderAccounts(after.collections.accounts).map((a) => a.id)).toEqual(wanted);
    expect(reorderAccounts(after, wanted, NOW + 1)).toEqual({});
    // Deux positions égales (réordonnées en même temps sur deux appareils) : départage par nom.
    const tie = applyChanges(after, { accounts: after.collections.accounts.map((a) => ({ ...a, position: 1 })) });
    const names = orderAccounts(tie.collections.accounts).map((a) => a.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y, "fr")));
  });
});
