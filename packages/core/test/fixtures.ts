import {
  defaultBudgetId,
  defaultBudgets,
  defaultTypes,
  emptyDataset,
  PRECAUTION_TYPE_ID,
  type Account,
  type Bucket,
  type Category,
  type Collections,
  type Dataset,
  type Debt,
  type Goal,
  type GoalStep,
  type Operation,
  type Preferences,
  type Recurrence,
  type Role,
} from "../src";

/** 23/09/2026 à midi, heure fixe de tous les tests. */
export const TODAY = "2026-09-23";
export const NOW = Date.UTC(2026, 8, 23, 12);
export const DAY = 86_400_000;

/** Euros → centimes, pour écrire les tests lisiblement. */
export const eur = (n: number) => Math.round(n * 100);

let counter = 0;
const id = (prefix: string) => `${prefix}-${++counter}`;
const meta = (prefix: string, updatedAt = 1) => ({ id: id(prefix), updatedAt, deletedAt: null });

/** Catégorie ; une dépense va dans le budget par défaut qui remplace l'usage donné. */
export function category(name: string, kind: "in" | "out", bucket?: Bucket): Category {
  return { ...meta("cat"), name, kind, ...(bucket ? { budgetId: defaultBudgetId(bucket) } : {}), color: 0 };
}

export function account(name: string, role: Role, extra: Partial<Account> = {}): Account {
  return { ...meta("acc"), name, role, opening: 0, color: 0, ...extra };
}

/** Rattaché à l'épargne de précaution, en type principal. */
export const precaution = { typeIds: [PRECAUTION_TYPE_ID] };

export function income(date: string, amount: number, categoryId: string, accountId: string, extra: Partial<Operation> = {}): Operation {
  return { ...meta("op"), date, amount, type: "in", note: "", categoryId, accountId, ...extra };
}

export function expense(date: string, amount: number, categoryId: string, accountId: string, extra: Partial<Operation> = {}): Operation {
  return { ...meta("op"), date, amount, type: "out", note: "", categoryId, accountId, ...extra };
}

export function transfer(date: string, amount: number, fromAccountId: string, toAccountId: string, extra: Partial<Operation> = {}): Operation {
  return { ...meta("op"), date, amount, type: "tx", note: "", fromAccountId, toAccountId, ...extra };
}

export function goal(name: string, extra: Partial<Goal> = {}): Goal {
  return {
    ...meta("goal"),
    name,
    target: 0,
    targetMode: "manual",
    source: "tagged",
    accountIds: [],
    due: null,
    hidden: false,
    pinned: false,
    done: false,
    doneAt: null,
    archived: false,
    position: 0,
    color: 0,
    ...extra,
  };
}

export function step(goalId: string, label: string, amount: number, done: boolean, position: number): GoalStep {
  return { ...meta("step"), goalId, label, amount, done, position };
}

export function debt(extra: Partial<Debt> = {}): Debt {
  return {
    ...meta("debt"),
    name: "Prêt auto",
    creditor: "Banque",
    direction: "owe",
    principal: 0,
    paidManual: 0,
    mode: "installments",
    installmentAmount: eur(300),
    installmentCount: 5,
    startDate: "2026-10-10",
    dayOfMonth: 10,
    categoryId: null,
    accountId: null,
    recurrenceId: null,
    hidden: false,
    pinned: false,
    settled: false,
    settledAt: null,
    archived: false,
    position: 0,
    color: 0,
    ...extra,
  };
}

export function recurrence(extra: Partial<Recurrence> & Pick<Recurrence, "type" | "amount" | "dayOfMonth" | "startMonth">): Recurrence {
  return { ...meta("rec"), label: "Récurrence", endMonth: null, active: true, ...extra };
}

/**
 * Jeu de données de test. Dès qu'il a des catégories ou des comptes, il reçoit les budgets et les
 * types par défaut, comme tout profil non vide au format 3, sauf s'ils sont fournis.
 */
export function dataset(parts: Partial<Collections>, prefs: Partial<Preferences> = {}): Dataset {
  const base = emptyDataset();
  const defaults = (parts.categories?.length ?? 0) > 0 || (parts.accounts?.length ?? 0) > 0;
  return {
    ...base,
    collections: {
      ...base.collections,
      ...(defaults ? { budgets: defaultBudgets(), types: defaultTypes() } : {}),
      ...parts,
    },
    preferences: { ...base.preferences, ...prefs },
  };
}

/** Un petit monde : catégories et comptes usuels. */
export function world() {
  const cats = {
    salaire: category("Salaire", "in"),
    secondaire: category("Revenu secondaire", "in"),
    loyer: category("Loyer et charges", "out", "besoin"),
    courses: category("Courses", "out", "besoin"),
    resto: category("Restaurants et bars", "out", "envie"),
    voyage: category("Voyages", "out", "envie"),
    pea: category("PEA et ETF", "out", "invest"),
  };
  const accs = {
    courant: account("Compte courant", "courant"),
    livret: account("Livret A", "epargne", precaution),
    pea: account("PEA", "invest"),
    especes: account("Espèces", "autre"),
  };
  const build = (parts: Partial<Collections> = {}, prefs: Partial<Preferences> = {}) =>
    dataset({ categories: Object.values(cats), accounts: Object.values(accs), ...parts }, prefs);
  return { cats, accs, build };
}
