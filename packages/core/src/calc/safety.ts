import { indexOf } from "../dataset";
import { PRECAUTION_TYPE_ID } from "../defaults";
import type { Account, BudgetType, Cents, Dataset, Day, Month, Operation } from "../model";
import { roundDiv } from "../money";
import { nextStamp } from "../records";
import { accountFigures } from "./accounts";
import { averageSpending, referenceMonth } from "./averages";

/** Effet d'une opération sur le solde d'un compte : + ce qui entre, − ce qui sort, 0 s'il n'est pas concerné. */
function effectOn(op: Operation, accountId: string): Cents {
  if (op.type === "in") return op.accountId === accountId ? op.amount : 0;
  if (op.type === "out") return op.accountId === accountId ? -op.amount : 0;
  return (op.toAccountId === accountId ? op.amount : 0) - (op.fromAccountId === accountId ? op.amount : 0);
}

/**
 * Parts des types dans chaque compte vivant, au soir du jour `asOf`, en capital injecté (décision 78).
 * Un type rattaché au compte, autre que le principal, a pour part ce que lui apportent les
 * opérations rattachées à lui sur ce compte, moins ce qu'elles en retirent. Le type principal
 * (le premier) prend le reste, solde de départ compris. Une opération rattachée à un type que
 * le compte ne porte pas, ou à son type principal, revient au principal.
 */
export function typeShares(data: Dataset, asOf: Day): Map<string, Map<string, Cents>> {
  const figures = accountFigures(data, asOf);
  const ops = indexOf(data).liveOps.filter((op) => op.typeId !== undefined && op.date <= asOf);
  const out = new Map<string, Map<string, Cents>>();
  for (const account of data.collections.accounts) {
    const [principal, ...others] = account.typeIds ?? [];
    if (account.deletedAt !== null || principal === undefined) continue;
    const shares = new Map<string, Cents>(others.map((id) => [id, 0]));
    for (const op of ops) {
      if (shares.has(op.typeId!)) shares.set(op.typeId!, shares.get(op.typeId!)! + effectOn(op, account.id));
    }
    const reserved = [...shares.values()].reduce((sum, v) => sum + v, 0);
    out.set(account.id, new Map([[principal, (figures.get(account.id)?.balance ?? 0) - reserved], ...shares]));
  }
  return out;
}

export type TypeStatus = {
  typeId: string;
  /** Comptes vivants rattachés au type, avec la part qui lui revient. */
  accounts: { account: Account; share: Cents }[];
  constituted: Cents;
  /** Dépenses moyennes des budgets de dépense, même règle et même fenêtre que le revenu moyen. */
  averageSpending: Cents | null;
  averageMonths: Month[];
  /** null sans objectif, ou en mode « mois » tant qu'aucune moyenne n'existe. */
  objective: Cents | null;
  /** constituée ÷ dépenses moyennes, arrondi à une décimale ; null si la moyenne est absente ou nulle. */
  capacityMonths: number | null;
  reached: boolean | null;
};

/** Ce qu'un type a constitué et où il en est de son objectif (décision 79). */
export function typeStatus(data: Dataset, typeId: string, asOf: Day, today: Day): TypeStatus {
  const shares = typeShares(data, asOf);
  const accounts = data.collections.accounts
    .filter((a) => a.deletedAt === null && shares.get(a.id)?.has(typeId))
    .map((account) => ({ account, share: shares.get(account.id)!.get(typeId)! }));
  const constituted = accounts.reduce((sum, a) => sum + a.share, 0);

  const goal = indexOf(data).types.get(typeId)?.objective ?? null;
  const avg = averageSpending(data, referenceMonth(asOf, today), data.preferences.averageWindow);
  const objective =
    goal === null ? null : goal.mode === "amount" ? goal.amount : avg.value === null ? null : goal.months * avg.value;
  const capacityMonths = avg.value === null || avg.value <= 0 ? null : roundDiv(constituted * 10, avg.value) / 10;

  return {
    typeId,
    accounts,
    constituted,
    averageSpending: avg.value,
    averageMonths: avg.months,
    objective,
    capacityMonths,
    reached: objective === null ? null : constituted >= objective,
  };
}

export type SafetyStatus = TypeStatus & {
  /** Comptes rattachés à l'épargne de précaution. */
  accountIds: string[];
};

/** L'épargne de précaution : le type « Épargne de précaution » (décision 79). */
export function safetyStatus(data: Dataset, asOf: Day, today: Day): SafetyStatus {
  const status = typeStatus(data, PRECAUTION_TYPE_ID, asOf, today);
  return { ...status, accountIds: status.accounts.map((a) => a.account.id) };
}

/** Le type « Épargne de précaution », s'il est vivant : son objectif remplace l'ancien réglage. */
export function precautionType(data: Dataset): BudgetType | undefined {
  const type = indexOf(data).types.get(PRECAUTION_TYPE_ID);
  return type && type.deletedAt === null ? type : undefined;
}

/** Vrai si le compte entre dans l'épargne de précaution. */
export const isPrecautionAccount = (account: Pick<Account, "typeIds">): boolean => account.typeIds?.includes(PRECAUTION_TYPE_ID) ?? false;

/**
 * Coche ou décoche un compte comme épargne de précaution, comme l'ancienne case : coché, tout son
 * solde y entre, la précaution devenant son type principal ; décoché, il la quitte.
 */
export function setPrecautionAccount(account: Account, on: boolean, now: number): Account {
  const others = (account.typeIds ?? []).filter((id) => id !== PRECAUTION_TYPE_ID);
  const typeIds = on ? [PRECAUTION_TYPE_ID, ...others] : others;
  const { typeIds: _old, ...rest } = account;
  return { ...rest, ...(typeIds.length > 0 ? { typeIds } : {}), updatedAt: nextStamp(now, account) };
}
