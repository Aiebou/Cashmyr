import { indexOf, isRetiredCategory, type Dataset } from "@cashmyr/core";
import { retiredName } from "../lib/data";

/** Aide d'un champ « Catégorie » qui porte une ancienne catégorie (décision 89). */
export const RECLASS_HINT = "À reclasser : choisis une catégorie actuelle.";

/**
 * L'ancienne catégorie d'une fiche, proposée et choisie dans le menu tant qu'on ne la change pas :
 * enregistrer sans y toucher la garde (décision 89).
 */
export function RetiredOption({ data, categoryId }: { data: Dataset; categoryId: string }) {
  if (!isRetiredCategory(data, categoryId)) return null;
  return <option value={categoryId}>{retiredName(indexOf(data).categories.get(categoryId)!.name)}</option>;
}
