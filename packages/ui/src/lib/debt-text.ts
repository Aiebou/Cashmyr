import type { DebtView } from "@cashmyr/core";
import { dayLong, money, monthLong } from "./format";

const s = (n: number) => (n > 1 ? "s" : "");

/**
 * Phrase de synthèse d'une dette, toujours en montant restant converti en
 * échéances restantes, jamais en « échéances réglées » :
 * « reste 1 échéance de 50 € · prochaine le 10 novembre 2026 · soldée en novembre 2026. »
 */
export function debtSentence(view: DebtView, today: string): string {
  const lent = view.debt.direction === "lent";
  const rest = lent ? "reste à recevoir" : "reste";
  if (view.remaining === 0) return lent ? "Entièrement remboursée." : "Entièrement réglée.";
  if (view.installmentsLeft === null || view.lastAmount === null) return `${rest} ${money(view.remaining)}.`;

  const amount = view.debt.installmentAmount;
  const left = view.installmentsLeft;
  const parts: string[] = [];
  if (left === 1) parts.push(`${rest} 1 échéance de ${money(view.lastAmount)}`);
  else if (view.lastAmount === amount) parts.push(`${rest} ${left} échéances de ${money(amount)}`);
  else parts.push(`${rest} ${left} échéances, ${left - 1} de ${money(amount)} puis ${money(view.lastAmount)}`);

  const next = view.next;
  if (next) {
    if (next.status === "overdue") parts.push(`en retard depuis le ${dayLong(next.date)}`);
    else if (next.date === today) parts.push("prochaine aujourd'hui");
    else if (next.status === "soon") parts.push(`prochaine dans ${next.daysUntil} jour${s(next.daysUntil)}, le ${dayLong(next.date)}`);
    else parts.push(`prochaine le ${dayLong(next.date)}`);
  }
  if (view.payoffDate) parts.push(`${lent ? "remboursée" : "soldée"} en ${monthLong(view.payoffDate.slice(0, 7))}`);
  if (view.uncovered > 0) parts.push(`${money(view.uncovered)} au-delà de l'échéancier`);
  return `${parts.join(" · ")}.`;
}
