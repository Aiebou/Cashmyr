import { accountFigures } from "../calc/accounts";
import { debtPaid } from "../calc/debts";
import { goalProgress } from "../calc/goals";
import { monthAggregates } from "../calc/month";
import { legacyCategoryId } from "../defaults";
import { legacyId } from "../ids";
import type { Bucket, Cents, Dataset, Day, Month } from "../model";
import { formatCents } from "../money";
import type { LegacyExport } from "./legacy";

/**
 * Vérification croisée de la reprise (§7). Un calculateur minimal, indépendant de `core`,
 * lit l'ancien format en euros et recalcule les totaux par mois, les soldes par compte,
 * l'avancement des objectifs et le réglé des dettes. Chaque résultat est comparé au
 * centime près avec celui de `core` sur les données converties.
 */

export type LegacyChecked = { months: number; accounts: number; goals: number; debts: number };

/** Toutes les opérations comptent, quelle que soit leur date. */
const ALL_TIME: Day = "9999-12-31";

type MonthTotals = { count: number; income: number; needs: number; wants: number; saved: number };

/** Le calculateur de l'ancien format : euros décimaux, règles du cahier des charges. */
function legacyFigures(file: LegacyExport) {
  const bucketOf = new Map(file.cats.map((c) => [c.id, c.bucket]));
  const months = new Map<Month, MonthTotals>(
    file.months.map((m) => [m, { count: 0, income: 0, needs: 0, wants: 0, saved: 0 }]),
  );
  const balances = new Map(file.accounts.map((a) => [a.id, a.opening]));
  const move = (account: string, euros: number) => balances.set(account, (balances.get(account) ?? 0) + euros);

  for (const it of file.items) {
    const t = months.get(it.month)!;
    t.count++;
    if (it.t === "in") {
      t.income += it.amt;
      move(it.acc, it.amt);
    } else {
      const bucket = bucketOf.get(it.cat) as Bucket;
      if (bucket === "besoin") t.needs += it.amt;
      else if (bucket === "envie") t.wants += it.amt;
      else t.saved += it.amt;
      move(it.acc, -it.amt);
    }
  }

  const goals = new Map(
    file.goals.map((g) => [
      g.id,
      // L'ancien format ne rattache encore aucune opération : un objectif « tagged » est à 0.
      g.source === "account" ? g.accounts.reduce((sum, a) => sum + (balances.get(a) ?? 0), 0) : 0,
    ]),
  );
  const debts = new Map(file.debts.map((d) => [d.id, d.paidManual]));
  return { months, balances, goals, debts };
}

/** Les sommes d'euros décimaux ne sont exactes qu'au flottant près : on les ramène au centime. */
const toCents = (euros: number): Cents => Math.round(euros * 100);

export function crossCheckLegacy(file: LegacyExport, data: Dataset): { issues: string[]; checked: LegacyChecked } {
  const issues: string[] = [];
  const old = legacyFigures(file);
  const compare = (what: string, legacyEuros: number, converted: Cents) => {
    const expected = toCents(legacyEuros);
    if (expected !== converted) {
      issues.push(
        `vérification croisée : ${what} vaut ${formatCents(expected)} dans l'ancienne application et ${formatCents(converted)} après conversion`,
      );
    }
  };

  for (const [month, t] of old.months) {
    const a = monthAggregates(data, month);
    if (a.count !== t.count) {
      issues.push(`vérification croisée : ${month} compte ${t.count} opérations dans l'ancienne application et ${a.count} après conversion`);
    }
    compare(`les revenus de ${month}`, t.income, a.income);
    compare(`les besoins de ${month}`, t.needs, a.needs);
    compare(`les envies de ${month}`, t.wants, a.wants);
    compare(`la mise de côté de ${month}`, t.saved, a.saved);
    compare(`le reste de ${month}`, t.income - t.needs - t.wants - t.saved, a.balance);
  }

  const figures = accountFigures(data, ALL_TIME);
  for (const account of file.accounts) {
    compare(`le solde du compte « ${account.name} »`, old.balances.get(account.id)!, figures.get(legacyId("account", account.id))?.balance ?? 0);
  }

  const goals = new Map(data.collections.goals.map((g) => [g.id, g]));
  for (const goal of file.goals) {
    const converted = goals.get(legacyId("goal", goal.id));
    compare(`l'avancement de l'objectif « ${goal.name} »`, old.goals.get(goal.id)!, converted ? goalProgress(data, converted, ALL_TIME) : 0);
  }

  const debts = new Map(data.collections.debts.map((d) => [d.id, d]));
  for (const debt of file.debts) {
    const converted = debts.get(legacyId("debt", debt.id));
    compare(`le montant réglé de la dette « ${debt.name} »`, old.debts.get(debt.id)!, converted ? debtPaid(data, converted, ALL_TIME) : 0);
  }

  // Catégories : même nom et même usage qu'avant.
  const categories = new Map(data.collections.categories.map((c) => [c.id, c]));
  for (const cat of file.cats) {
    const c = categories.get(legacyCategoryId(cat.id));
    if (!c || c.name !== cat.name || c.kind !== cat.kind || c.bucket !== cat.bucket) {
      issues.push(`vérification croisée : la catégorie « ${cat.name} » n'a pas été reprise à l'identique`);
    }
  }

  return {
    issues,
    checked: { months: old.months.size, accounts: file.accounts.length, goals: file.goals.length, debts: file.debts.length },
  };
}
