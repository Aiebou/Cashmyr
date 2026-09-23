import { indexOf } from "../dataset";
import type { Account, Cents, Dataset, Day, Operation, Role } from "../model";
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
  for (const account of data.collections.accounts) {
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
