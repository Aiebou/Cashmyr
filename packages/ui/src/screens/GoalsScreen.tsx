import {
  accountFigures,
  asOfForYear,
  colorFor,
  createRecord,
  goalStepsOf,
  goalsByState,
  goalView,
  isValidDay,
  newId,
  safetyStatus,
  tombstone,
  touch,
  type Cents,
  type Goal,
  type GoalStep,
  type Preferences,
} from "@cashmyr/core";
import { useId, useMemo, useState, type FormEvent } from "react";
import {
  AmountInput,
  Button,
  Checkbox,
  Field,
  FieldRow,
  IconButton,
  InlineAmount,
  InlineText,
  Segmented,
  Select,
  TextInput,
} from "../components/controls";
import { Gauge } from "../components/figures";
import { ArchiveIcon, ArrowDownIcon, ArrowUpIcon, CheckIcon, EyeIcon, EyeOffIcon, PinIcon, RestoreIcon, TrashIcon } from "../components/icons";
import { Card, ScreenTitle, SectionTitle, Stack } from "../components/layout";
import { liveAccounts, nextColor } from "../lib/data";
import { dayLong, money, oneDecimal, ratio, timeLeft } from "../lib/format";
import { useActions, useApp } from "../store/context";
import s from "./GoalsScreen.module.css";

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** Suppression définitive en deux temps. */
function ConfirmDelete({ label, onConfirm }: { label: string; onConfirm(): void }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button variant="danger" size="small" onClick={() => setArmed(true)}>
        <TrashIcon size={16} />
        {label}
      </Button>
    );
  }
  return (
    <div className={s.confirm} role="group" aria-label="Confirmer la suppression">
      <span>Supprimer définitivement ? C'est irréversible.</span>
      <Button variant="danger" size="small" onClick={onConfirm}>
        Supprimer
      </Button>
      <Button variant="ghost" size="small" onClick={() => setArmed(false)}>
        Annuler
      </Button>
    </div>
  );
}

// ── Épargne de précaution ──────────────────────────────────────────────────

function SafetyCard({ asOf }: { asOf: string }) {
  const data = useApp((st) => st.data);
  const today = useApp((st) => st.today);
  const { apply, setPreference } = useActions();
  const prefs = data.preferences;
  const safety = prefs.safety;
  const status = useMemo(() => safetyStatus(data, asOf, today), [data, asOf, today]);
  const figures = useMemo(() => accountFigures(data, asOf), [data, asOf]);
  const accounts = liveAccounts(data);
  const id = useId();
  const setSafety = (patch: Partial<Preferences["safety"]>) => setPreference("safety", { ...safety, ...patch });

  const objectiveLine =
    safety.mode === "amount"
      ? `Objectif : ${money(safety.amount)}`
      : status.objective !== null
        ? `Objectif : ${safety.months} mois de dépenses courantes, soit ${money(status.objective)}`
        : `Objectif : ${safety.months} mois de dépenses courantes, dès qu'une moyenne sera disponible`;

  return (
    <Card
      title="Épargne de précaution"
      subtitle={status.reached ? "Objectif atteint" : undefined}
      actions={
        <>
          <IconButton
            label={safety.hidden ? "Afficher au tableau de bord" : "Masquer du tableau de bord"}
            aria-pressed={safety.hidden}
            onClick={() => setSafety({ hidden: !safety.hidden })}
          >
            {safety.hidden ? <EyeOffIcon /> : <EyeIcon />}
          </IconButton>
          <IconButton label={safety.pinned ? "Désépingler" : "Épingler en tête"} aria-pressed={safety.pinned} onClick={() => setSafety({ pinned: !safety.pinned })}>
            <PinIcon filled={safety.pinned} />
          </IconButton>
        </>
      }
    >
      <Gauge
        label="Constituée"
        color={colorFor(prefs, { kind: "bucket", bucket: "invest" })}
        value={status.constituted}
        target={status.objective}
        caption={status.objective !== null ? `${money(status.constituted)} sur ${money(status.objective)}` : false}
      />
      <div className={s.lines}>
        <p>{objectiveLine}</p>
        <p className={s.capacity}>
          {status.capacityMonths !== null
            ? `Capacité actuelle : ${oneDecimal(status.capacityMonths)} mois de dépenses courantes`
            : "Capacité actuelle : pas encore de dépenses moyennes pour la calculer"}
        </p>
        {status.averageSpending !== null && (
          <p className={s.muted}>
            Dépenses courantes moyennes : {money(status.averageSpending)} par mois, sur les {prefs.averageWindow} derniers mois.
          </p>
        )}
      </div>

      <fieldset className={s.fieldset}>
        <legend>Comptes qui la composent</legend>
        {accounts.length === 0 ? (
          <p className={s.muted}>Aucun compte pour l'instant.</p>
        ) : (
          accounts.map((a) => (
            <Checkbox
              key={a.id}
              checked={a.safety}
              onChange={(e) => apply({ accounts: [touch(a, { safety: e.target.checked }, Date.now())] })}
              label={
                <span className={s.accountLabel}>
                  {a.name}
                  <span className={s.muted}>{money(figures.get(a.id)?.balance ?? 0)}</span>
                </span>
              }
            />
          ))
        )}
      </fieldset>

      <FieldRow>
        <Field label="Objectif exprimé en" htmlFor={`${id}-mode`}>
          <Segmented
            label="Objectif exprimé en"
            value={safety.mode}
            options={[
              { value: "months", label: "Mois de dépenses" },
              { value: "amount", label: "Montant fixe" },
            ]}
            onChange={(mode) => setSafety({ mode })}
          />
        </Field>
        <Field label="Nombre de mois" htmlFor={`${id}-months`} hidden={safety.mode !== "months"}>
          <Select id={`${id}-months`} value={safety.months} onChange={(e) => setSafety({ months: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m} mois
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Montant" htmlFor={`${id}-amount`} hidden={safety.mode !== "amount"}>
          <InlineAmount label="Montant de l'objectif" value={safety.amount} onCommit={(amount) => setSafety({ amount })} />
        </Field>
      </FieldRow>
    </Card>
  );
}

// ── Objectif ───────────────────────────────────────────────────────────────

function StepsEditor({ goal }: { goal: Goal }) {
  const data = useApp((st) => st.data);
  const { apply } = useActions();
  const steps = goalStepsOf(data, goal.id);
  const id = useId();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState<Cents | null>(null);
  const [formKey, setFormKey] = useState(0);
  const save = (step: GoalStep, patch: Partial<GoalStep>) => apply({ goalSteps: [touch(step, patch, Date.now())] });

  const move = (index: number, delta: number) => {
    const other = steps[index + delta];
    const step = steps[index];
    if (!other || !step) return;
    const now = Date.now();
    apply({ goalSteps: [touch(step, { position: other.position }, now), touch(other, { position: step.position }, now)] });
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim() || amount === null) return;
    const position = steps.reduce((max, st) => Math.max(max, st.position), 0) + 1;
    const step = createRecord<GoalStep>(newId(), { goalId: goal.id, label: label.trim(), amount, done: false, position }, Date.now());
    if (await apply({ goalSteps: [step] })) {
      setLabel("");
      setAmount(null);
      setFormKey((k) => k + 1);
    }
  };

  return (
    <div className={s.steps}>
      <p className={s.subhead}>Postes</p>
      {steps.length > 0 && (
        <ul className={s.stepList}>
          {steps.map((step, i) => (
            <li key={step.id} className={s.step}>
              <input
                type="checkbox"
                className={s.stepCheck}
                checked={step.done}
                aria-label={`${step.label} réglé`}
                onChange={(e) => save(step, { done: e.target.checked })}
              />
              <InlineText label="Libellé du poste" value={step.label} required onCommit={(v) => save(step, { label: v })} />
              <InlineAmount label="Montant du poste" value={step.amount} onCommit={(v) => save(step, { amount: v })} />
              <span className={s.stepTools}>
                <IconButton label="Monter" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUpIcon size={16} />
                </IconButton>
                <IconButton label="Descendre" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDownIcon size={16} />
                </IconButton>
                <IconButton label="Supprimer le poste" onClick={() => apply({ goalSteps: [tombstone(step, Date.now())] })}>
                  <TrashIcon size={16} />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form key={formKey} className={s.addStep} onSubmit={add}>
        <TextInput aria-label="Nouveau poste" placeholder="Nouveau poste" value={label} onChange={(e) => setLabel(e.target.value)} id={`${id}-label`} />
        <AmountInput aria-label="Montant du nouveau poste" placeholder="0,00" onAmount={setAmount} />
        <Button type="submit" size="small" disabled={!label.trim() || amount === null}>
          Ajouter
        </Button>
      </form>
    </div>
  );
}

function GoalSettings({ goal }: { goal: Goal }) {
  const data = useApp((st) => st.data);
  const { apply } = useActions();
  const id = useId();
  const accounts = liveAccounts(data);
  const save = (patch: Partial<Goal>) => apply({ goals: [touch(goal, patch, Date.now())] });
  const remove = () => {
    const now = Date.now();
    apply({ goals: [tombstone(goal, now)], goalSteps: goalStepsOf(data, goal.id).map((st) => tombstone(st, now)) }, undefined, "Objectif supprimé");
  };

  return (
    <details className={s.settings}>
      <summary>Modifier l'objectif</summary>
      <div className={s.settingsBody}>
        <FieldRow>
          <Field label="Nom" htmlFor={`${id}-name`}>
            <InlineText label="Nom de l'objectif" value={goal.name} required onCommit={(name) => save({ name })} />
          </Field>
          <Field label="Échéance" htmlFor={`${id}-due`} hint={goal.due ? undefined : "Aucune"}>
            <div className={s.inlineRow}>
              <TextInput
                id={`${id}-due`}
                type="date"
                value={goal.due ?? ""}
                onChange={(e) => {
                  if (e.target.value === "") save({ due: null });
                  else if (isValidDay(e.target.value)) save({ due: e.target.value });
                }}
              />
              {goal.due && (
                <Button size="small" variant="ghost" onClick={() => save({ due: null })}>
                  Retirer
                </Button>
              )}
            </div>
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Cible" htmlFor={`${id}-mode`}>
            <Segmented
              label="Mode de cible"
              value={goal.targetMode}
              options={[
                { value: "manual", label: "Montant saisi" },
                { value: "steps", label: "Somme des postes" },
              ]}
              onChange={(targetMode) => save({ targetMode })}
            />
          </Field>
          <Field label="Montant cible" htmlFor={`${id}-target`} hidden={goal.targetMode !== "manual"}>
            <InlineAmount label="Montant cible" value={goal.target} onCommit={(target) => save({ target })} />
          </Field>
        </FieldRow>

        <Field label="Suivi de l'avancement" htmlFor={`${id}-source`}>
          <Segmented
            label="Mode de suivi"
            value={goal.source}
            options={[
              { value: "tagged", label: "Opérations rattachées" },
              { value: "account", label: "Solde de comptes" },
            ]}
            onChange={(source) => save({ source })}
          />
        </Field>
        <fieldset className={s.fieldset} hidden={goal.source !== "account"}>
          <legend>Comptes suivis</legend>
          {accounts.map((a) => (
            <Checkbox
              key={a.id}
              label={a.name}
              checked={goal.accountIds.includes(a.id)}
              onChange={(e) =>
                save({ accountIds: e.target.checked ? [...goal.accountIds, a.id] : goal.accountIds.filter((x) => x !== a.id) })
              }
            />
          ))}
        </fieldset>
        {goal.source === "tagged" && (
          <p className={s.muted}>
            Rattache des opérations à cet objectif depuis la saisie : un versement vers l'épargne l'alimente, une dépense
            finale (le billet, par exemple) le vide.
          </p>
        )}

        <StepsEditor goal={goal} />

        <div className={s.alignStart}>
          <ConfirmDelete label="Supprimer l'objectif" onConfirm={remove} />
        </div>
      </div>
    </details>
  );
}

function GoalCard({ goal, asOf }: { goal: Goal; asOf: string }) {
  const data = useApp((st) => st.data);
  const today = useApp((st) => st.today);
  const { apply } = useActions();
  const view = useMemo(() => goalView(data, goal, asOf, today), [data, goal, asOf, today]);
  const save = (patch: Partial<Goal>, message?: string) => apply({ goals: [touch(goal, patch, Date.now())] }, undefined, message);
  const color = colorFor(data.preferences, { kind: "series", color: goal.color });
  const d = view.deadline;
  const st = view.steps;

  return (
    <Card
      as="article"
      title={goal.name}
      subtitle={goal.done ? `Atteint${goal.doneAt ? ` le ${dayLong(goal.doneAt)}` : ""}` : goal.source === "account" ? "Suivi par le solde de comptes" : "Suivi par les opérations rattachées"}
      actions={
        <>
          <IconButton label={goal.hidden ? "Afficher au tableau de bord" : "Masquer du tableau de bord"} aria-pressed={goal.hidden} onClick={() => save({ hidden: !goal.hidden })}>
            {goal.hidden ? <EyeOffIcon /> : <EyeIcon />}
          </IconButton>
          <IconButton label={goal.pinned ? "Désépingler" : "Épingler en tête"} aria-pressed={goal.pinned} onClick={() => save({ pinned: !goal.pinned })}>
            <PinIcon filled={goal.pinned} />
          </IconButton>
          <IconButton
            label={goal.done ? "Ne plus marquer atteint" : "Marquer atteint"}
            aria-pressed={goal.done}
            onClick={() => save(goal.done ? { done: false, doneAt: null } : { done: true, doneAt: today }, goal.done ? undefined : "Objectif marqué atteint")}
          >
            <CheckIcon />
          </IconButton>
          <IconButton label="Archiver" onClick={() => save({ archived: true }, "Objectif archivé")}>
            <ArchiveIcon />
          </IconButton>
        </>
      }
    >
      <Gauge
        label="Avancement"
        color={color}
        value={view.progress}
        target={view.target}
        caption={view.target > 0 ? `${money(view.progress)} sur ${money(view.target)} · ${ratio(Math.max(0, view.progress) / view.target)}` : money(view.progress)}
      />
      <div className={s.lines}>
        {d && d.status === "upcoming" && (
          <p>
            Échéance le {dayLong(d.due)} · dans {timeLeft(d.timeLeft!)} · <strong>{money(d.monthlyNeeded!)} par mois</strong>
          </p>
        )}
        {d && d.status === "overdue" && (
          <p className={s.overdue}>
            Échéance dépassée depuis le {dayLong(d.due)} · il manque {money(d.remaining)}
          </p>
        )}
        {d && d.status === "met" && <p>Échéance le {dayLong(d.due)} · rien ne reste à mettre de côté</p>}
        {st.totalCount > 0 && (
          <p className={s.muted}>
            {st.settledCount} {plural(st.settledCount, "poste", "postes")} sur {st.totalCount} {plural(st.settledCount, "réglé", "réglés")} ·{" "}
            {money(st.settledAmount)} sur {money(st.totalAmount)}
          </p>
        )}
      </div>
      {view.suggestDone && (
        <div className={s.suggest}>
          <span>La cible est couverte.</span>
          <Button size="small" onClick={() => save({ done: true, doneAt: today }, "Objectif marqué atteint")}>
            Marquer atteint
          </Button>
        </div>
      )}
      <GoalSettings goal={goal} />
    </Card>
  );
}

// ── Création et archives ───────────────────────────────────────────────────

function NewGoalForm({ first }: { first: boolean }) {
  const data = useApp((st) => st.data);
  const { apply } = useActions();
  const id = useId();
  const [name, setName] = useState("");
  const [target, setTarget] = useState<Cents | null>(null);
  const [due, setDue] = useState("");
  const [key, setKey] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || target === null || target <= 0) return;
    const live = data.collections.goals.filter((g) => g.deletedAt === null);
    const goal = createRecord<Goal>(
      newId(),
      {
        name: name.trim(),
        target,
        targetMode: "manual",
        source: "tagged",
        accountIds: [],
        due: isValidDay(due) ? due : null,
        hidden: false,
        pinned: false,
        done: false,
        doneAt: null,
        archived: false,
        position: live.reduce((max, g) => Math.max(max, g.position), 0) + 1,
        color: nextColor(data.collections.goals),
      },
      Date.now(),
    );
    if (await apply({ goals: [goal] }, undefined, "Objectif créé")) {
      setName("");
      setTarget(null);
      setDue("");
      setKey((k) => k + 1);
    }
  };

  return (
    <Card title="Nouvel objectif" subtitle={first ? "Aucun objectif en cours : crée le premier ici." : undefined} tone="muted">
      <form key={key} className={s.newGoal} onSubmit={submit}>
        <Field label="Nom" htmlFor={`${id}-name`}>
          <TextInput id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Voyage, apport, ordinateur…" autoComplete="off" />
        </Field>
        <Field label="Montant cible" htmlFor={`${id}-target`}>
          <AmountInput id={`${id}-target`} placeholder="0,00" onAmount={setTarget} />
        </Field>
        <Field label="Échéance (facultative)" htmlFor={`${id}-due`}>
          <TextInput id={`${id}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" disabled={!name.trim() || target === null || target <= 0}>
          Créer l'objectif
        </Button>
      </form>
    </Card>
  );
}

function ArchivedGoals({ goals }: { goals: Goal[] }) {
  const data = useApp((st) => st.data);
  const { apply } = useActions();
  return (
    <ul className={s.archive}>
      {goals.map((g) => (
        <li key={g.id}>
          <span className={s.archiveName}>{g.name}</span>
          <span className={s.muted}>{money(g.target)}</span>
          <span className={s.archiveTools}>
            <Button size="small" variant="ghost" onClick={() => apply({ goals: [touch(g, { archived: false }, Date.now())] }, undefined, "Objectif restauré")}>
              <RestoreIcon size={16} />
              Restaurer
            </Button>
            <ConfirmDelete
              label="Supprimer"
              onConfirm={() => {
                const now = Date.now();
                apply({ goals: [tombstone(g, now)], goalSteps: goalStepsOf(data, g.id).map((st) => tombstone(st, now)) }, undefined, "Objectif supprimé");
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function GoalsScreen() {
  const data = useApp((st) => st.data);
  const year = useApp((st) => st.year);
  const today = useApp((st) => st.today);
  const asOf = asOfForYear(year, today);
  const { active, done, archived } = useMemo(() => goalsByState(data), [data]);

  return (
    <Stack gap={18}>
      <ScreenTitle title="Objectifs">
        {asOf !== today && <p className={s.muted}>Situation au {dayLong(asOf)}</p>}
      </ScreenTitle>
      <SafetyCard asOf={asOf} />
      {active.map((g) => (
        <GoalCard key={g.id} goal={g} asOf={asOf} />
      ))}
      <NewGoalForm first={active.length === 0} />
      {done.length > 0 && (
        <>
          <SectionTitle>Objectifs atteints</SectionTitle>
          {done.map((g) => (
            <GoalCard key={g.id} goal={g} asOf={asOf} />
          ))}
        </>
      )}
      {archived.length > 0 && (
        <>
          <SectionTitle>Archives</SectionTitle>
          <ArchivedGoals goals={archived} />
        </>
      )}
    </Stack>
  );
}
