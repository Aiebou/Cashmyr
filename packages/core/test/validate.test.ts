import { describe, expect, it } from "vitest";
import { applyChanges, assertValidDataset, tombstone, validateDataset, validateRecord, ValidationError } from "../src";
import { eur, expense, income, recurrence, transfer, world } from "./fixtures";

const { cats, accs, build } = world();
const valid = build({
  operations: [
    income("2026-09-01", eur(3000), cats.salaire.id, accs.courant.id),
    expense("2026-09-02", eur(80), cats.courses.id, accs.courant.id),
    transfer("2026-09-03", eur(500), accs.courant.id, accs.livret.id),
  ],
});

const issuesWith = (patch: Parameters<typeof applyChanges>[1]) => validateDataset(applyChanges(valid, patch));

describe("validation", () => {
  it("accepte un jeu cohérent, et un jeu vide", () => {
    expect(validateDataset(valid)).toEqual([]);
    expect(validateDataset(build())).toEqual([]);
  });

  it("refuse tout flottant en centimes", () => {
    const op = expense("2026-09-04", 12.5, cats.courses.id, accs.courant.id);
    expect(issuesWith({ operations: [op] }).join()).toMatch(/amount invalide : 12\.5/);
    expect(issuesWith({ accounts: [{ ...accs.pea, opening: 0.1 }] }).join()).toMatch(/opening invalide/);
  });

  it("une catégorie de dépense doit avoir une enveloppe", () => {
    const { bucket, ...noBucket } = cats.loyer;
    void bucket;
    expect(issuesWith({ categories: [noBucket] }).join()).toMatch(/enveloppe/);
  });

  it("forme des opérations selon leur type", () => {
    const tx = { ...transfer("2026-09-05", eur(1), accs.courant.id, accs.courant.id) };
    expect(issuesWith({ operations: [tx] }).join()).toMatch(/source et destination identiques/);
    const txWithCategory = { ...transfer("2026-09-05", eur(1), accs.courant.id, accs.pea.id), categoryId: cats.pea.id };
    expect(issuesWith({ operations: [txWithCategory] }).join()).toMatch(/ni catégorie/);
    const { accountId, ...noAccount } = expense("2026-09-05", eur(1), cats.courses.id, accs.courant.id);
    void accountId;
    expect(issuesWith({ operations: [noAccount] }).join()).toMatch(/exige une catégorie et un compte/);
  });

  it("vérifie les références et la nature des catégories", () => {
    expect(issuesWith({ operations: [expense("2026-09-05", eur(1), cats.courses.id, "inconnu")] }).join()).toMatch(
      /accountId : référence introuvable/,
    );
    expect(issuesWith({ operations: [expense("2026-09-05", eur(1), cats.salaire.id, accs.courant.id)] }).join()).toMatch(
      /catégorie de type « in » sur une opération « out »/,
    );
  });

  it("une pierre tombale peut référencer une ligne purgée", () => {
    const orphan = tombstone(expense("2026-09-05", eur(1), cats.courses.id, "purgé"), 10);
    expect(issuesWith({ operations: [orphan] })).toEqual([]);
  });

  it("refuse les champs inconnus et les identifiants en double", () => {
    expect(issuesWith({ operations: [{ ...valid.collections.operations[0]!, extra: 1 } as never] }).join()).toMatch(/champ inconnu/);
    const dup = { ...valid, collections: { ...valid.collections, accounts: [...valid.collections.accounts, accs.courant] } };
    expect(validateDataset(dup).join()).toMatch(/identifiant en double/);
  });

  it("répartition : somme exactement 100 %", () => {
    const bad = { ...valid, preferences: { ...valid.preferences, splits: { besoin: 5000, envie: 3000, invest: 1999 } } };
    expect(validateDataset(bad).join()).toMatch(/somme doit valoir 10000/);
  });

  it("récurrence : jour 1–31 et fin après le début", () => {
    const r = recurrence({ type: "out", amount: eur(1), dayOfMonth: 28, startMonth: "2026-09", categoryId: cats.loyer.id, accountId: accs.courant.id });
    expect(issuesWith({ recurrences: [r] })).toEqual([]);
    expect(issuesWith({ recurrences: [{ ...r, dayOfMonth: 32 }] }).join()).toMatch(/dayOfMonth invalide/);
    expect(issuesWith({ recurrences: [{ ...r, endMonth: "2026-08" }] }).join()).toMatch(/fin avant le début/);
  });

  it("assertValidDataset lève une erreur lisible", () => {
    expect(() => assertValidDataset({})).toThrow(ValidationError);
  });

  it("valide une ligne avant écriture, contre le jeu où elle entre", () => {
    const op = expense("2026-09-05", eur(1), cats.courses.id, accs.courant.id);
    expect(validateRecord("operations", op, valid)).toEqual([]);
    expect(validateRecord("operations", { ...op, goalId: "absent" }, valid).join()).toMatch(/goalId : référence introuvable/);
  });
});
