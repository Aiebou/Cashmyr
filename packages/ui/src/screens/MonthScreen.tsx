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
} from "@cashmyr/core";
import { useMemo } from "react";
import chartStyles from "../components/charts/charts.module.css";
import { DonutChart } from "../components/charts/DonutChart";
import { Button, cx, Select } from "../components/controls";
import { Gauge, SegmentedBar, Stat } from "../components/figures";
import { Card, Empty, Grid, ScreenTitle } from "../components/layout";
import { OperationList, OperationRow } from "../components/OperationRow";
import { PlannedList } from "../components/PlannedList";
import { categoryName, liveAccounts, BUCKET_LABELS } from "../lib/data";
import { money, monthLong, monthTitle, ofMonth } from "../lib/format";
import { expenseSlices, incomeSlices } from "../lib/month-charts";
import { targetCaption } from "../lib/targets-text";
import { displayOf } from "../store/app-store";
import { useActions, useApp } from "../store/context";
import s from "./MonthScreen.module.css";

const WINDOWS: AverageWindow[] = [3, 6, 12];

export function MonthScreen() {
  const data = useApp((st) => st.data);
  const month = useApp((st) => st.month);
  const today = useApp((st) => st.today);
  const { openModal, setPreference, setDisplay } = useActions();
  const hideCharts = displayOf(useApp((st) => st.device)).hideMonthCharts;

  const future = month > monthOf(today);
  const agg = useMemo(() => monthAggregates(data, month), [data, month]);
  const targets = useMemo(() => monthTargets(data, month), [data, month]);
  const avgWindow = data.preferences.averageWindow;
  const avg = useMemo(() => averageIncome(data, month, avgWindow), [data, month, avgWindow]);
  const latest = useMemo(() => latestOperations(data, month), [data, month]);
  const planned = useMemo(() => plannedOccurrences(data, month, today), [data, month, today]);
  const prefs = data.preferences;
  const noAccount = liveAccounts(data).length === 0;

  const plannedList = planned.length > 0 ? <PlannedList planned={planned} future={future} /> : null;

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

  // Camemberts du mois (version 0.2.0) : à droite et figés sur grand écran, sous l'en-tête sinon.
  const charts = agg.count > 0 && !hideCharts;

  return (
    <div className={cx(s.screen, charts && s.withCharts)}>
      <section className={s.hero} aria-labelledby="month-income">
        <div className={s.heroHead}>
          <p className={s.eyebrow} id="month-income">
            Revenus {ofMonth(month)}
          </p>
          {agg.count > 0 && hideCharts && (
            <Button variant="ghost" size="small" onClick={() => void setDisplay({ hideMonthCharts: false })}>
              Afficher les graphiques
            </Button>
          )}
        </div>
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

      {charts && (
        <aside className={s.charts} aria-label="Graphiques du mois" data-tour="month-charts">
          <div className={s.chartsHead}>
            <span>Graphiques du mois</span>
            <Button variant="ghost" size="small" onClick={() => void setDisplay({ hideMonthCharts: true })}>
              Masquer
            </Button>
          </div>
          <Card title="Dépenses par poste" className={chartStyles.donutCard}>
            <DonutChart
              label={`Dépenses ${ofMonth(month)} par poste, épargne comprise`}
              slices={expenseSlices(data, agg.spendingByCategory)}
              empty="Aucune dépense ce mois-ci."
            />
          </Card>
          <Card title="Revenus par source" className={chartStyles.donutCard}>
            <DonutChart label={`Revenus ${ofMonth(month)} par source`} slices={incomeSlices(data, agg.incomeBySource)} empty="Aucun revenu ce mois-ci." />
          </Card>
        </aside>
      )}

      <div className={s.body}>

        {agg.count === 0 ? (
          <Empty
            message={`Aucune opération en ${monthLong(month)} pour l'instant.`}
            action={{ label: "Ajouter une opération", onClick: () => openModal({ kind: "operation", type: "out" }) }}
          />
        ) : (
          <>
            <Card title="Répartition" subtitle={basis} tour="month-split">
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
                      caption={targetCaption(bucket, value, target)}
                      warnOver={bucket !== "invest"}
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
                {money(agg.unclassified)} de dépenses n'ont pas de catégorie reconnue et ne comptent dans aucun usage.
              </p>
            )}
          </>
        )}

        {plannedList}

        {latest.length > 0 && (
          <Card title="Dernières opérations" tour="month-ops">
            <OperationList>
              {latest.map((op) => (
                <OperationRow key={op.id} data={data} op={op} onOpen={(o) => openModal({ kind: "operation", type: o.type, editId: o.id })} />
              ))}
            </OperationList>
          </Card>
        )}
      </div>
    </div>
  );
}
