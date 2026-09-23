import type { AverageWindow, Bucket, Cents, Dataset, Month } from "../model";
import { applyBasisPoints } from "../money";
import { averageIncome } from "./averages";
import { monthAggregates } from "./month";

export type Targets = {
  /** Ce sur quoi repose réellement le calcul, à afficher. */
  basis: "avg" | "month";
  /** Vrai si la moyenne était demandée mais n'existe pas encore. */
  fellBack: boolean;
  window: AverageWindow;
  average: Cents | null;
  base: Cents;
  targets: Record<Bucket, Cents>;
};

export function monthTargets(data: Dataset, month: Month): Targets {
  const prefs = data.preferences;
  const average = averageIncome(data, month, prefs.averageWindow).value;
  const useAverage = prefs.basis === "avg" && average !== null;
  const base = useAverage ? average : monthAggregates(data, month).income;
  return {
    basis: useAverage ? "avg" : "month",
    fellBack: prefs.basis === "avg" && average === null,
    window: prefs.averageWindow,
    average,
    base,
    targets: {
      besoin: applyBasisPoints(base, prefs.splits.besoin),
      envie: applyBasisPoints(base, prefs.splits.envie),
      invest: applyBasisPoints(base, prefs.splits.invest),
    },
  };
}
