import type { Cents, Dataset, Day, Month } from "../model";
import { roundDiv } from "../money";
import { accountFigures } from "./accounts";
import { averageSpending, referenceMonth } from "./averages";

export type SafetyStatus = {
  /** Comptes cochés « épargne de précaution ». */
  accountIds: string[];
  constituted: Cents;
  /** Dépenses courantes moyennes, même règle et même fenêtre que le revenu moyen. */
  averageSpending: Cents | null;
  averageMonths: Month[];
  /** null en mode « mois » tant qu'aucune moyenne n'existe. */
  objective: Cents | null;
  /** constituée ÷ dépenses moyennes, arrondi à une décimale ; null si la moyenne est absente ou nulle. */
  capacityMonths: number | null;
  reached: boolean | null;
};

export function safetyStatus(data: Dataset, asOf: Day, today: Day): SafetyStatus {
  const prefs = data.preferences;
  const figures = accountFigures(data, asOf);
  const accounts = data.collections.accounts.filter((a) => a.deletedAt === null && a.safety);
  const constituted = accounts.reduce((sum, a) => sum + (figures.get(a.id)?.balance ?? 0), 0);

  const avg = averageSpending(data, referenceMonth(asOf, today), prefs.averageWindow);
  const objective =
    prefs.safety.mode === "amount" ? prefs.safety.amount : avg.value === null ? null : prefs.safety.months * avg.value;
  const capacityMonths =
    avg.value === null || avg.value <= 0 ? null : roundDiv(constituted * 10, avg.value) / 10;

  return {
    accountIds: accounts.map((a) => a.id),
    constituted,
    averageSpending: avg.value,
    averageMonths: avg.months,
    objective,
    capacityMonths,
    reached: objective === null ? null : constituted >= objective,
  };
}
