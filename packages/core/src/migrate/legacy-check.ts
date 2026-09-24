import { accountFigures } from "../calc/accounts";
import { debtPaid } from "../calc/debts";
import { goalProgress, goalTarget } from "../calc/goals";
import { monthAggregates } from "../calc/month";
import { legacyCategoryId } from "../defaults";
import { legacyId } from "../ids";
import type { Cents, Dataset, Day, Month, Role } from "../model";
import { formatCents } from "../money";
import type { LegacyExport } from "./legacy";

/**
 * Vérification croisée de la reprise (§7). Un calculateur minimal, indépendant de `core`,
 * refait sur l'ancien format, en euros, les calculs de l'ancienne application (`agg`,
 * `balances`, `goalProgress`, `goalTarget`, `debtRepaid` de son code) : totaux par mois,
 * soldes, avancement et cible des objectifs, réglé des dettes. Chaque résultat est comparé
 * au centime près avec celui de `core` sur les données converties.
 */

export type LegacyChecked = { months: number; accounts: number; goals: number; debts: number };

/** Toutes les opérations comptent, quelle que soit leur date. */
const ALL_TIME: Day = "9999-12-31";

const saves = (role: Role | undefined) => role === "epargne" || role === "invest";

type MonthTotals = { count: number; income: number; needs: number; wants: number; saved: number };

/** Le calculateur de l'ancienne application : euros décimaux, ses règles telles qu'écrites. */
function legacyFigures(file: LegacyExport) {
  const bucketOf = new Map(file.cats.map((c) => [c.id, c.bucket]));
  const roleOf = new Map(file.accounts.map((a) => [a.id, a.role]));
  const months = new Map<Month, MonthTotals>(
    file.months.map((m) => [m, { count: 0, income: 0, needs: 0, wants: 0, saved: 0 }]),
  );
  const balances = new Map(file.accounts.map((a) => [a.id, a.opening]));
  const move = (account: string, euros: number) => balances.set(account, (balances.get(account) ?? 0) + euros);

  for (const it of file.items) {
    const t = months.get(it.month)!;
    t.count++;
    if (it.t === "tx") {
      if (saves(roleOf.get(it.to))) t.saved += it.amt;
      if (saves(roleOf.get(it.from))) t.saved -= it.amt;
      move(it.from, -it.amt);
      move(it.to, it.amt);
    } else if (it.t === "in") {
      t.income += it.amt;
      move(it.acc, it.amt);
    } else {
      const bucket = bucketOf.get(it.cat);
      if (bucket === "envie") t.wants += it.amt;
      else if (bucket === "invest") t.saved += it.amt;
      else t.needs += it.amt;
      move(it.acc, -it.amt);
    }
  }

  const goals = new Map<string, { progress: number; target: number }>();
  /** Décision 37 : cas où l'ancienne application et Cashmyr ne comptent pas pareil. */
  const divergences: string[] = [];
  for (const g of file.goals) {
    let progress = 0;
    if (g.source === "account") progress = g.accounts.reduce((sum, a) => sum + (balances.get(a) ?? 0), 0);
    else {
      for (const it of file.items) {
        if (it.goal !== g.id) continue;
        if (it.t === "tx") {
          const toSaves = saves(roleOf.get(it.to));
          const fromSaves = saves(roleOf.get(it.from));
          // L'ancienne application : « vers l'épargne, sinon depuis l'épargne » ; Cashmyr applique les deux.
          if (toSaves && fromSaves) {
            divergences.push(
              `l'opération du ${it.d} (${formatCents(Math.round(it.amt * 100))}) est un transfert entre deux comptes d'épargne ` +
                `rattaché à l'objectif « ${g.name} » : l'ancienne application le comptait en plus, Cashmyr le compte pour zéro. ` +
                "Retire ce rattachement dans l'ancienne application, puis refais l'export",
            );
          }
          if (toSaves) progress += it.amt;
          else if (fromSaves) progress -= it.amt;
        } else if (it.t === "in") progress += it.amt;
        else progress += bucketOf.get(it.cat) === "invest" ? it.amt : -it.amt;
      }
    }
    const target = g.targetMode === "steps" ? g.steps.reduce((sum, s) => sum + s.amount, 0) : g.target;
    goals.set(g.id, { progress, target });
  }

  const debts = new Map<string, number>();
  for (const d of file.debts) {
    let paid = d.paidManual;
    for (const it of file.items) {
      if (it.debt !== d.id) continue;
      if (d.direction === "lent") paid += it.t === "in" ? it.amt : -it.amt;
      else paid += it.t === "in" ? -it.amt : it.amt;
    }
    debts.set(d.id, paid);
  }
  return { months, balances, goals, debts, divergences };
}

/** Les sommes d'euros décimaux ne sont exactes qu'au flottant près : on les ramène au centime. */
const toCents = (euros: number): Cents => Math.round(euros * 100);

export function crossCheckLegacy(file: LegacyExport, data: Dataset): { issues: string[]; checked: LegacyChecked } {
  const old = legacyFigures(file);
  const issues: string[] = [...old.divergences];
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
    // Un écart déjà expliqué (décision 37) n'est pas répété.
    if (old.divergences.some((d) => d.includes(`l'objectif « ${goal.name} »`))) continue;
    const converted = goals.get(legacyId("goal", goal.id));
    const o = old.goals.get(goal.id)!;
    compare(`l'avancement de l'objectif « ${goal.name} »`, o.progress, converted ? goalProgress(data, converted, ALL_TIME) : 0);
    compare(`la cible de l'objectif « ${goal.name} »`, o.target, converted ? goalTarget(data, converted) : 0);
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
