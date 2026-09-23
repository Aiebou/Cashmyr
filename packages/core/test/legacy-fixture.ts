import { DEFAULT_CATEGORIES } from "../src";

/**
 * Export synthétique au format de l'ancienne application (`settings.v` = 2) : les
 * catégories par défaut, une catégorie ajoutée, quatre comptes, deux objectifs, deux
 * dettes et trois mois. Données inventées : jamais celles d'une vraie personne.
 */
export function legacyExport() {
  const item = (id: string, d: string, t: "in" | "out", amt: number, cat: string, acc: string, note = "") => ({
    id,
    d,
    t,
    amt,
    cat,
    acc,
    note,
  });
  return {
    settings: {
      v: 2,
      cats: [
        ...DEFAULT_CATEGORIES.map((c) => ({ id: c.legacy, kind: c.kind, name: c.name, ...(c.bucket ? { bucket: c.bucket } : {}) })),
        { id: "k3x9pw2mzq1a", kind: "out", name: "Animaux", bucket: "besoin" },
      ],
      accounts: [
        { id: "a1", name: "Compte courant", opening: 1520.35, role: "courant", safety: false },
        { id: "a2", name: "Livret A", opening: 3000, role: "epargne", safety: true },
        { id: "a3", name: "PEA", opening: 0, role: "invest", safety: false },
        { id: "a4", name: "Compte joint", opening: -120.1, role: "autre", safety: false },
      ],
      splits: { besoin: 0.5, envie: 0.3, invest: 0.2 },
      basis: "month",
      window: 6,
      safety: { amount: 0, hidden: false, mode: "months", months: 3 },
      goals: [
        { accounts: ["a2"], due: "2027-05-15", hidden: false, id: "g8f2kqz0v1ta", name: "Voyage", source: "tagged", target: 3000 },
        { accounts: ["a2", "a3"], due: "2030-01-01", hidden: true, id: "p0w7za4mq2rd", name: "Apport", source: "account", target: 25000.5 },
      ],
      debts: [
        {
          accountId: "a1",
          archived: false,
          categoryId: "d16",
          creditor: "Banque",
          dayOfMonth: 14,
          direction: "owe",
          hidden: false,
          id: "dx1r8m2k0qwe",
          installmentAmount: 180.25,
          installmentCount: 24,
          mode: "installments",
          name: "Prêt auto",
          paidManual: 360.5,
          pinned: false,
          principal: 4326,
          recurrenceId: null,
          settled: false,
          startDate: "2026-06-14",
        },
        {
          accountId: null,
          archived: false,
          categoryId: null,
          creditor: "Sam",
          dayOfMonth: 1,
          direction: "lent",
          hidden: false,
          id: "dx2b5n7c3ptu",
          installmentAmount: 0,
          installmentCount: 0,
          mode: "free",
          name: "Avance",
          paidManual: 0,
          pinned: true,
          principal: 200,
          recurrenceId: null,
          settled: false,
          startDate: "2026-08-01",
        },
      ] as Record<string, unknown>[],
      catColors: {} as Record<string, unknown>,
      bucketColors: {} as Record<string, unknown>,
      dashOrder: ["goals", "debts", "stats", "months", "savings", "cats"],
      recurring: [] as unknown[],
    },
    months: {
      "2026-07": {
        items: [
          item("o1", "2026-07-01", "in", 2400, "r1", "a1", "Paie"),
          item("o2", "2026-07-03", "out", 850, "d8", "a1"),
          item("o3", "2026-07-09", "out", 64.9, "d12", "a1", "Marché"),
          // 0,1 + 0,2 ne fait pas 0,3 en flottant : la vérification doit s'en accommoder.
          item("o4", "2026-07-12", "out", 0.1, "d18", "a1"),
          item("o5", "2026-07-12", "out", 0.2, "d18", "a1"),
          item("o6", "2026-07-20", "out", 150, "d25", "a2"),
          item("o7", "2026-07-22", "out", 42.3, "k3x9pw2mzq1a", "a4"),
        ] as Record<string, unknown>[],
        skips: [] as unknown[],
      },
      "2026-08": {
        items: [
          item("o8", "2026-08-01", "in", 2400, "r1", "a1"),
          item("o9", "2026-08-15", "in", 35.5, "r2", "a1"),
          item("o10", "2026-08-18", "out", 120.45, "d22", "a1", "Train"),
          item("o11", "2026-08-28", "out", 300, "d26", "a3"),
        ] as Record<string, unknown>[],
        skips: [] as unknown[],
      },
      "2026-09": { items: [] as Record<string, unknown>[], skips: [] as unknown[] },
    } as Record<string, { items: Record<string, unknown>[]; skips: unknown[] }>,
  };
}

export type LegacyFixture = ReturnType<typeof legacyExport>;
