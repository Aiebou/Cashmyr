import {
  compareOpsDesc,
  indexOf,
  monthOf,
  occurrenceAmount,
  occurrenceDate,
  plannedOccurrences,
  restoreOccurrence,
  skippedInMonth,
  type Dataset,
  type Month,
  type Operation,
  type OpType,
  type Recurrence,
  type Skip,
} from "@cashmyr/core";
import { useMemo, useState } from "react";
import { Button, Segmented, Select, TextInput } from "../components/controls";
import { RestoreIcon } from "../components/icons";
import { Card, Empty, ScreenTitle, Stack } from "../components/layout";
import { OperationList, OperationRow } from "../components/OperationRow";
import { PlannedList } from "../components/PlannedList";
import { expenseGroups, liveAccounts, liveCategories } from "../lib/data";
import { hasFilters, matchesFilters, NO_FILTERS, type OperationFilters } from "../lib/filters";
import { count, dayHeading, dayShort, monthLong, money, ofMonth } from "../lib/format";
import { useActions, useApp } from "../store/context";
import s from "./OperationsScreen.module.css";

const TYPES: { value: OperationFilters["type"]; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "out", label: "Dépenses" },
  { value: "in", label: "Revenus" },
  { value: "tx", label: "Transferts" },
];

const TOTAL_LABELS: Record<OpType, string> = { out: "Dépenses", in: "Revenus", tx: "Transferts" };

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "fr");

/** Objectifs et dettes non supprimés, archivés compris : leurs opérations restent dans l'historique. */
const tagOptions = <T extends { id: string; name: string; deletedAt: number | null; archived: boolean }>(items: readonly T[]) =>
  items
    .filter((i) => i.deletedAt === null)
    .sort(byName)
    .map((i) => ({ id: i.id, label: i.archived ? `${i.name} (archivé)` : i.name }));

// ── Filtres ────────────────────────────────────────────────────────────────

function Filters({ data, value, onChange }: { data: Dataset; value: OperationFilters; onChange(f: OperationFilters): void }) {
  const set = (patch: Partial<OperationFilters>) => onChange({ ...value, ...patch });
  const goals = tagOptions(data.collections.goals);
  const debts = tagOptions(data.collections.debts);
  const incomes = liveCategories(data, "in");
  const groups = expenseGroups(data);

  const setType = (type: OperationFilters["type"]) => {
    // Une catégorie de l'autre nature ne peut plus rien trouver.
    const category = value.categoryId ? indexOf(data).categories.get(value.categoryId) : undefined;
    const keep = category !== undefined && (type === "all" || category.kind === type);
    set({ type, categoryId: keep ? value.categoryId : "" });
  };

  return (
    <div className={s.filters} role="search" aria-label="Filtrer les opérations">
      <div className={s.searchRow}>
        <TextInput
          type="search"
          className={s.search}
          aria-label="Rechercher dans les libellés"
          placeholder="Rechercher un libellé"
          value={value.query}
          onChange={(e) => set({ query: e.target.value })}
        />
        <Segmented label="Type d'opération" value={value.type} options={TYPES} onChange={setType} />
      </div>
      <div className={s.selects}>
        <Select aria-label="Catégorie" value={value.categoryId} disabled={value.type === "tx"} onChange={(e) => set({ categoryId: e.target.value })}>
          <option value="">Catégories</option>
          {value.type !== "out" && (
            <optgroup label="Revenus">
              {incomes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
          {value.type !== "in" &&
            groups.map((g) => (
              <optgroup key={g.bucket} label={g.label}>
                {g.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
        </Select>
        <Select aria-label="Compte" value={value.accountId} onChange={(e) => set({ accountId: e.target.value })}>
          <option value="">Comptes</option>
          {liveAccounts(data).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        {goals.length > 0 && (
          <Select aria-label="Objectif" value={value.goalId} onChange={(e) => set({ goalId: e.target.value })}>
            <option value="">Objectifs</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </Select>
        )}
        {debts.length > 0 && (
          <Select aria-label="Dette" value={value.debtId} onChange={(e) => set({ debtId: e.target.value })}>
            <option value="">Dettes</option>
            {debts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        )}
      </div>
    </div>
  );
}

// ── Récurrences ignorées ───────────────────────────────────────────────────

function SkippedList({ data, month, items }: { data: Dataset; month: Month; items: { skip: Skip; recurrence: Recurrence }[] }) {
  const today = useApp((st) => st.today);
  const { apply } = useActions();
  return (
    <Card title="Récurrences ignorées ce mois" subtitle="Annulées ou mises en pause : rien n'a été créé pour ce mois.">
      <ul className={s.skipped}>
        {items.map(({ skip, recurrence }) => {
          // Ce que le rétablissement produirait, échéancier d'une dette compris.
          const amount = occurrenceAmount(data, recurrence, month);
          const sign = recurrence.type === "out" ? "−" : recurrence.type === "in" ? "+" : "";
          return (
            <li key={skip.id}>
              <span className={s.skippedDate}>{dayShort(occurrenceDate(recurrence, month))}</span>
              <span className={s.skippedLabel}>{recurrence.label}</span>
              <span className={s.skippedAmount}>{amount !== null ? `${sign}${money(amount)}` : "—"}</span>
              <Button
                size="small"
                variant="ghost"
                aria-label={`Rétablir « ${recurrence.label} »`}
                onClick={() => apply(restoreOccurrence(data, recurrence.id, month, today, Date.now()), undefined, "Occurrence rétablie")}
              >
                <RestoreIcon size={16} />
                Rétablir
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── Écran ──────────────────────────────────────────────────────────────────

export function OperationsScreen() {
  const data = useApp((st) => st.data);
  const month = useApp((st) => st.month);
  const today = useApp((st) => st.today);
  const { openModal } = useActions();
  const [filters, setFilters] = useState<OperationFilters>(NO_FILTERS);

  const all = useMemo(() => [...(indexOf(data).opsByMonth.get(month) ?? [])].sort(compareOpsDesc), [data, month]);
  const shown = useMemo(() => all.filter((op) => matchesFilters(data, op, filters)), [all, data, filters]);
  const planned = useMemo(() => plannedOccurrences(data, month, today), [data, month, today]);
  const skipped = useMemo(
    () =>
      skippedInMonth(data, month)
        .filter((x): x is { skip: Skip; recurrence: Recurrence } => x.recurrence !== undefined && x.recurrence.deletedAt === null)
        .sort((a, b) => a.recurrence.dayOfMonth - b.recurrence.dayOfMonth || a.recurrence.label.localeCompare(b.recurrence.label, "fr")),
    [data, month],
  );
  const future = month > monthOf(today);
  const filtered = hasFilters(filters);
  const open = (op: Operation) => openModal({ kind: "operation", type: op.type, editId: op.id });

  if (liveAccounts(data).length === 0) {
    return (
      <Stack gap={18}>
        <ScreenTitle title={`Opérations ${ofMonth(month)}`} />
        <Empty message="Pour saisir une opération, commence par créer un compte." action={{ label: "Créer un compte", onClick: () => openModal({ kind: "create-account" }) }} />
      </Stack>
    );
  }

  const totals = shown.reduce<Record<OpType, number>>((t, op) => ({ ...t, [op.type]: t[op.type] + op.amount }), { out: 0, in: 0, tx: 0 });
  const summary = [
    filtered ? `${count(shown.length, "opération", "opérations")} sur ${all.length}` : count(shown.length, "opération", "opérations"),
    ...(["out", "in", "tx"] as OpType[]).filter((t) => totals[t] > 0).map((t) => `${TOTAL_LABELS[t]} ${money(totals[t])}`),
  ].join(" · ");

  let list;
  if (all.length === 0) {
    list = future ? (
      <p className={s.muted}>Mois à venir : rien n'est créé à l'avance.</p>
    ) : (
      <Empty
        message={`Aucune opération en ${monthLong(month)}.`}
        action={{ label: "Ajouter une opération", onClick: () => openModal({ kind: "operation", type: "out" }) }}
      />
    );
  } else if (shown.length === 0) {
    list = <Empty message="Aucune opération ne correspond aux filtres." action={{ label: "Effacer les filtres", onClick: () => setFilters(NO_FILTERS) }} />;
  } else {
    // Groupées par jour, le plus récent d'abord : la date reste lisible au doigt.
    const days = new Map<string, Operation[]>();
    for (const op of shown) days.set(op.date, [...(days.get(op.date) ?? []), op]);
    list = (
      <div className={s.days}>
        {[...days].map(([date, ops]) => (
          <section key={date} aria-labelledby={`day-${date}`}>
            <h4 className={s.day} id={`day-${date}`}>
              {dayHeading(date)}
            </h4>
            <OperationList>
              {ops.map((op) => (
                <OperationRow key={op.id} data={data} op={op} onOpen={open} showDate={false} />
              ))}
            </OperationList>
          </section>
        ))}
      </div>
    );
  }

  return (
    <Stack gap={18}>
      <ScreenTitle title={`Opérations ${ofMonth(month)}`} />
      {all.length > 0 && <Filters data={data} value={filters} onChange={setFilters} />}
      {all.length > 0 ? (
        <Card>
          <div className={s.summary}>
            <p aria-live="polite">{summary}</p>
            {filtered && (
              <Button size="small" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
                Effacer les filtres
              </Button>
            )}
          </div>
          {list}
        </Card>
      ) : (
        list
      )}
      {skipped.length > 0 && <SkippedList data={data} month={month} items={skipped} />}
      <PlannedList planned={planned} future={future} />
    </Stack>
  );
}
