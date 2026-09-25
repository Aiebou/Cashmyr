import { describe, expect, it } from "vitest";
import { editSchedule, initialSchedule, reducedLastInstallment, type ScheduleState } from "../src/lib/schedule-fields";

const type = (state: ScheduleState, ...edits: [keyof ScheduleState["texts"], string][]) =>
  edits.reduce((st, [field, text]) => editSchedule(st, field, text), state);
const empty = () => initialSchedule({ total: "", installment: "", count: "" });

describe("échéancier calculé (décision 41)", () => {
  it("total et nombre → montant, au centime supérieur", () => {
    const st = type(empty(), ["total", "2000"], ["count", "5"]);
    expect(st.texts.installment).toBe("400,00");
    expect(st.computed).toBe("installment");
    const odd = type(empty(), ["total", "1000"], ["count", "3"]);
    expect(odd.texts.installment).toBe("333,34");
    expect(reducedLastInstallment(odd.texts)).toBe(33_332);
  });

  it("nombre et montant → total ; total et montant → nombre, à l'entier supérieur", () => {
    expect(type(empty(), ["count", "10"], ["installment", "123"]).texts.total).toBe("1230,00");
    const st = type(empty(), ["total", "1000"], ["installment", "300"]);
    expect(st.texts.count).toBe("4");
    expect(reducedLastInstallment(st.texts)).toBe(10_000);
  });

  it("les trois remplis : le champ modifié le moins récemment se recalcule", () => {
    let st = type(empty(), ["total", "2000"], ["count", "5"]);
    st = type(st, ["installment", "500"]);
    expect(st.computed).toBe("total");
    expect(st.texts.total).toBe("2500,00");
    st = type(st, ["count", "4"]);
    expect(st.texts.total).toBe("2000,00");
  });

  it("frappe caractère par caractère : le champ calculé ne sert pas de base", () => {
    const stored = initialSchedule({ total: "", installment: "200,00", count: "5" });
    const st = type(stored, ["installment", ""], ["installment", "2"], ["installment", "25"], ["installment", "250"]);
    expect(st.texts).toEqual({ total: "1250,00", installment: "250", count: "5" });
  });

  it("un seul champ modifié sur une dette enregistrée : le total est gardé en priorité", () => {
    const stored = initialSchedule({ total: "1000,00", installment: "200,00", count: "5" });
    expect(type(stored, ["count", "8"]).texts.installment).toBe("125,00");
    expect(type(stored, ["installment", "250"]).texts.count).toBe("4");
  });

  it("rien ne se calcule depuis un champ vide ou illisible, ni au-delà de 1 200 échéances", () => {
    const st = type(empty(), ["total", "1000"], ["count", "abc"]);
    expect(st.texts.installment).toBe("");
    expect(st.computed).toBeNull();
    expect(type(empty(), ["total", "100000"], ["installment", "1"]).texts.count).toBe("");
  });
});
