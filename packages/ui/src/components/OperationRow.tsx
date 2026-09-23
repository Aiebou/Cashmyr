import type { Dataset, Operation } from "@cashmyr/core";
import { operationColor, operationLabel, categoryName, accountName } from "../lib/data";
import { dayShort, moneyExact } from "../lib/format";
import { Dot } from "./figures";
import { RepeatIcon } from "./icons";
import s from "./OperationRow.module.css";

type Props = { data: Dataset; op: Operation; onOpen?(op: Operation): void };

/** Une opération dans une liste : pastille, libellé, détail, montant signé. */
export function OperationRow({ data, op, onOpen }: Props) {
  const label = operationLabel(data, op);
  const detail =
    op.type === "tx"
      ? "Transfert"
      : `${op.note.trim() ? `${categoryName(data, op.categoryId)} · ` : ""}${accountName(data, op.accountId)}`;
  const amount = op.type === "out" ? `−${moneyExact(op.amount)}` : op.type === "in" ? `+${moneyExact(op.amount)}` : moneyExact(op.amount);
  const content = (
    <>
      <Dot color={operationColor(data, op)} />
      <span className={s.date}>{dayShort(op.date)}</span>
      <span className={s.text}>
        <span className={s.label}>
          {label}
          {op.recurrenceId && (
            <span className={s.generated} title="Générée par une récurrence">
              <RepeatIcon size={14} />
              <span className="visually-hidden">(générée par une récurrence)</span>
            </span>
          )}
        </span>
        <span className={s.detail}>{detail}</span>
      </span>
      <span className={`${s.amount} ${op.type === "in" ? s.in : ""}`}>{amount}</span>
    </>
  );
  return onOpen ? (
    <li>
      <button type="button" className={s.row} onClick={() => onOpen(op)}>
        {content}
      </button>
    </li>
  ) : (
    <li className={s.row}>{content}</li>
  );
}

export function OperationList({ children }: { children: React.ReactNode }) {
  return <ul className={s.list}>{children}</ul>;
}
