import type { PlannedOccurrence } from "@cashmyr/core";
import { dayShort, moneyExact } from "../lib/format";
import { Card } from "./layout";
import s from "./PlannedList.module.css";

/** Occurrences prévues, pas encore générées : lecture seule (décision 5). */
export function PlannedList({ planned, future }: { planned: PlannedOccurrence[]; future: boolean }) {
  if (planned.length === 0) return null;
  return (
    <Card title={future ? "Prévu ce mois" : "Prévu d'ici la fin du mois"} subtitle="Lecture seule : les opérations apparaîtront le jour venu.">
      <ul className={s.planned}>
        {planned.map((p) => (
          <li key={`${p.recurrence.id}-${p.month}`}>
            <span className={s.date}>{dayShort(p.date)}</span>
            <span className={s.label}>{p.recurrence.label}</span>
            <span className={s.amount}>
              {p.recurrence.type === "out" ? "−" : p.recurrence.type === "in" ? "+" : ""}
              {moneyExact(p.amount)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
