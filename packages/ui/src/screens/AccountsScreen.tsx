import { accountFigures, accountFlows, asOfForYear, colorFor, formatCents, type Cents, type Dataset, type Day } from "@cashmyr/core";
import { useMemo } from "react";
import { Button, cx } from "../components/controls";
import { Dot } from "../components/figures";
import { PlusIcon } from "../components/icons";
import { Card, Empty, ScreenTitle, Stack } from "../components/layout";
import { liveAccounts, ROLE_LABELS } from "../lib/data";
import { dayLong, money } from "../lib/format";
import { useActions, useApp } from "../store/context";
import { AccountsBanner } from "./AccountsBanner";
import s from "./AccountsScreen.module.css";

const signed = (cents: Cents) => formatCents(cents, { decimals: 2, signed: true });

// ── Mouvements de l'année ──────────────────────────────────────────────────

/**
 * Entrées et sorties de l'année, par compte : sorties à gauche, entrées à droite,
 * à la même échelle pour tous les comptes. Les montants sont écrits en toutes lettres.
 */
function YearFlows({ data, year, asOf }: { data: Dataset; year: number; asOf: Day }) {
  const from = `${String(year).padStart(4, "0")}-01-01`;
  const flows = useMemo(() => accountFlows(data, from, asOf), [data, from, asOf]);
  if (from > asOf) return <p className={s.muted}>L'année {year} n'a pas encore commencé.</p>;

  const rows = liveAccounts(data).map((account) => {
    const f = flows.get(account.id);
    return { account, inflow: f?.inflow ?? 0, outflow: f?.outflow ?? 0 };
  });
  if (rows.every((r) => r.inflow === 0 && r.outflow === 0)) return <p className={s.muted}>Aucun mouvement en {year}.</p>;

  const max = Math.max(1, ...rows.map((r) => Math.max(r.inflow, r.outflow)));
  const width = (cents: Cents) => (cents > 0 ? `max(2px, ${(cents / max) * 100}%)` : "0");
  const net = rows.reduce((sum, r) => sum + r.inflow - r.outflow, 0);
  const prefs = data.preferences;

  return (
    <>
      <ul className={s.flows}>
        {rows.map(({ account, inflow, outflow }) => {
          const color = colorFor(prefs, { kind: "series", color: account.color });
          return (
            <li key={account.id} className={s.flow}>
              <div className={s.flowHead}>
                <span className={s.name}>
                  <Dot color={color} />
                  {account.name}
                </span>
                <span className={s.net} title="Variation sur la période">
                  {signed(inflow - outflow)}
                </span>
              </div>
              <div className={s.flowBody}>
                <span className={s.flowOut}>
                  <span className={s.flowLabel}>Sorties</span> {money(outflow)}
                </span>
                <div className={s.butterfly} style={{ ["--c" as string]: color }} aria-hidden="true">
                  <div className={s.side}>
                    <div className={s.barOut} style={{ width: width(outflow) }} />
                  </div>
                  <div className={s.side}>
                    <div className={s.barIn} style={{ width: width(inflow) }} />
                  </div>
                </div>
                <span className={s.flowIn}>
                  <span className={s.flowLabel}>Entrées</span> {money(inflow)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className={s.total}>
        Variation de l'ensemble {asOf.endsWith("-12-31") ? `sur ${year}` : "depuis le 1er janvier"} : <strong>{signed(net)}</strong>
      </p>
    </>
  );
}

// ── Vos comptes ────────────────────────────────────────────────────────────

function AccountList({ data, asOf }: { data: Dataset; asOf: Day }) {
  const figures = useMemo(() => accountFigures(data, asOf), [data, asOf]);
  const prefs = data.preferences;
  return (
    <>
      <ul className={s.accounts}>
        {liveAccounts(data).map((account) => {
          const f = figures.get(account.id);
          if (!f) return null;
          // Le type n'est pas répété quand le nom le dit déjà (« Compte courant »).
          const role = [account.name === ROLE_LABELS[account.role] ? "" : ROLE_LABELS[account.role], account.safety ? "épargne de précaution" : ""]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={account.id} className={s.account}>
              <div className={s.accountHead}>
                <div className={s.titles}>
                  <span className={s.name}>
                    <Dot color={colorFor(prefs, { kind: "series", color: account.color })} />
                    {account.name}
                  </span>
                  {role && <span className={s.muted}>{role}</span>}
                </div>
                <span className={cx(s.balance, f.balance < 0 && s.negative)}>{money(f.balance)}</span>
              </div>
              <p className={s.detail}>
                Départ {money(f.opening)} · {money(f.inflow)} entrés · {money(f.outflow)} sortis
              </p>
              {f.declaredValue !== null && f.declaredGap !== null && (
                <p className={s.detail}>
                  Valeur déclarée {money(f.declaredValue)}
                  {account.declaredAt ? ` le ${dayLong(account.declaredAt)}` : ""} · écart <strong>{signed(f.declaredGap)}</strong> avec le
                  capital injecté
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className={s.muted}>
        Solde = solde de départ, plus tout ce qui est entré, moins tout ce qui est sorti : le capital injecté, jamais une valeur de marché.
      </p>
    </>
  );
}

// ── Écran ──────────────────────────────────────────────────────────────────

export function AccountsScreen() {
  const data = useApp((st) => st.data);
  const year = useApp((st) => st.year);
  const today = useApp((st) => st.today);
  const { openModal } = useActions();
  const asOf = asOfForYear(year, today);
  const accounts = liveAccounts(data);

  if (accounts.length === 0) {
    return <Empty message="Crée ton premier compte pour suivre tes soldes." action={{ label: "Ajouter un compte", onClick: () => openModal({ kind: "create-account" }) }} />;
  }

  const period = asOf.endsWith("-12-31") ? `Du 1er janvier au 31 décembre ${year}` : `Du 1er janvier au ${dayLong(asOf)}`;
  return (
    <Stack gap={18}>
      <ScreenTitle title="Mes comptes" />
      <AccountsBanner data={data} asOf={asOf} today={today} year={year} />
      <div className={s.actions}>
        <Button onClick={() => openModal({ kind: "create-account" })}>
          <PlusIcon size={16} />
          Ajouter un compte
        </Button>
        <Button
          onClick={() => openModal({ kind: "operation", type: "tx" })}
          disabled={accounts.length < 2}
          title={accounts.length < 2 ? "Un transfert demande au moins deux comptes" : undefined}
        >
          Nouveau transfert
        </Button>
      </div>
      <Card title="Mouvements de l'année" subtitle={period}>
        <YearFlows data={data} year={year} asOf={asOf} />
      </Card>
      <Card title="Vos comptes" subtitle={asOf === today ? "Soldes aujourd'hui" : `Soldes au ${dayLong(asOf)}`}>
        <AccountList data={data} asOf={asOf} />
      </Card>
    </Stack>
  );
}
