import type { BudgetNature, Cents } from "@cashmyr/core";
import { money } from "./format";

/** Texte sous la jauge d'un budget : écart à la cible, dit dans le sens de sa nature. */
export function targetCaption(nature: BudgetNature, value: Cents, target: Cents): string {
  const gap = target - value;
  if (target === 0 && (nature === "save" || value === 0)) return `cible ${money(0)}`;
  if (nature === "save") {
    return gap > 0
      ? `cible ${money(target)} · encore ${money(gap)} à mettre de côté`
      : `cible ${money(target)} · dépassée de ${money(-gap)}`;
  }
  return gap >= 0 ? `cible ${money(target)} · reste ${money(gap)}` : `cible ${money(target)} · dépassée de ${money(-gap)}`;
}
