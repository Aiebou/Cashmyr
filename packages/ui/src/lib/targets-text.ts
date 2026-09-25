import type { Bucket, Cents } from "@cashmyr/core";
import { money } from "./format";

/** Texte sous une jauge d'usage : écart à la cible, dit dans le sens de l'usage. */
export function targetCaption(bucket: Bucket, value: Cents, target: Cents): string {
  const gap = target - value;
  if (target === 0 && (bucket === "invest" || value === 0)) return `cible ${money(0)}`;
  if (bucket === "invest") {
    return gap > 0
      ? `cible ${money(target)} · encore ${money(gap)} à mettre de côté`
      : `cible ${money(target)} · dépassée de ${money(-gap)}`;
  }
  return gap >= 0 ? `cible ${money(target)} · reste ${money(gap)}` : `cible ${money(target)} · dépassée de ${money(-gap)}`;
}
