import { liveTags, resolveTag, shownTag, type Changes, type Dataset } from "@cashmyr/core";

/** Texte de départ du champ Tag : le nom du tag affiché, ou rien (tag absent ou supprimé). */
export const tagText = (data: Dataset, tagId: string | undefined): string => shownTag(data, tagId)?.name ?? "";

/**
 * Tag choisi dans un formulaire. Un nom saisi désigne le tag de ce nom, créé s'il n'existe pas
 * (décision 47). Champ vide : aucun tag ; sauf si la ligne portait un tag supprimé, qu'elle garde
 * sans l'afficher (décision 48), pour le retrouver s'il revient.
 */
export function tagChoice(data: Dataset, text: string, previousTagId: string | undefined, now: number): { tagId?: string; changes: Changes } {
  if (text.trim() === "") {
    const hidden = previousTagId && !shownTag(data, previousTagId) ? previousTagId : undefined;
    return hidden ? { tagId: hidden, changes: {} } : { changes: {} };
  }
  const { tag, changes } = resolveTag(data, text, now);
  return { tagId: tag.id, changes };
}

/** Noms proposés dans le champ Tag. */
export const tagSuggestions = (data: Dataset): string[] => liveTags(data).map((t) => t.name);
