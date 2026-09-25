import { shownTag, type Dataset, type Operation } from "@cashmyr/core";
import { operationColor, operationLabel, categoryName, accountName } from "../lib/data";
import { dayShort, money } from "../lib/format";
import { cx } from "./controls";
import { Dot } from "./figures";
import { RepeatIcon } from "./icons";
import s from "./OperationRow.module.css";

type Props = {
  data: Dataset;
  op: Operation;
  onOpen?(op: Operation): void;
  /** Faux quand la liste est déjà groupée par jour. */
  showDate?: boolean;
};

/** Une opération dans une liste : pastille, libellé, détail, montant signé. */
export function OperationRow({ data, op, onOpen, showDate = true }: Props) {
  const label = operationLabel(data, op);
  const tag = shownTag(data, op.tagId);
  const detail =
    op.type === "tx"
      ? "Transfert"
      : `${op.note.trim() ? `${categoryName(data, op.categoryId)} · ` : ""}${accountName(data, op.accountId)}`;
  const amount = op.type === "out" ? `−${money(op.amount)}` : op.type === "in" ? `+${money(op.amount)}` : money(op.amount);
  const content = (
    <>
      <Dot color={operationColor(data, op)} />
      {showDate && <span className={s.date}>{dayShort(op.date)}</span>}
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
        <span className={s.detail}>
          {detail}
          {tag && (
            <span className={s.tag}>
              <span className="visually-hidden">, tag </span>
              {tag.name}
            </span>
          )}
        </span>
      </span>
      <span className={`${s.amount} ${op.type === "in" ? s.in : ""}`}>{amount}</span>
    </>
  );
  return onOpen ? (
    <li>
      <button type="button" className={cx(s.row, !showDate && s.undated)} onClick={() => onOpen(op)}>
        {content}
      </button>
    </li>
  ) : (
    <li className={cx(s.row, !showDate && s.undated)}>{content}</li>
  );
}

export function OperationList({ children }: { children: React.ReactNode }) {
  return <ul className={s.list}>{children}</ul>;
}
