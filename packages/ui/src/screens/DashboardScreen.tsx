import {
  asOfForYear,
  colorFor,
  dashboardDebts,
  dashboardGoals,
  debtView,
  goalView,
  monthAggregates,
  monthOf,
  monthRange,
  monthTargets,
  normalizeDashOrder,
  safetyStatus,
  yearOf,
  yearSummary,
  type Bucket,
  type DashBlock,
  type Dataset,
  type Day,
  type Goal,
} from "@cashmyr/core";
import { useMemo, type ReactNode } from "react";
import { MonthsChart } from "../components/charts/MonthsChart";
import { RankingChart } from "../components/charts/RankingChart";
import { SavingsChart } from "../components/charts/SavingsChart";
import { Button } from "../components/controls";
import { Gauge, Stat } from "../components/figures";
import { Card, Empty, Grid } from "../components/layout";
import { dropBefore, moveAmongVisible, ReorderableBlock } from "../components/Reorderable";
import { debtSentence } from "../lib/debt-text";
import { BUCKET_LABELS, categoryName } from "../lib/data";
import { count, dayLong, money, ofMonth, oneDecimal, ratio, timeLeft } from "../lib/format";
import { targetCaption } from "../lib/targets-text";
import type { Tab } from "../store/app-store";
import { useActions, useApp } from "../store/context";
import { AccountsBanner } from "./AccountsBanner";
import s from "./DashboardScreen.module.css";

const TITLES: Record<DashBlock, string> = {
  goals: "Objectifs",
  debts: "Dettes",
  stats: "Indicateurs de l'année",
  months: "Douze mois",
  savings: "Progression de l'épargne",
  cats: "Postes de dépense",
};

// ── Blocs ──────────────────────────────────────────────────────────────────

function GoalsBlock({ data, asOf, today }: { data: Dataset; asOf: Day; today: Day }) {
  const { setTab } = useActions();
  const prefs = data.preferences;
  const safety = safetyStatus(data, asOf, today);
  const showSafety = !prefs.safety.hidden && (!safety.reached || prefs.safety.pinned);
  const goals = dashboardGoals(data);
  const pinned = goals.filter((g) => g.pinned);
  const others = goals.filter((g) => !g.pinned);

  const safetyItem = showSafety ? (
    <div key="safety" className={s.item}>
      <Gauge
        label="Épargne de précaution"
        color={colorFor(prefs, { kind: "bucket", bucket: "invest" })}
        value={safety.constituted}
        target={safety.objective}
        caption={
          safety.objective !== null
            ? `${money(safety.constituted)} sur ${money(safety.objective)}${safety.reached ? " · atteint" : ""}`
            : false
        }
      />
      <p className={s.note}>
        {safety.capacityMonths !== null
          ? `Capacité actuelle : ${oneDecimal(safety.capacityMonths)} mois de dépenses courantes`
          : "Capacité : pas encore de dépenses moyennes"}
      </p>
    </div>
  ) : null;

  const goalItem = (g: Goal) => {
    const v = goalView(data, g, asOf, today);
    const d = v.deadline;
    return (
      <div key={g.id} className={s.item}>
        <Gauge
          label={g.name}
          color={colorFor(prefs, { kind: "series", color: g.color })}
          value={v.progress}
          target={v.target}
          caption={`${money(v.progress)} sur ${money(v.target)}${g.done ? " · atteint" : ""}`}
        />
        {d?.status === "upcoming" && (
          <p className={s.note}>
            Dans {timeLeft(d.timeLeft!)} · {money(d.monthlyNeeded!)} par mois
          </p>
        )}
        {d?.status === "overdue" && <p className={`${s.note} ${s.overdue}`}>Échéance dépassée le {dayLong(d.due)}</p>}
      </div>
    );
  };

  const items = [
    ...(prefs.safety.pinned && safetyItem ? [safetyItem] : []),
    ...pinned.map(goalItem),
    ...(!prefs.safety.pinned && safetyItem ? [safetyItem] : []),
    ...others.map(goalItem),
  ];

  if (items.length === 0) {
    return <Empty message="Aucun objectif affiché ici." action={{ label: "Voir les objectifs", onClick: () => setTab("goals") }} />;
  }
  return <div className={s.items}>{items}</div>;
}

function DebtsBlock({ data, asOf, today }: { data: Dataset; asOf: Day; today: Day }) {
  const prefs = data.preferences;
  const debts = dashboardDebts(data);
  if (debts.length === 0) return <p className={s.note}>Aucune dette à afficher : elles sont soldées, masquées ou archivées.</p>;
  return (
    <div className={s.items}>
      {debts.map((d) => {
        const v = debtView(data, d, asOf, today);
        return (
          <div key={d.id} className={s.item}>
            <Gauge
              label={d.name}
              color={colorFor(prefs, { kind: "series", color: d.color })}
              value={v.paid}
              target={v.total}
              caption={`${money(Math.max(0, v.paid))} réglés sur ${money(v.total)}`}
            />
            <p className={`${s.note} ${v.next?.status === "overdue" ? s.overdue : ""}`}>{debtSentence(v, today)}</p>
          </div>
        );
      })}
    </div>
  );
}

function StatsBlock({ data, year, today }: { data: Dataset; year: number; today: Day }) {
  const ys = useMemo(() => yearSummary(data, year, today), [data, year, today]);
  const n = ys.averageIncome.months.length;
  const over = n > 0 ? `sur ${count(n, "mois écoulé", "mois écoulés")} de ${year}` : "aucun mois écoulé pour l'instant";
  return (
    <Grid min={170}>
      <Stat label="Revenu moyen" value={ys.averageIncome.value !== null ? money(ys.averageIncome.value) : "—"} note={over} />
      <Stat label="Taux d'épargne de l'année" value={ys.savingsRate !== null ? ratio(ys.savingsRate) : "—"} note="Mis de côté ÷ revenus" />
      <Stat label="Dépenses moyennes par mois" value={ys.averageSpending.value !== null ? money(ys.averageSpending.value) : "—"} note={`Besoins et envies, ${over}`} />
    </Grid>
  );
}

function MonthsBlock({ data, year, today }: { data: Dataset; year: number; today: Day }) {
  const ys = useMemo(() => yearSummary(data, year, today), [data, year, today]);
  const prefs = data.preferences;
  if (ys.months.every((m) => m.count === 0)) return <p className={s.note}>Aucune opération en {year}.</p>;
  return (
    <MonthsChart
      months={ys.months}
      colors={{
        besoin: colorFor(prefs, { kind: "bucket", bucket: "besoin" }),
        envie: colorFor(prefs, { kind: "bucket", bucket: "envie" }),
        invest: colorFor(prefs, { kind: "bucket", bucket: "invest" }),
      }}
    />
  );
}

function SavingsBlock({ data, year, today }: { data: Dataset; year: number; today: Day }) {
  const ys = useMemo(() => yearSummary(data, year, today), [data, year, today]);
  const y = String(year).padStart(4, "0");
  if (ys.savingsCurve.length === 0) return <p className={s.note}>L'année {year} n'a pas encore commencé.</p>;
  return (
    <SavingsChart
      months={monthRange(`${y}-01`, `${y}-12`)}
      points={ys.savingsCurve}
      color={colorFor(data.preferences, { kind: "bucket", bucket: "invest" })}
      today={today}
    />
  );
}

function CategoriesBlock({ data, year, today }: { data: Dataset; year: number; today: Day }) {
  const ys = useMemo(() => yearSummary(data, year, today), [data, year, today]);
  const prefs = data.preferences;
  if (ys.ranking.length === 0) return <p className={s.note}>Aucune dépense courante en {year}.</p>;
  return (
    <RankingChart
      items={ys.ranking.map((r) => ({ key: r.categoryId, label: categoryName(data, r.categoryId), amount: r.amount, bucket: r.bucket }))}
      colors={{
        besoin: colorFor(prefs, { kind: "bucket", bucket: "besoin" }),
        envie: colorFor(prefs, { kind: "bucket", bucket: "envie" }),
      }}
    />
  );
}

/**
 * Ce qui reste avant chaque cible du mois en cours : besoins et envies en rouge au-delà,
 * épargne encore à mettre de côté. Mêmes jauges que la Répartition de l'écran Mois.
 */
function MonthTargetsCard({ data, today }: { data: Dataset; today: Day }) {
  const { setMonth, setTab } = useActions();
  const month = monthOf(today);
  const agg = useMemo(() => monthAggregates(data, month), [data, month]);
  const targets = useMemo(() => monthTargets(data, month), [data, month]);
  const prefs = data.preferences;
  const open = () => {
    setMonth(month);
    setTab("month");
  };
  return (
    <Card
      tour="targets"
      title={`Cibles ${ofMonth(month)}`}
      subtitle="Encore à atteindre ce mois-ci"
      actions={
        <Button variant="ghost" size="small" onClick={open}>
          Voir le mois
        </Button>
      }
    >
      {targets.base === 0 ? (
        <p className={s.note}>Pas encore de revenus ce mois-ci : les cibles se calculent à partir des revenus.</p>
      ) : (
        <div className={s.items}>
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
      )}
    </Card>
  );
}

// ── Écran ──────────────────────────────────────────────────────────────────

export function DashboardScreen() {
  const data = useApp((st) => st.data);
  const year = useApp((st) => st.year);
  const today = useApp((st) => st.today);
  const { setPreference, setTab, openModal } = useActions();
  const asOf = asOfForYear(year, today);

  const hasAccounts = data.collections.accounts.some((a) => a.deletedAt === null);
  const hasDebts = data.collections.debts.some((d) => d.deletedAt === null);
  const order = normalizeDashOrder(data.preferences.dashOrder);
  const visible = order.filter((k) => k !== "debts" || hasDebts);

  if (!hasAccounts) {
    return <Empty message="Crée ton premier compte pour voir le tableau de bord." action={{ label: "Créer un compte", onClick: () => openModal({ kind: "create-account" }) }} />;
  }

  const link = (label: string, tab: Tab) => (
    <Button variant="ghost" size="small" onClick={() => setTab(tab)}>
      {label}
    </Button>
  );

  const content: Record<DashBlock, ReactNode> = {
    goals: <GoalsBlock data={data} asOf={asOf} today={today} />,
    debts: <DebtsBlock data={data} asOf={asOf} today={today} />,
    stats: <StatsBlock data={data} year={year} today={today} />,
    months: <MonthsBlock data={data} year={year} today={today} />,
    savings: <SavingsBlock data={data} year={year} today={today} />,
    cats: <CategoriesBlock data={data} year={year} today={today} />,
  };
  const actions: Partial<Record<DashBlock, ReactNode>> = {
    goals: link("Tout voir", "goals"),
    debts: link("Tout voir", "debts"),
  };

  return (
    <div className={s.screen}>
      <AccountsBanner data={data} asOf={asOf} today={today} year={year} />
      {year === yearOf(today) && <MonthTargetsCard data={data} today={today} />}
      {visible.map((key, i) => (
        <ReorderableBlock
          key={key}
          id={key}
          title={TITLES[key]}
          index={i}
          count={visible.length}
          action={actions[key]}
          {...(i === 0 ? { tour: "blocks" } : {})}
          onMove={(id, delta) => setPreference("dashOrder", moveAmongVisible(order, visible, id as DashBlock, delta))}
          onDropOn={(dragged, target, after) =>
            setPreference("dashOrder", dropBefore(order, dragged as DashBlock, target as DashBlock, after))
          }
        >
          {content[key]}
        </ReorderableBlock>
      ))}
    </div>
  );
}
