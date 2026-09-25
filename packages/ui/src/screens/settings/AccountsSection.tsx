import {
  accountUsage,
  colorFor,
  deleteAccount,
  isUsed,
  nextStamp,
  touch,
  type Account,
  type AccountUsage,
  type Role,
} from "@cashmyr/core";
import { useId } from "react";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { Button, Checkbox, Field, InlineAmount, InlineOptionalAmount, InlineText, Select } from "../../components/controls";
import { Dot } from "../../components/figures";
import { PlusIcon } from "../../components/icons";
import { Card } from "../../components/layout";
import { liveAccounts, ROLE_LABELS } from "../../lib/data";
import { count, dayLong } from "../../lib/format";
import { useActions, useApp } from "../../store/context";
import s from "./Settings.module.css";

/** « 42 opérations et 1 récurrence » */
export function usageText(usage: Partial<AccountUsage>): string {
  const parts = [
    usage.operations ? count(usage.operations, "opération", "opérations") : "",
    usage.recurrences ? count(usage.recurrences, "récurrence", "récurrences") : "",
    usage.debts ? count(usage.debts, "dette", "dettes") : "",
    usage.goals ? count(usage.goals, "objectif", "objectifs") : "",
  ].filter(Boolean);
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}`;
}

function AccountItem({ account }: { account: Account }) {
  const data = useApp((st) => st.data);
  const today = useApp((st) => st.today);
  const { apply } = useActions();
  const id = useId();
  const usage = accountUsage(data, account.id);
  const save = (patch: Partial<Account>) => apply({ accounts: [touch(account, patch, Date.now())] });

  return (
    <li>
      <div className={s.accountGrid}>
        <Field
          label={
            <span className={s.itemName}>
              <Dot color={colorFor(data.preferences, { kind: "series", color: account.color })} />
              Nom
            </span>
          }
          htmlFor={`${id}-name`}
        >
          <InlineText label="Nom du compte" value={account.name} required onCommit={(name) => save({ name })} />
        </Field>
        <Field label="Type" htmlFor={`${id}-role`} hint="Change aussi la mise de côté des mois passés">
          <Select id={`${id}-role`} value={account.role} onChange={(e) => save({ role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Solde de départ" htmlFor={`${id}-opening`}>
          <InlineAmount label="Solde de départ" allowNegative value={account.opening} onCommit={(opening) => save({ opening })} />
        </Field>
        {/* Un compte courant ne compte jamais que son solde (décision 42) ; une valeur reprise reste modifiable. */}
        {(account.role !== "courant" || account.declaredValue !== undefined) && (
          <Field
            label="Valeur déclarée"
            htmlFor={`${id}-declared`}
            hint={
              account.role === "courant"
                ? "Ignorée pour un compte courant : seul son solde compte"
                : account.declaredAt
                  ? `Déclarée le ${dayLong(account.declaredAt)} ; comptée dans le total des comptes`
                  : "Valeur de marché, comptée dans le total des comptes à la place du capital injecté"
            }
          >
            <InlineOptionalAmount
              label="Valeur déclarée"
              placeholder="Aucune"
              value={account.declaredValue ?? null}
              onCommit={(v) => {
                // Sans valeur, les deux champs disparaissent ; une nouvelle valeur est datée du jour.
                const { declaredValue: _v, declaredAt: _d, ...rest } = account;
                const next: Account = v === null ? rest : { ...rest, declaredValue: v, declaredAt: today };
                void apply({ accounts: [{ ...next, updatedAt: nextStamp(Date.now(), account) }] });
              }}
            />
          </Field>
        )}
      </div>
      <div className={s.itemFoot}>
        <Checkbox label="Épargne de précaution" checked={account.safety} onChange={(e) => save({ safety: e.target.checked })} />
        {isUsed(usage) ? (
          <p className={s.muted}>Utilisé par {usageText(usage)} : il ne peut pas être supprimé.</p>
        ) : (
          <ConfirmDelete label="Supprimer le compte" onConfirm={() => apply(deleteAccount(data, account.id, Date.now()), undefined, "Compte supprimé")} />
        )}
      </div>
    </li>
  );
}

export function AccountsSection() {
  const data = useApp((st) => st.data);
  const { openModal } = useActions();
  const accounts = liveAccounts(data);
  return (
    <Card
      title="Comptes"
      subtitle="Un compte encore utilisé par une opération, une récurrence, une dette ou un objectif ne peut pas être supprimé."
    >
      {accounts.length === 0 ? (
        <p className={s.muted}>Aucun compte pour l'instant.</p>
      ) : (
        <ul className={s.list}>
          {accounts.map((a) => (
            <AccountItem key={a.id} account={a} />
          ))}
        </ul>
      )}
      <div className={s.actions}>
        <Button onClick={() => openModal({ kind: "create-account", stay: true })}>
          <PlusIcon size={16} />
          Ajouter un compte
        </Button>
      </div>
    </Card>
  );
}
