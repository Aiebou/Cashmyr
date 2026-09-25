import { centsToInput, completeSchedule, MAX_INSTALLMENTS, parseAmount, type Cents, type ScheduleField } from "@cashmyr/core";
import { money } from "./format";

/**
 * Montant total, montant par échéance et nombre d'échéances d'une dette : deux champs remplis
 * donnent le troisième (décision 41). Quand les trois le sont, c'est le champ modifié le moins
 * récemment qui se recalcule.
 */
export type ScheduleTexts = Record<ScheduleField, string>;
export type ScheduleState = {
  texts: ScheduleTexts;
  /** Champs modifiés par l'utilisateur, du plus récent au plus ancien. */
  touched: ScheduleField[];
  /** Champ rempli par le calcul, signalé à l'écran. */
  computed: ScheduleField | null;
};

/**
 * Quand un seul champ a été modifié, l'autre donnée conservée est la plus stable d'une dette :
 * le total d'abord, puis le montant par échéance.
 */
const ANCHORS: readonly ScheduleField[] = ["total", "installment", "count"];

/** Valeur saisie, ou null si le champ est vide ou illisible. */
export function readScheduleField(field: ScheduleField, text: string): number | null {
  if (text.trim() === "") return null;
  if (field === "count") {
    if (!/^\s*\d+\s*$/.test(text)) return null;
    const n = Number(text);
    return n >= 1 && n <= MAX_INSTALLMENTS ? n : null;
  }
  return parseAmount(text);
}

const usable = (texts: ScheduleTexts, field: ScheduleField) => {
  const v = readScheduleField(field, texts[field]);
  return v !== null && v > 0;
};

export const initialSchedule = (texts: ScheduleTexts): ScheduleState => ({ texts, touched: [], computed: null });

export function editSchedule(state: ScheduleState, field: ScheduleField, text: string): ScheduleState {
  const texts = { ...state.texts, [field]: text };
  const kept = state.computed === field ? null : state.computed;
  if (!usable(texts, field)) {
    // Un champ vidé ou illisible n'est plus une donnée : rien ne se recalcule depuis lui.
    return { texts, touched: state.touched.filter((f) => f !== field), computed: kept };
  }
  const touched = [field, ...state.touched.filter((f) => f !== field)];
  // Un champ tout juste calculé n'est pas une donnée : on ne s'appuie pas dessus tant que la saisie continue.
  const second =
    touched.slice(1).find((f) => usable(texts, f)) ?? ANCHORS.find((f) => f !== field && f !== kept && usable(texts, f));
  if (!second) return { texts, touched, computed: kept };
  const target = ANCHORS.find((f) => f !== field && f !== second)!;
  const value = completeSchedule(target, {
    total: readScheduleField("total", texts.total),
    installment: readScheduleField("installment", texts.installment),
    count: readScheduleField("count", texts.count),
  });
  if (value === null) return { texts, touched, computed: kept };
  texts[target] = target === "count" ? String(value) : centsToInput(value);
  return { texts, touched, computed: target };
}

/** Montant de la dernière échéance quand elle est réduite ; null si toutes sont égales. */
export function reducedLastInstallment(texts: ScheduleTexts): Cents | null {
  const total = readScheduleField("total", texts.total);
  const installment = readScheduleField("installment", texts.installment);
  const count = readScheduleField("count", texts.count);
  if (!total || !installment || !count || total > installment * count) return null;
  const last = total - (count - 1) * installment;
  return last > 0 && last < installment ? last : null;
}

/** Texte sous un champ rempli par le calcul ; null pour les autres. */
export function computedHint(state: ScheduleState, field: ScheduleField): string | null {
  if (state.computed !== field) return null;
  if (field === "total") return "Calculé : montant × nombre d'échéances";
  const last = reducedLastInstallment(state.texts);
  if (last !== null) return `Calculé · dernière échéance réduite à ${money(last)}`;
  return field === "installment" ? "Calculé : total ÷ nombre d'échéances" : "Calculé : total ÷ montant par échéance";
}
