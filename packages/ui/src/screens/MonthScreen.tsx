import {
  averageIncome,
  colorFor,
  indexOf,
  latestOperations,
  monthAggregates,
  monthOf,
  monthTargets,
  plannedOccurrences,
  type AverageWindow,
  type Bucket,
  type Cents,
} from "@cashmyr/core";
import { useMemo } from "react";
import { Select } from "../components/controls";
import { Gauge, SegmentedBar, Stat } from "../components/figures";
import { Card, Empty, Grid, ScreenTitle } from "../components/layout";
import { OperationList, OperationRow } from "../components/OperationRow";
import { categoryName, liveAccounts, BUCKET_LABELS } from "../lib/data";
import { dayShort, money, moneyExact, monthLong, monthTitle, ofMonth } from "../lib/format";
import { useActions, useApp } from "../store/context";
import s from "./MonthScreen.module.css";

const WINDOWS: AverageWindow[] = [3, 6, 12];

/** Texte sous une jauge : écart à la cible, dit dans le sens de l'usage. */
function gaugeCaption(bucket: Bucket, value: Cents, target: Cents) {
  const gap = target - value;
  if (target === 0) return `cible ${money(0)}`;
  if (bucket === "invest") {
    return gap > 0
      ? `cible ${money(target)} · encore ${money(gap)} à mettre de côté`
      : `cible ${money(target)} · dépassée de ${money(-gap)}`;
  }
  return gap >= 0
    ? `cible ${money(target)} · reste ${money(gap)}`
    : `cible ${money(target)} · ${money(-gap)} au-delà`;
}

export function MonthScreen() {
  const data = useApp((st) => st.data);
  const month = useApp((st) => st.month);
  const today = useApp((st) => st.today);
  const { openModal, setPreference } = useActions();

  const future = month > monthOf(today);
  const agg = useMemo(() => monthAggregates(data, month), [data, month]);
  const targets = useMemo(() => monthTargets(data, month), [data, month]);
  const avgWindow = data.preferences.averageWindow;
  const avg = useMemo(() => averageIncome(data, month, avgWindow), [data, month, avgWindow]);
  const latest = useMemo(() => latestOperations(data, month), [data, month]);
  const planned = useMemo(() => plannedOccurrences(data, month, today), [data, month, today]);
  const prefs = data.preferences;
  const noAccount = liveAccounts(data).length === 0;

  const plannedList =
    planned.length > 0 ? (
      <Card title={future ? "Prévu ce mois" : "Prévu d'ici la fin du mois"} subtitle="Lecture seule : les opérations apparaîtront le jour venu.">
        <ul className={s.planned}>
          {planned.map((p) => (
            <li key={`${p.recurrence.id}-${p.month}`}>
              <span className={s.plannedDate}>{dayShort(p.date)}</span>
              <span className={s.plannedLabel}>{p.recurrence.label}</span>
              <span className={s.plannedAmount}>
                {p.recurrence.type === "out" ? "−" : p.recurrence.type === "in" ? "+" : ""}
                {moneyExact(p.amount)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    ) : null;

  if (future) {
    return (
      <div className={s.screen}>
        <ScreenTitle title={monthTitle(month)} />
        <p className={s.note}>Mois à venir : rien n'est créé à l'avance.</p>
        {plannedList ?? <Empty message="Aucune récurrence prévue ce mois-ci." />}
      </div>
    );
  }

  if (noAccount) {
    return (
      <div className={s.screen}>
        <ScreenTitle title={monthTitle(month)} />
        <Empty message="Pour saisir une opération, commence par créer un compte." action={{ label: "Créer un compte", onClick: () => openModal({ kind: "create-account" }) }} />
      </div>
    );
  }

  const sources = agg.incomeBySource.map((src) => {
    const c = indexOf(data).categories.get(src.categoryId);
    return {
      key: src.categoryId,
      label: categoryName(data, src.categoryId),
      value: src.amount,
      color: c ? colorFor(prefs, { kind: "income", category: c }) : "var(--ink-3)",
    };
  });

  const basis =
    targets.basis === "avg"
      ? `Cibles calculées sur la moyenne des ${targets.window} derniers mois (${money(targets.base)}).`
      : targets.fellBack
        ? `Cibles calculées sur les revenus ${ofMonth(month)}, faute de moyenne.`
        : `Cibles calculées sur les revenus ${ofMonth(month)}.`;

  return (
    <div className={s.screen}>
      <section className={s.hero} aria-labelledby="month-income">
        <p className={s.eyebrow} id="month-income">
          Revenus {ofMonth(month)}
        </p>
        <p className={s.big}>{money(agg.income)}</p>
        <div className={s.average}>
          <label htmlFor="avg-window" className="visually-hidden">
            Fenêtre de la moyenne
          </label>
          {avg.value !== null ? (
            <span>
              Moyenne des{" "}
              <Select
                id="avg-window"
                className={s.inlineSelect}
                value={avgWindow}
                onChange={(e) => setPreference("averageWindow", Number(e.target.value) as AverageWindow)}
              >
                {WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>{" "}
              derniers mois : <strong>{money(avg.value)}</strong>
            </span>
          ) : (
            <span>
              Pas encore de moyenne : aucun des{" "}
              <Select
                id="avg-window"
                className={s.inlineSelect}
                value={avgWindow}
                onChange={(e) => setPreference("averageWindow", Number(e.target.value) as AverageWindow)}
              >
                {WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>{" "}
              mois précédents ne contient d'opération.
            </span>
          )}
        </div>
        {sources.length > 0 && <SegmentedBar label="Revenus par source" segments={sources} />}
      </section>

      {agg.count === 0 ? (
        <Empty
          message={`Aucune opération en ${monthLong(month)} pour l'instant.`}
          action={{ label: "Ajouter une opération", onClick: () => openModal({ kind: "operation", type: "out" }) }}
        />
      ) : (
        <>
          <Card title="Répartition" subtitle={basis}>
            <div className={s.gauges}>
              {(["besoin", "envie", "invest"] as Bucket[]).map((bucket) => {
                const value = bucket === "besoin" ? agg.needs : bucket === "envie" ? agg.wants : agg.saved;
                const target = targets.targets[bucket];
                return (
                  <Gauge
                    key={bucket}
                    label={bucket === "invest" ? "Épargne" : BUCKET_LABELS[bucket]}
                    color={colorFor(prefs, { kind: "bucket", bucket })}
                    value={value}
                    target={target}
                    caption={gaugeCaption(bucket, value, target)}
                  />
                );
              })}
            </div>
          </Card>

          <Grid min={180}>
            <Stat label="Dépensé" value={money(agg.spent)} note="Besoins et envies" />
            <Stat label="Mis de côté" value={money(agg.saved)} tone={agg.saved < 0 ? "negative" : "default"} note="Épargne et placements, retraits déduits" />
            <Stat label="Reste sur le courant" value={money(agg.balance)} tone={agg.balance < 0 ? "negative" : "default"} note="Revenus − dépensé − mis de côté" />
          </Grid>

          {agg.unclassified > 0 && (
            <p className={s.warning} role="alert">
              {moneyExact(agg.unclassified)} de dépenses n'ont pas de catégorie reconnue et ne comptent dans aucun usage.
            </p>
          )}
        </>
      )}

      {plannedList}

      {latest.length > 0 && (
        <Card title="Dernières opérations">
          <OperationList>
            {latest.map((op) => (
              <OperationRow key={op.id} data={data} op={op} onOpen={(o) => openModal({ kind: "operation", type: o.type, editId: o.id })} />
            ))}
          </OperationList>
        </Card>
      )}
    </div>
  );
}
