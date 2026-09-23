import { v4, v5 } from "uuid";
import type { Month } from "./model";

/** Espace de noms fixe des identifiants dérivés. Ne jamais le changer. */
export const CASHMYR_NAMESPACE = "35fdefb5-2fb6-4c98-a048-9be2efb53911";

export const newId = (): string => v4();

/**
 * uuid v5 déterministe : deux appareils qui dérivent le même objet obtiennent
 * le même identifiant, et la fusion les confond au lieu de créer un doublon.
 */
export const derivedId = (...parts: string[]): string => v5(parts.join("\u001f"), CASHMYR_NAMESPACE);

export const occurrenceId = (recurrenceId: string, month: Month): string =>
  derivedId("occurrence", recurrenceId, month);

export const skipId = (recurrenceId: string, month: Month): string => derivedId("skip", recurrenceId, month);

export const legacyId = (kind: string, id: string): string => derivedId("legacy", kind, id);
