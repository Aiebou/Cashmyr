import {
  accountFigures,
  accountFlows,
  asOfForYear,
  colorFor,
  declaredAsOf,
  formatCents,
  isFluctuatingRole,
  reorderAccounts,
  type Account,
  type Cents,
  type Dataset,
  type Day,
  type Role,
} from "@cashmyr/core";
import { useMemo, useState } from "react";
import { Button, cx, ToggleChips } from "../components/controls";
import { Dot } from "../components/figures";
import { PlusIcon } from "../components/icons";
import { Card, Empty, ScreenTitle, Stack } from "../components/layout";
import { dropBefore, MoveBar, moveAmongVisible, useReorderDrag } from "../components/Reorderable";
import { liveAccounts, ROLE_LABELS } from "../lib/data";
import { dayLong, money } from "../lib/format";
import { displayOf } from "../store/app-store";
import { useActions, useApp } from "../store/context";
import { AccountsBanner } from "./AccountsBanner";
import s from "./AccountsScreen.module.css";

const signed = (cents: Cents) => formatCents(cents, { decimals: 2, signed: true });

// ── Mouvements de l'année ──────────────────────────────────────────────────

/**
 * Entrées et sorties de l'année, par compte : sorties à gauche, entrées à droite,
 * à la même échelle pour tous les comptes. Les montants sont écrits en toutes lettres.
 */
function YearFlows({ data, accounts, year, asOf }: { data: Dataset; accounts: Account[]; year: number; asOf: Day }) {
  const from = `${String(year).padStart(4, "0")}-01-01`;
  const flows = useMemo(() => accountFlows(data, from, asOf), [data, from, asOf]);
  if (from > asOf) return <p className={s.muted}>L'année {year} n'a pas encore commencé.</p>;

  const rows = accounts.map((account) => {
    const f = flows.get(account.id);
    return { account, inflow: f?.inflow ?? 0, outflow: f?.outflow ?? 0 };
  });
  if (rows.every((r) => r.inflow === 0 && r.outflow === 0)) return <p className={s.muted}>Aucun mouvement en {year} sur ces comptes.</p>;

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
        Variation {rows.length < liveAccounts(data).length ? "de ces comptes" : "de l'ensemble"}{" "}
        {asOf.endsWith("-12-31") ? `sur ${year}` : "depuis le 1er janvier"} : <strong>{signed(net)}</strong>
      </p>
    </>
  );
}

// ── Vos comptes ────────────────────────────────────────────────────────────

type TileProps = {
  data: Dataset;
  account: Account;
  asOf: Day;
  today: Day;
  figures: ReturnType<typeof accountFigures>;
  /** Mode « Modifier l'ordre » : poignée et flèches sur chaque tuile. */
  ordering: { index: number; count: number; onMove(id: string, delta: -1 | 1): void; onDropOn(dragged: string, target: string, after: boolean): void } | null;
};

/**
 * Un compte. Épargne, placement et autre : la valeur déclarée en avant, le capital injecté dessous
 * (décision 42) ; sans valeur déclarée à cette date, le capital injecté, sur fond rouge discret.
 */
function AccountTile({ data, account, asOf, today, figures, ordering }: TileProps) {
  const drag = useReorderDrag(account.id, "application/x-cashmyr-account", (dragged, target, after) => ordering?.onDropOn(dragged, target, after));
  const f = figures.get(account.id);
  if (!f) return null;
  const fluctuating = isFluctuatingRole(account.role);
  const declared = declaredAsOf(account, asOf, today);
  const missing = fluctuating && declared === null;
  const shown = declared ?? f.balance;
  // Le type n'est pas répété quand le nom le dit déjà (« Compte courant »).
  const role = [account.name === ROLE_LABELS[account.role] ? "" : ROLE_LABELS[account.role], account.safety ? "épargne de précaution" : ""]
    .filter(Boolean)
    .join(" · ");
  const draggable = ordering ? drag.container : {};
  return (
    <li className={cx(s.account, missing && s.undeclared, ordering && drag.overClass)} {...draggable}>
      <div className={s.accountHead}>
        <div className={s.titles}>
          <span className={s.name}>
            <Dot color={colorFor(data.preferences, { kind: "series", color: account.color })} />
            {account.name}
          </span>
          {role && <span className={s.muted}>{role}</span>}
        </div>
        <div className={s.figure}>
          <span className={cx(s.balance, shown < 0 && s.negative)}>{money(shown)}</span>
          {declared !== null && <span className={s.figureNote}>valeur déclarée</span>}
          {missing && (
            <span className={s.missing}>{account.declaredValue !== undefined ? "valeur déclarée après cette date" : "valeur non déclarée"}</span>
          )}
        </div>
        {ordering && (
          <MoveBar
            name={account.name}
            what="le compte"
            index={ordering.index}
            count={ordering.count}
            grip={drag.grip}
            onMove={(delta) => ordering.onMove(account.id, delta)}
          />
        )}
      </div>
      {declared !== null && (
        <p className={s.detail}>
          Capital injecté {money(f.balance)} · écart <strong>{signed(declared - f.balance)}</strong>
          {account.declaredAt ? ` · déclarée le ${dayLong(account.declaredAt)}` : ""}
        </p>
      )}
      <p className={s.detail}>
        Départ {money(f.opening)} · {money(f.inflow)} entrés · {money(f.outflow)} sortis
      </p>
    </li>
  );
}

function AccountList({ data, accounts, asOf, today, ordering }: { data: Dataset; accounts: Account[]; asOf: Day; today: Day; ordering: boolean }) {
  const figures = useMemo(() => accountFigures(data, asOf), [data, asOf]);
  const { apply } = useActions();
  // Décision 49 : l'ordre est celui de tous les comptes ; un filtre actif ne déplace que parmi ceux qu'il montre.
  const order = liveAccounts(data).map((a) => a.id);
  const visible = accounts.map((a) => a.id);
  const save = (ids: string[]) => void apply(reorderAccounts(data, ids, Date.now()));
  return (
    <>
      <ul className={s.accounts}>
        {accounts.map((account, index) => (
          <AccountTile
            key={account.id}
            data={data}
            account={account}
            asOf={asOf}
            today={today}
            figures={figures}
            ordering={
              ordering
                ? {
                    index,
                    count: accounts.length,
                    onMove: (id, delta) => save(moveAmongVisible(order, visible, id, delta)),
                    onDropOn: (dragged, target, after) => save(dropBefore(order, dragged, target, after)),
                  }
                : null
            }
          />
        ))}
      </ul>
      <p className={s.muted}>
        Capital injecté = solde de départ, plus tout ce qui est entré, moins tout ce qui est sorti : jamais une valeur de marché. Pour
        les comptes d'épargne, de placement et autres, la valeur déclarée se saisit dans Paramètres → Comptes.
      </p>
    </>
  );
}

const ROLE_FILTERS: { value: Role; label: string }[] = [
  { value: "courant", label: "Comptes courants" },
  { value: "epargne", label: "Épargne" },
  { value: "invest", label: "Placements" },
  { value: "autre", label: "Autres" },
];

// ── Écran ──────────────────────────────────────────────────────────────────

export function AccountsScreen() {
  const data = useApp((st) => st.data);
  const year = useApp((st) => st.year);
  const today = useApp((st) => st.today);
  const roles = displayOf(useApp((st) => st.device)).accountRoles;
  const { openModal, setDisplay } = useActions();
  const [ordering, setOrdering] = useState(false);
  const asOf = asOfForYear(year, today);
  const accounts = liveAccounts(data);
  // Filtre par type, propre à l'appareil ; seuls les types présents sont proposés.
  const present = ROLE_FILTERS.filter((r) => accounts.some((a) => a.role === r.value));
  const active = roles.filter((r) => present.some((p) => p.value === r));
  const shown = active.length === 0 ? accounts : accounts.filter((a) => active.includes(a.role));

  if (accounts.length === 0) {
    return <Empty message="Crée ton premier compte pour suivre tes soldes." action={{ label: "Ajouter un compte", onClick: () => openModal({ kind: "create-account" }) }} />;
  }

  const period = asOf.endsWith("-12-31") ? `Du 1er janvier au 31 décembre ${year}` : `Du 1er janvier au ${dayLong(asOf)}`;
  return (
    <Stack gap={18}>
      <ScreenTitle title="Mes comptes" />
      <AccountsBanner data={data} asOf={asOf} today={today} year={year} />
      <div className={s.actions} data-tour="accounts-actions">
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
      {present.length > 1 && (
        <div data-tour="accounts-filter">
          <ToggleChips
            label="Types de comptes affichés"
            value={active}
            options={present}
            onChange={(accountRoles) => void setDisplay({ accountRoles })}
          />
        </div>
      )}
      <Card title="Mouvements de l'année" subtitle={period}>
        <YearFlows data={data} accounts={shown} year={year} asOf={asOf} />
      </Card>
      <Card
        tour="accounts-list"
        title="Vos comptes"
        subtitle={asOf === today ? "Soldes aujourd'hui" : `Soldes au ${dayLong(asOf)}`}
        actions={
          shown.length > 1 && (
            <Button variant="ghost" size="small" aria-pressed={ordering} onClick={() => setOrdering((o) => !o)}>
              {ordering ? "Terminé" : "Modifier l'ordre"}
            </Button>
          )
        }
      >
        {ordering && <p className={s.muted}>L'ordre choisi vaut partout, sur tous tes appareils : bandeau, listes et saisie.</p>}
        <AccountList data={data} accounts={shown} asOf={asOf} today={today} ordering={ordering} />
      </Card>
    </Stack>
  );
}
