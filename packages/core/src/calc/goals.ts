import { indexOf } from "../dataset";
import { addMonthsToDay, monthsAndDaysBetween, wholeMonthsBetween } from "../dates";
import type { Cents, Dataset, Day, Goal, GoalStep } from "../model";
import { roundDiv } from "../money";
import { accountFigures } from "./accounts";
import { isSavingRole } from "./month";

const liveSteps = (data: Dataset, goalId: string): GoalStep[] =>
  data.collections.goalSteps
    .filter((s) => s.deletedAt === null && s.goalId === goalId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

export function goalStepsOf(data: Dataset, goalId: string): GoalStep[] {
  return liveSteps(data, goalId);
}

/** Cible : montant saisi, ou somme des postes en mode « steps ». */
export function goalTarget(data: Dataset, goal: Goal): Cents {
  if (goal.targetMode === "manual") return goal.target;
  return liveSteps(data, goal.id).reduce((sum, s) => sum + s.amount, 0);
}

/** Avancement au soir du jour `asOf`. */
export function goalProgress(data: Dataset, goal: Goal, asOf: Day): Cents {
  const ix = indexOf(data);
  if (goal.source === "account") {
    const figures = accountFigures(data, asOf);
    return goal.accountIds.reduce((sum, id) => {
      const account = ix.accounts.get(id);
      if (!account || account.deletedAt !== null) return sum;
      return sum + (figures.get(id)?.balance ?? 0);
    }, 0);
  }
  let progress = 0;
  for (const op of ix.liveOps) {
    if (op.goalId !== goal.id || op.date > asOf) continue;
    if (op.type === "in") progress += op.amount;
    else if (op.type === "out") {
      const bucket = op.categoryId ? ix.categories.get(op.categoryId)?.bucket : undefined;
      if (bucket === "invest") progress += op.amount;
      else if (bucket === "besoin" || bucket === "envie") progress -= op.amount;
    } else {
      const to = op.toAccountId ? ix.accounts.get(op.toAccountId) : undefined;
      const from = op.fromAccountId ? ix.accounts.get(op.fromAccountId) : undefined;
      if (isSavingRole(to?.role)) progress += op.amount;
      if (isSavingRole(from?.role)) progress -= op.amount;
    }
  }
  return progress;
}

export type StepSummary = {
  settledCount: number;
  totalCount: number;
  /** Somme des postes réglés. */
  settledAmount: Cents;
  totalAmount: Cents;
};

/** « 2 postes sur 4 réglés · 1 500 € sur 2 500 € ». Cocher « réglé » ne change aucun calcul. */
export function stepSummary(data: Dataset, goalId: string): StepSummary {
  const steps = liveSteps(data, goalId);
  const settled = steps.filter((s) => s.done);
  return {
    settledCount: settled.length,
    totalCount: steps.length,
    settledAmount: settled.reduce((sum, s) => sum + s.amount, 0),
    totalAmount: steps.reduce((sum, s) => sum + s.amount, 0),
  };
}

/**
 * Mois restants jusqu'à l'échéance, en mois entamés : du 23/09 au 05/04 il y a
 * 6 mois pleins et 13 jours, soit 7. Minimum 1 tant que l'échéance n'est pas passée.
 */
export function monthsLeft(today: Day, due: Day): number {
  const whole = wholeMonthsBetween(today, due);
  const started = addMonthsToDay(today, whole) < due ? whole + 1 : whole;
  return Math.max(1, started);
}

export type Deadline = {
  due: Day;
  /**
   * met : rien ne reste à mettre de côté, ou objectif marqué atteint.
   * overdue : échéance dépassée, non atteinte (affichée en rouge).
   * upcoming : échéance à venir, il reste à mettre de côté.
   */
  status: "met" | "overdue" | "upcoming";
  remaining: Cents;
  /** Temps restant ; null une fois l'échéance passée. */
  timeLeft: { months: number; days: number } | null;
  monthsLeft: number | null;
  /** (cible − avancement) ÷ mois restants ; null si rien n'est dû ou si l'échéance est passée. */
  monthlyNeeded: Cents | null;
};

export function goalDeadline(goal: Goal, target: Cents, progress: Cents, today: Day): Deadline | null {
  if (!goal.due) return null;
  const remaining = Math.max(0, target - progress);
  const passed = goal.due < today;
  if (goal.done || remaining === 0) {
    return {
      due: goal.due,
      status: "met",
      remaining,
      timeLeft: passed ? null : monthsAndDaysBetween(today, goal.due),
      monthsLeft: passed ? null : monthsLeft(today, goal.due),
      monthlyNeeded: null,
    };
  }
  if (passed) {
    return { due: goal.due, status: "overdue", remaining, timeLeft: null, monthsLeft: null, monthlyNeeded: null };
  }
  const left = monthsLeft(today, goal.due);
  return {
    due: goal.due,
    status: "upcoming",
    remaining,
    timeLeft: monthsAndDaysBetween(today, goal.due),
    monthsLeft: left,
    monthlyNeeded: roundDiv(remaining, left),
  };
}

export type GoalView = {
  goal: Goal;
  target: Cents;
  progress: Cents;
  steps: StepSummary;
  deadline: Deadline | null;
  /** Avancement ≥ cible sans que l'objectif soit marqué atteint : la carte le propose. */
  suggestDone: boolean;
};

export function goalView(data: Dataset, goal: Goal, asOf: Day, today: Day): GoalView {
  const target = goalTarget(data, goal);
  const progress = goalProgress(data, goal, asOf);
  return {
    goal,
    target,
    progress,
    steps: stepSummary(data, goal.id),
    deadline: goalDeadline(goal, target, progress, today),
    suggestDone: !goal.done && target > 0 && progress >= target,
  };
}

const byPosition = (a: Goal, b: Goal) => a.position - b.position || a.name.localeCompare(b.name, "fr");

/**
 * Objectifs du tableau de bord : ni archivés, ni masqués, et non atteints ou épinglés.
 * Les épinglés passent en tête. « Atteint » est le drapeau manuel `done`.
 */
export function dashboardGoals(data: Dataset): Goal[] {
  return data.collections.goals
    .filter((g) => g.deletedAt === null && !g.archived && !g.hidden && (!g.done || g.pinned))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || byPosition(a, b));
}

/** Onglet Objectifs : en cours, atteints, archivés. */
export function goalsByState(data: Dataset): { active: Goal[]; done: Goal[]; archived: Goal[] } {
  const live = data.collections.goals.filter((g) => g.deletedAt === null);
  const pinnedFirst = (a: Goal, b: Goal) => Number(b.pinned) - Number(a.pinned) || byPosition(a, b);
  return {
    active: live.filter((g) => !g.archived && !g.done).sort(pinnedFirst),
    done: live.filter((g) => !g.archived && g.done).sort(pinnedFirst),
    archived: live.filter((g) => g.archived).sort(byPosition),
  };
}
