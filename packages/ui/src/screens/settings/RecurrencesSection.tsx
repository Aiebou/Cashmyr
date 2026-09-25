import {
  indexOf,
  pauseRecurrence,
  removeDebtRecurrence,
  resumeRecurrence,
  tombstone,
  type Dataset,
  type Recurrence,
} from "@cashmyr/core";
import { Button, cx } from "../../components/controls";
import { PlusIcon } from "../../components/icons";
import { Card } from "../../components/layout";
import { accountName, categoryName } from "../../lib/data";
import { count, monthLong, money, ofMonth } from "../../lib/format";
import { useActions, useApp } from "../../store/context";
import s from "./Settings.module.css";

const byLabel = (a: Recurrence, b: Recurrence) =>
  Number(b.active) - Number(a.active) || a.label.localeCompare(b.label, "fr") || a.id.localeCompare(b.id);

/** « −35,00 € le 3 de chaque mois · Sorties et loisirs · Compte courant · depuis juin 2026 » */
function describe(data: Dataset, rec: Recurrence): string {
  const sign = rec.type === "out" ? "−" : rec.type === "in" ? "+" : "";
  const where =
    rec.type === "tx"
      ? `${accountName(data, rec.fromAccountId)} → ${accountName(data, rec.toAccountId)}`
      : `${categoryName(data, rec.categoryId)} · ${accountName(data, rec.accountId)}`;
  const span = rec.endMonth ? `${ofMonth(rec.startMonth)} à ${monthLong(rec.endMonth)}` : `depuis ${monthLong(rec.startMonth)}`;
  return `${sign}${money(rec.amount)} le ${rec.dayOfMonth} de chaque mois · ${where} · ${span}`;
}

function RecurrenceItem({ rec }: { rec: Recurrence }) {
  const data = useApp((st) => st.data);
  const today = useApp((st) => st.today);
  const { apply, ask, openModal } = useActions();
  const debt = rec.debtId ? indexOf(data).debts.get(rec.debtId) : undefined;

  const resume = async () => {
    const changes = resumeRecurrence(data, rec.id, today, Date.now());
    const skipped = changes.skips?.length ?? 0;
    await apply(
      changes,
      undefined,
      skipped > 0
        ? `Reprise : ${count(skipped, "mois de pause marqué « ignoré »", "mois de pause marqués « ignorés »")}, rétablissables depuis Opérations`
        : "Récurrence reprise",
    );
  };

  const remove = async () => {
    const ok = await ask({
      title: `Supprimer « ${rec.label} » ?`,
      message: "Plus rien ne sera créé. Les opérations déjà créées restent dans le budget.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    const now = Date.now();
    // Le prélèvement d'une dette se retire par la dette, qui oublie alors son lien.
    const changes =
      debt && debt.deletedAt === null && debt.recurrenceId === rec.id
        ? removeDebtRecurrence(data, debt.id, now)
        : { recurrences: [tombstone(rec, now)] };
    await apply(changes, undefined, "Récurrence supprimée");
  };

  return (
    <li className={cx(s.recurrence, !rec.active && s.paused)}>
      <span className={s.recurrenceTitle}>
        {rec.label}
        {!rec.active && <span className={s.badge}>En pause</span>}
        {debt && debt.deletedAt === null && <span className={s.badge}>Dette « {debt.name} »</span>}
      </span>
      <span className={s.recurrenceTools}>
        <Button size="small" variant="ghost" onClick={() => openModal({ kind: "recurrence", editId: rec.id })} aria-label={`Modifier « ${rec.label} »`}>
          Modifier
        </Button>
        {rec.active ? (
          <Button size="small" variant="ghost" onClick={() => apply(pauseRecurrence(data, rec.id, Date.now()), undefined, "Récurrence en pause")} aria-label={`Mettre « ${rec.label} » en pause`}>
            Pause
          </Button>
        ) : (
          <Button size="small" variant="ghost" onClick={resume} aria-label={`Reprendre « ${rec.label} »`}>
            Reprendre
          </Button>
        )}
        <Button size="small" variant="ghost" onClick={remove} aria-label={`Supprimer « ${rec.label} »`}>
          Supprimer
        </Button>
      </span>
      <span className={s.recurrenceDetail}>{describe(data, rec)}</span>
    </li>
  );
}

export function RecurrencesSection() {
  const data = useApp((st) => st.data);
  const { openModal } = useActions();
  const list = data.collections.recurrences.filter((r) => r.deletedAt === null).sort(byLabel);
  return (
    <Card
      title="Récurrences"
      subtitle="Chaque occurrence est créée le jour venu. Une pause suspend la création ; à la reprise, les mois manqués sont marqués « ignorés »."
    >
      {list.length === 0 ? (
        <p className={s.muted}>Aucune récurrence. Tu peux en créer une ici, ou cocher « répéter chaque mois » à la saisie.</p>
      ) : (
        <ul className={s.list}>
          {list.map((r) => (
            <RecurrenceItem key={r.id} rec={r} />
          ))}
        </ul>
      )}
      <div className={s.actions}>
        <Button onClick={() => openModal({ kind: "recurrence" })}>
          <PlusIcon size={16} />
          Nouvelle récurrence
        </Button>
      </div>
    </Card>
  );
}
