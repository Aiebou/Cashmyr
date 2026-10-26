import { isRetiredCategory, type Dataset, type Operation, type OpType } from "@cashmyr/core";
import { operationLabel } from "./data";

export type OperationFilters = {
  query: string;
  type: OpType | "all";
  categoryId: string;
  accountId: string;
  goalId: string;
  debtId: string;
  tagId: string;
};

/** Valeur du filtre de catégorie qui garde les opérations à reclasser (décision 89). */
export const RETIRED = "a-reclasser";

export const NO_FILTERS: OperationFilters = { query: "", type: "all", categoryId: "", accountId: "", goalId: "", debtId: "", tagId: "" };

export const hasFilters = (f: OperationFilters): boolean =>
  f.query.trim() !== "" ||
  f.type !== "all" ||
  f.categoryId !== "" ||
  f.accountId !== "" ||
  f.goalId !== "" ||
  f.debtId !== "" ||
  f.tagId !== "";

/** Minuscules sans accents : « Échéance » se trouve en tapant « echeance ». */
export const fold = (text: string): string => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Une opération passe si elle satisfait chaque filtre renseigné. Le compte vaut pour
 * un transfert au départ comme à l'arrivée. La recherche porte sur le libellé affiché,
 * et chaque mot tapé doit s'y trouver.
 */
export function matchesFilters(data: Dataset, op: Operation, f: OperationFilters): boolean {
  if (f.type !== "all" && op.type !== f.type) return false;
  if (f.categoryId === RETIRED) {
    if (!isRetiredCategory(data, op.categoryId)) return false;
  } else if (f.categoryId && op.categoryId !== f.categoryId) return false;
  if (f.accountId && op.accountId !== f.accountId && op.fromAccountId !== f.accountId && op.toAccountId !== f.accountId) {
    return false;
  }
  if (f.goalId && op.goalId !== f.goalId) return false;
  if (f.debtId && op.debtId !== f.debtId) return false;
  if (f.tagId && op.tagId !== f.tagId) return false;
  const words = fold(f.query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const label = fold(operationLabel(data, op));
  return words.every((w) => label.includes(w));
}
