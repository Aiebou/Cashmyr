import { indexOf } from "../dataset";
import type { Account, Cents, Changes, Dataset, Day, Operation, Role } from "../model";
import { touch } from "../records";
import { isSavingRole } from "./month";

export type AccountFigures = {
  accountId: string;
  opening: Cents;
  /** Revenus crédités et transferts reçus. */
  inflow: Cents;
  /** Dépenses débitées et transferts émis. */
  outflow: Cents;
  /** Capital net injecté : jamais une valeur de marché. */
  balance: Cents;
  declaredValue: Cents | null;
  /** Valeur déclarée − capital injecté, affiché seulement. */
  declaredGap: Cents | null;
};

type Flow = { inflow: Cents; outflow: Cents };

function addFlow(flows: Map<string, Flow>, op: Operation): void {
  const credit = (id: string | undefined) => {
    if (!id) return;
    const f = flows.get(id) ?? { inflow: 0, outflow: 0 };
    f.inflow += op.amount;
    flows.set(id, f);
  };
  const debit = (id: string | undefined) => {
    if (!id) return;
    const f = flows.get(id) ?? { inflow: 0, outflow: 0 };
    f.outflow += op.amount;
    flows.set(id, f);
  };
  if (op.type === "in") credit(op.accountId);
  else if (op.type === "out") debit(op.accountId);
  else {
    credit(op.toAccountId);
    debit(op.fromAccountId);
  }
}

/** Entrées et sorties par compte sur les opérations datées de `from` à `to` inclus. */
export function accountFlows(data: Dataset, from: Day | null, to: Day): Map<string, Flow> {
  const flows = new Map<string, Flow>();
  for (const op of indexOf(data).liveOps) {
    if (op.date > to || (from !== null && op.date < from)) continue;
    addFlow(flows, op);
  }
  return flows;
}

/** Soldes de tous les comptes (supprimés compris) au soir du jour `asOf`. */
export function accountFigures(data: Dataset, asOf: Day): Map<string, AccountFigures> {
  const flows = accountFlows(data, null, asOf);
  const out = new Map<string, AccountFigures>();
  for (const account of data.collections.accounts) {
    const f = flows.get(account.id) ?? { inflow: 0, outflow: 0 };
    const balance = account.opening + f.inflow - f.outflow;
    const declared = account.declaredValue ?? null;
    out.set(account.id, {
      accountId: account.id,
      opening: account.opening,
      inflow: f.inflow,
      outflow: f.outflow,
      balance,
      declaredValue: declared,
      declaredGap: declared === null ? null : declared - balance,
    });
  }
  return out;
}

/**
 * Comptes dans l'ordre choisi (décision 49) : d'abord ceux qui ont une position, dans l'ordre
 * croissant (à égalité, par nom puis identifiant, pour que tous les appareils s'accordent) ;
 * puis les autres, dans l'ordre d'arrivée.
 */
export function orderAccounts<T extends Pick<Account, "id" | "name" | "position">>(accounts: readonly T[]): T[] {
  const placed = accounts
    .filter((a) => a.position !== undefined)
    .sort((a, b) => a.position! - b.position! || a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id));
  return [...placed, ...accounts.filter((a) => a.position === undefined)];
}

/** Nouvel ordre des comptes : positions 1, 2, 3… dans l'ordre donné ; seules les lignes qui changent sont écrites. */
export function reorderAccounts(data: Dataset, orderedIds: readonly string[], now: number): Changes {
  const byId = new Map(data.collections.accounts.map((a) => [a.id, a]));
  const accounts: Account[] = [];
  orderedIds.forEach((id, i) => {
    const account = byId.get(id);
    if (account && account.deletedAt === null && account.position !== i + 1) accounts.push(touch(account, { position: i + 1 }, now));
  });
  return accounts.length > 0 ? { accounts } : {};
}

/** Date de référence d'une année : le 31/12, ou aujourd'hui pour l'année en cours ou à venir. */
export const asOfForYear = (year: number, today: Day): Day => {
  const end = `${String(year).padStart(4, "0")}-12-31`;
  return end < today ? end : today;
};

export type AccountGroup = {
  total: Cents;
  byAccount: { account: Account; balance: Cents }[];
  /** Somme des écarts des comptes qui ont une valeur déclarée ; null si aucun. */
  declaredGap: Cents | null;
};

function group(data: Dataset, asOf: Day, keep: (role: Role) => boolean): AccountGroup {
  const figures = accountFigures(data, asOf);
  const byAccount: AccountGroup["byAccount"] = [];
  let total = 0;
  let gap: Cents | null = null;
  for (const account of orderAccounts(data.collections.accounts)) {
    if (account.deletedAt !== null || !keep(account.role)) continue;
    const f = figures.get(account.id);
    if (!f) continue;
    byAccount.push({ account, balance: f.balance });
    total += f.balance;
    if (f.declaredGap !== null) gap = (gap ?? 0) + f.declaredGap;
  }
  return { total, byAccount, declaredGap: gap };
}

/** Total épargne et placements : comptes de rôle « epargne » et « invest ». */
export const savingsOverview = (data: Dataset, asOf: Day): AccountGroup => group(data, asOf, isSavingRole);

/** Comptes courants. */
export const currentAccountsOverview = (data: Dataset, asOf: Day): AccountGroup =>
  group(data, asOf, (role) => role === "courant");

/** Tous les comptes vivants, pour « Total suivi ». */
export const allAccountsOverview = (data: Dataset, asOf: Day): AccountGroup => group(data, asOf, () => true);

// ── Valeur déclarée dans les totaux (décisions 42 à 44) ────────────────────

/** Comptes dont la valeur fluctue : épargne, placement, autre. Leur valeur déclarée peut entrer dans un total. */
export const isFluctuatingRole = (role: Role): boolean => role !== "courant";

/**
 * Valeur déclarée d'un compte utilisable au soir de `asOf` (décision 43) : déclarée ce jour-là ou
 * avant. Une valeur sans date (reprise de l'ancienne application) ne vaut que pour aujourd'hui.
 * Toujours null pour un compte courant.
 */
export function declaredAsOf(account: Account, asOf: Day, today: Day): Cents | null {
  if (!isFluctuatingRole(account.role) || account.declaredValue === undefined) return null;
  return (account.declaredAt ?? today) <= asOf ? account.declaredValue : null;
}

/**
 * Total affiché par le bandeau (décision 42) : soldes des comptes courants et valeurs déclarées
 * des autres (par défaut), tout en capital injecté, ou capital injecté hors comptes courants.
 */
export type WorthMode = "declared" | "injected" | "injectedOutsideCurrent";

export type AccountWorth = {
  account: Account;
  /** Capital injecté. */
  balance: Cents;
  /** Valeur déclarée retenue à cette date ; null pour un compte courant ou sans valeur déclarée à cette date. */
  declared: Cents | null;
  /** Ce que le compte pèse dans le total du mode choisi. */
  value: Cents;
};

export type WorthOverview = {
  mode: WorthMode;
  total: Cents;
  /** Comptes vivants qui entrent dans ce total, dans l'ordre des comptes. */
  byAccount: AccountWorth[];
  /** Répartition du total : comptes courants, épargne et placements, autres comptes. */
  current: Cents;
  savings: Cents;
  others: Cents;
  /** Capital injecté hors comptes courants, quel que soit le mode. */
  injectedOutsideCurrent: Cents;
  /** Mode « declared » : comptes fluctuants comptés pour leur capital injecté, faute de valeur déclarée à cette date. */
  undeclared: number;
};

export function worthOverview(data: Dataset, asOf: Day, today: Day, mode: WorthMode): WorthOverview {
  const figures = accountFigures(data, asOf);
  const out: WorthOverview = {
    mode,
    total: 0,
    byAccount: [],
    current: 0,
    savings: 0,
    others: 0,
    injectedOutsideCurrent: 0,
    undeclared: 0,
  };
  for (const account of orderAccounts(data.collections.accounts)) {
    if (account.deletedAt !== null) continue;
    const balance = figures.get(account.id)?.balance ?? 0;
    const fluctuating = isFluctuatingRole(account.role);
    if (fluctuating) out.injectedOutsideCurrent += balance;
    if (mode === "injectedOutsideCurrent" && !fluctuating) continue;
    const declared = declaredAsOf(account, asOf, today);
    const value = mode === "declared" && declared !== null ? declared : balance;
    if (mode === "declared" && fluctuating && declared === null) out.undeclared += 1;
    out.byAccount.push({ account, balance, declared, value });
    out.total += value;
    if (account.role === "courant") out.current += value;
    else if (isSavingRole(account.role)) out.savings += value;
    else out.others += value;
  }
  return out;
}
