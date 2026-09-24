import { DEFAULT_CATEGORIES } from "../src";

type Item = Record<string, unknown>;

/**
 * Export synthétique au format de l'ancienne application (`settings.v` = 2), tel que
 * l'écrit son code : catégories par défaut et une ajoutée, quatre comptes dont un avec
 * valeur déclarée, un objectif à postes et un ancien objectif sans les champs récents,
 * trois dettes, trois récurrences (dépense, prélèvement de dette, transfert), un mois
 * annulé, des opérations rattachées, des couleurs choisies. Données inventées.
 */
export function legacyExport() {
  const item = (id: string, d: string, t: "in" | "out", amt: number, cat: string, acc: string, extra: Item = {}): Item => ({
    id,
    d,
    t,
    amt,
    cat,
    acc,
    note: "",
    ...extra,
  });
  const tx = (id: string, d: string, amt: number, from: string, to: string, extra: Item = {}): Item => ({
    id,
    d,
    t: "tx",
    amt,
    from,
    to,
    note: "",
    ...extra,
  });
  return {
    settings: {
      v: 2,
      cats: [
        ...DEFAULT_CATEGORIES.map((c) => ({ id: c.legacy, kind: c.kind, name: c.name, ...(c.bucket ? { bucket: c.bucket } : {}) })),
        { id: "k3x9pw2mzq1a", kind: "out", name: "Animaux", bucket: "besoin" },
      ] as Item[],
      accounts: [
        { id: "a1", name: "Compte courant", opening: 1520.35, role: "courant", safety: false },
        { id: "a2", name: "Livret A", opening: 3000, role: "epargne", safety: true, mv: 3100.5 },
        { id: "a3", name: "PEA", opening: 0, role: "invest", safety: false },
        { id: "a4", name: "Compte joint", opening: -120.1, role: "autre", safety: false },
      ] as Item[],
      splits: { besoin: 0.5, envie: 0.3, invest: 0.2 },
      basis: "month",
      window: 6,
      safety: { amount: 0, hidden: false, mode: "months", months: 3, pinned: false } as Item,
      goals: [
        {
          id: "g8f2kqz0v1ta",
          name: "Voyage",
          target: 3000,
          source: "tagged",
          accounts: [],
          due: null,
          hidden: false,
          pinned: true,
          done: false,
          archived: false,
          targetMode: "steps",
          steps: [
            { id: "s1", label: "Billets", amount: 900, done: true },
            { id: "s2", label: "Hôtel", amount: 650.5, done: false },
          ],
        },
        // Objectif antérieur aux postes : ni pinned, ni done, ni archived, ni targetMode, ni steps.
        { id: "p0w7za4mq2rd", name: "Apport", target: 25000.5, source: "account", accounts: ["a2", "a3"], due: "2030-01-01", hidden: true },
      ] as Item[],
      debts: [
        {
          id: "dx1r8m2k0qwe",
          name: "Prêt auto",
          creditor: "Banque",
          direction: "owe",
          principal: 4326,
          paidManual: 360.5,
          mode: "installments",
          installmentAmount: 180.25,
          installmentCount: 24,
          startDate: "2026-06-14",
          dayOfMonth: 14,
          categoryId: "d16",
          accountId: "a1",
          recurrenceId: "rc2",
          hidden: false,
          pinned: false,
          settled: false,
          archived: false,
        },
        {
          id: "dx2b5n7c3ptu",
          name: "Avance",
          creditor: "",
          direction: "lent",
          principal: 200,
          paidManual: 0,
          mode: "free",
          installmentAmount: 0,
          installmentCount: 0,
          startDate: "2026-08-01",
          dayOfMonth: 1,
          categoryId: null,
          accountId: null,
          recurrenceId: null,
          hidden: false,
          pinned: true,
          settled: false,
          archived: false,
        },
        {
          // Créée en « je dois », basculée en « on me doit » : sa catégorie est restée une dépense.
          id: "dx3m1v8q4hzk",
          name: "Dépannage",
          creditor: "Alex",
          direction: "lent",
          principal: 150,
          paidManual: 150,
          mode: "free",
          installmentAmount: 0,
          installmentCount: 0,
          startDate: "2026-05-02",
          dayOfMonth: 2,
          categoryId: "d16",
          accountId: "a1",
          recurrenceId: null,
          hidden: false,
          pinned: false,
          settled: true,
          settledAt: "2026-08-20",
          archived: true,
        },
      ] as Item[],
      catColors: { r1: "#336699" } as Record<string, unknown>,
      bucketColors: { envie: "#AA5500" } as Record<string, unknown>,
      dashOrder: ["goals", "debts", "stats", "months", "savings", "cats"],
      recurring: [
        { id: "rc1", label: "Loyer", amt: 850, t: "out", cat: "d8", acc: "a1", day: 3, start: "2026-07", end: null, active: true },
        {
          id: "rc2",
          label: "Prêt auto",
          amt: 180.25,
          t: "out",
          cat: "d16",
          acc: "a1",
          debt: "dx1r8m2k0qwe",
          day: 14,
          start: "2026-07",
          end: "2028-05",
          active: true,
        },
        // Sans `active` : active, comme dans l'ancienne application.
        { id: "rc3", label: "Épargne", amt: 150, t: "tx", from: "a1", to: "a2", goal: "g8f2kqz0v1ta", day: 5, start: "2026-07", end: null },
      ] as Item[],
    },
    months: {
      "2026-07": {
        items: [
          item("o1", "2026-07-01", "in", 2400, "r1", "a1", { note: "Paie" }),
          item("o2", "2026-07-03", "out", 850, "d8", "a1", { note: "Loyer", rec: "rc1" }),
          item("o3", "2026-07-09", "out", 64.9, "d12", "a1", { note: "Marché" }),
          // 0,1 + 0,2 ne fait pas 0,3 en flottant : la vérification doit s'en accommoder.
          item("o4", "2026-07-12", "out", 0.1, "d18", "a1"),
          item("o5", "2026-07-12", "out", 0.2, "d18", "a1"),
          item("o6", "2026-07-20", "out", 150, "d25", "a2", { goal: "g8f2kqz0v1ta" }),
          item("o7", "2026-07-22", "out", 42.3, "k3x9pw2mzq1a", "a4"),
          tx("o8", "2026-07-05", 150, "a1", "a2", { note: "Épargne", rec: "rc3", goal: "g8f2kqz0v1ta" }),
          item("o9", "2026-07-14", "out", 180.25, "d16", "a1", { note: "Prêt auto", rec: "rc2", debt: "dx1r8m2k0qwe" }),
        ],
        skips: [] as unknown[],
      },
      "2026-08": {
        items: [
          item("o10", "2026-08-01", "in", 2400, "r1", "a1"),
          item("o11", "2026-08-15", "in", 35.5, "r2", "a1"),
          item("o12", "2026-08-18", "out", 120.45, "d22", "a1", { note: "Train" }),
          item("o13", "2026-08-28", "out", 300, "d26", "a3"),
          tx("o14", "2026-08-05", 150, "a1", "a2", { note: "Épargne", rec: "rc3", goal: "g8f2kqz0v1ta" }),
          item("o15", "2026-08-14", "out", 180.25, "d16", "a1", { note: "Prêt auto", rec: "rc2", debt: "dx1r8m2k0qwe" }),
          // Versement ponctuel de la dette, hors récurrence.
          item("o16", "2026-08-20", "out", 100, "d16", "a1", { note: "Versement — Prêt auto", debt: "dx1r8m2k0qwe" }),
          // Tx vers un compte courant depuis l'épargne : la mise de côté du mois baisse.
          tx("o17", "2026-08-25", 80, "a2", "a1"),
        ],
        // Loyer d'août annulé.
        skips: ["rc1"] as unknown[],
      },
      "2026-09": { items: [] as Item[], skips: [] as unknown[] },
    } as Record<string, { items: Item[]; skips: unknown[] }>,
  };
}

export type LegacyFixture = ReturnType<typeof legacyExport>;
