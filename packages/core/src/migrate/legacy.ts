import { defaultPreferences, emptyCollections, normalizeDashOrder } from "../dataset";
import { isValidDay, isValidMonth, monthOf } from "../dates";
import { categoryColors, legacyCategoryId } from "../defaults";
import { legacyId, occurrenceId, skipId } from "../ids";
import {
  AVERAGE_WINDOWS,
  DASH_BLOCKS,
  SCHEMA_VERSION,
  SPLITS_TOTAL,
  type Account,
  type AverageWindow,
  type Bucket,
  type Category,
  type Cents,
  type Dataset,
  type Day,
  type Debt,
  type Goal,
  type GoalStep,
  type Month,
  type Operation,
  type OpType,
  type PrefKey,
  type Recurrence,
  type Role,
  type SeriesColor,
  type Skip,
} from "../model";
import { validateDataset } from "../validate";
import { crossCheckLegacy, type LegacyChecked } from "./legacy-check";

/**
 * Reprise de `mes-finances.json`, l'export de l'ancienne application (l'artifact
 * « Mes finances ») : `{ settings, months }`, montants en euros décimaux. Les formats
 * suivent son code. Tout champ ou cas inconnu fait échouer l'import en entier
 * (décision 16), et une vérification croisée refait ses calculs sur l'ancien format.
 */

/**
 * Horodatage des lignes reprises : plus ancien que toute écriture faite dans Cashmyr.
 * Réimporter n'ajoute que ce qui manque et n'écrase ni une modification ni une
 * suppression (décision 34) ; deux appareils qui importent le même fichier
 * produisent exactement les mêmes lignes.
 */
export const LEGACY_STAMP = 1;

/** Version du format de l'ancienne application prise en charge (`settings.v`). */
export const LEGACY_VERSION = 2;

export class LegacyImportError extends Error {
  override name = "LegacyImportError";
  constructor(readonly issues: string[]) {
    const more = issues.length > 1 ? ` (et ${issues.length - 1} autre${issues.length > 2 ? "s" : ""} problème${issues.length > 2 ? "s" : ""})` : "";
    super(`Reprise refusée, rien n'a été écrit. ${issues[0]}${more}.`);
  }
}

// ── Ancien format, lu strictement ────────────────────────────────────────

/** Type d'opération ; les champs de compte et de catégorie en dépendent. */
type Flow = { t: "in" | "out"; cat: string; acc: string } | { t: "tx"; from: string; to: string };
/** Rattachements facultatifs ; un lien vers un élément supprimé est retiré à la lecture (décision 36). */
type Links = { goal?: string; debt?: string };

export type LegacyCategory = { id: string; kind: "in" | "out"; name: string; bucket?: Bucket };
export type LegacyAccount = { id: string; name: string; opening: number; role: Role; safety: boolean; mv?: number };
export type LegacyStep = { id: string; label: string; amount: number; done: boolean };
export type LegacyGoal = {
  id: string;
  name: string;
  target: number;
  targetMode: "manual" | "steps";
  source: "tagged" | "account";
  accounts: string[];
  due: Day | null;
  hidden: boolean;
  pinned: boolean;
  done: boolean;
  doneAt: Day | null;
  archived: boolean;
  steps: LegacyStep[];
};
export type LegacyDebt = {
  id: string;
  name: string;
  creditor: string;
  direction: "owe" | "lent";
  principal: number;
  paidManual: number;
  mode: "installments" | "free";
  installmentAmount: number;
  installmentCount: number;
  startDate: Day;
  dayOfMonth: number;
  categoryId: string | null;
  accountId: string | null;
  recurrenceId: string | null;
  hidden: boolean;
  pinned: boolean;
  settled: boolean;
  settledAt: Day | null;
  archived: boolean;
};
export type LegacyRecurrence = Flow &
  Links & { id: string; label: string; amt: number; day: number; start: Month; end: Month | null; active: boolean };
export type LegacyItem = Flow &
  Links & {
    id: string;
    /** Clé du mois qui range l'opération dans l'ancien fichier. */
    month: Month;
    d: Day;
    amt: number;
    note: string;
    rec?: string;
  };
export type LegacyExport = {
  cats: LegacyCategory[];
  accounts: LegacyAccount[];
  splits: Record<Bucket, number>;
  basis: "month" | "avg";
  window: AverageWindow;
  safety: { mode: "months" | "amount"; months: number; amount: number; hidden: boolean; pinned: boolean };
  goals: LegacyGoal[];
  debts: LegacyDebt[];
  recurring: LegacyRecurrence[];
  catColors: Record<string, string>;
  bucketColors: Partial<Record<Bucket, string>>;
  dashOrder: string[];
  /** Clés de `months`, dans l'ordre. */
  months: Month[];
  items: LegacyItem[];
  /** Mois annulés d'une récurrence. */
  skips: { month: Month; rec: string }[];
  /** Liens vers des éléments supprimés dans l'ancienne application, écartés (décision 36). */
  deadLinks: number;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Un fichier qui a la forme de l'export de l'ancienne application. */
export const isLegacyExport = (raw: unknown): boolean => isObj(raw) && "settings" in raw && "months" in raw;

class Reader {
  readonly issues: string[] = [];

  fail(path: string, message: string): void {
    this.issues.push(`${path} : ${message}`);
  }

  /** Objet aux clés connues : une clé en trop, ou une obligatoire qui manque, est une erreur. */
  object(path: string, value: unknown, required: readonly string[], optional: readonly string[] = []): Obj | null {
    if (!isObj(value)) {
      this.fail(path, "objet attendu");
      return null;
    }
    for (const key of Object.keys(value)) {
      if (!required.includes(key) && !optional.includes(key)) this.fail(`${path}.${key}`, "champ inconnu");
    }
    for (const key of required) if (!(key in value)) this.fail(`${path}.${key}`, "champ manquant");
    return value;
  }

  list(path: string, value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    this.fail(path, "liste attendue");
    return [];
  }

  string(path: string, value: unknown): string {
    if (typeof value === "string") return value;
    this.fail(path, "texte attendu");
    return "";
  }

  id(path: string, value: unknown): string {
    if (typeof value === "string" && value.length > 0) return value;
    this.fail(path, "identifiant non vide attendu");
    return "";
  }

  bool(path: string, value: unknown): boolean {
    if (typeof value === "boolean") return value;
    this.fail(path, "vrai ou faux attendu");
    return false;
  }

  oneOf<T extends string | number>(path: string, value: unknown, values: readonly T[]): T {
    if (values.includes(value as T)) return value as T;
    this.fail(path, `valeur inconnue ${JSON.stringify(value)} (attendu : ${values.join(", ")})`);
    return values[0]!;
  }

  int(path: string, value: unknown, min: number, max: number): number {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max) return value;
    this.fail(path, `entier de ${min} à ${max} attendu`);
    return min;
  }

  day(path: string, value: unknown): Day {
    if (isValidDay(value)) return value;
    this.fail(path, "date AAAA-MM-JJ attendue");
    return "1970-01-01";
  }

  month(path: string, value: unknown): Month {
    if (isValidMonth(value)) return value;
    this.fail(path, "mois AAAA-MM attendu");
    return "1970-01";
  }

  /** Date, ou `null` quand l'ancienne application n'en avait pas. */
  optionalDay(path: string, value: unknown): Day | null {
    return value === null || value === undefined ? null : this.day(path, value);
  }

  /** Montant en euros : nombre fini, au plus deux décimales. */
  euros(path: string, value: unknown, sign: "positive" | "nonneg" | "any"): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.fail(path, "montant en euros attendu");
      return 0;
    }
    const scaled = value * 100;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6) this.fail(path, `${value} a plus de deux décimales`);
    else if (!Number.isSafeInteger(Math.round(scaled))) this.fail(path, `${value} est hors limites`);
    else if (sign === "positive" && value <= 0) this.fail(path, "montant strictement positif attendu");
    else if (sign === "nonneg" && value < 0) this.fail(path, "montant positif ou nul attendu");
    return value;
  }

  hex(path: string, value: unknown): string {
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
    this.fail(path, "couleur #rrggbb attendue");
    return "#000000";
  }

  /** Identifiants uniques dans une liste. */
  unique(path: string, ids: readonly string[]): void {
    const seen = new Set<string>();
    for (const id of ids) {
      if (id && seen.has(id)) this.fail(path, `identifiant ${JSON.stringify(id)} en double`);
      seen.add(id);
    }
  }
}

/** Euros → centimes. Appelé seulement sur des montants déjà vérifiés par `Reader.euros`. */
export const eurosToCents = (euros: number): Cents => Math.round(euros * 100);

const SETTINGS_KEYS = [
  "v",
  "cats",
  "accounts",
  "splits",
  "basis",
  "window",
  "safety",
  "goals",
  "debts",
  "catColors",
  "bucketColors",
  "dashOrder",
  "recurring",
] as const;
const ROLES: readonly Role[] = ["courant", "epargne", "invest", "autre"];
const BUCKETS: readonly Bucket[] = ["besoin", "envie", "invest"];
const LINK_KEYS = ["goal", "debt"] as const;

function readCategory(r: Reader, path: string, value: unknown): LegacyCategory {
  const kind = isObj(value) && value.kind === "in" ? "in" : "out";
  const o = r.object(path, value, kind === "in" ? ["id", "kind", "name"] : ["id", "kind", "name", "bucket"]);
  if (!o) return { id: "", kind: "in", name: "" };
  const cat: LegacyCategory = {
    id: r.id(`${path}.id`, o.id),
    kind: r.oneOf(`${path}.kind`, o.kind, ["in", "out"] as const),
    name: r.string(`${path}.name`, o.name),
  };
  if (kind === "out") cat.bucket = r.oneOf(`${path}.bucket`, o.bucket, BUCKETS);
  return cat;
}

function readAccount(r: Reader, path: string, value: unknown): LegacyAccount {
  // `mv` : valeur déclarée, absente tant qu'aucune n'est saisie.
  const o = r.object(path, value, ["id", "name", "opening", "role", "safety"], ["mv"]);
  if (!o) return { id: "", name: "", opening: 0, role: "courant", safety: false };
  const account: LegacyAccount = {
    id: r.id(`${path}.id`, o.id),
    name: r.string(`${path}.name`, o.name),
    opening: r.euros(`${path}.opening`, o.opening, "any"),
    role: r.oneOf(`${path}.role`, o.role, ROLES),
    safety: r.bool(`${path}.safety`, o.safety),
  };
  if ("mv" in o) account.mv = r.euros(`${path}.mv`, o.mv, "any");
  return account;
}

function readStep(r: Reader, path: string, value: unknown): LegacyStep {
  const o = r.object(path, value, ["id", "label", "amount", "done"]);
  if (!o) return { id: "", label: "", amount: 0, done: false };
  return {
    id: r.id(`${path}.id`, o.id),
    label: r.string(`${path}.label`, o.label),
    amount: r.euros(`${path}.amount`, o.amount, "nonneg"),
    done: r.bool(`${path}.done`, o.done),
  };
}

/** Les objectifs antérieurs aux postes n'ont ni `pinned`, ni `done`, ni `archived`, ni `targetMode` (§7). */
function readGoal(r: Reader, path: string, value: unknown): LegacyGoal {
  const o = r.object(
    path,
    value,
    ["id", "name", "target", "source", "accounts", "due", "hidden"],
    ["pinned", "done", "doneAt", "archived", "targetMode", "steps"],
  );
  if (!o) {
    return {
      id: "",
      name: "",
      target: 0,
      targetMode: "manual",
      source: "tagged",
      accounts: [],
      due: null,
      hidden: false,
      pinned: false,
      done: false,
      doneAt: null,
      archived: false,
      steps: [],
    };
  }
  const flag = (key: string) => (key in o ? r.bool(`${path}.${key}`, o[key]) : false);
  return {
    id: r.id(`${path}.id`, o.id),
    name: r.string(`${path}.name`, o.name),
    target: r.euros(`${path}.target`, o.target, "nonneg"),
    targetMode: "targetMode" in o ? r.oneOf(`${path}.targetMode`, o.targetMode, ["manual", "steps"] as const) : "manual",
    source: r.oneOf(`${path}.source`, o.source, ["tagged", "account"] as const),
    accounts: r.list(`${path}.accounts`, o.accounts).map((a, i) => r.id(`${path}.accounts[${i}]`, a)),
    due: r.optionalDay(`${path}.due`, o.due),
    hidden: r.bool(`${path}.hidden`, o.hidden),
    pinned: flag("pinned"),
    done: flag("done"),
    doneAt: r.optionalDay(`${path}.doneAt`, o.doneAt),
    archived: flag("archived"),
    steps: "steps" in o ? r.list(`${path}.steps`, o.steps).map((s, i) => readStep(r, `${path}.steps[${i}]`, s)) : [],
  };
}

const DEBT_KEYS = [
  "id",
  "name",
  "creditor",
  "direction",
  "principal",
  "paidManual",
  "mode",
  "installmentAmount",
  "installmentCount",
  "startDate",
  "dayOfMonth",
  "categoryId",
  "accountId",
  "recurrenceId",
  "hidden",
  "pinned",
  "settled",
  "archived",
] as const;

function readDebt(r: Reader, path: string, value: unknown): LegacyDebt | null {
  // `settledAt` : posé quand la dette est marquée soldée.
  const o = r.object(path, value, DEBT_KEYS, ["settledAt"]);
  if (!o) return null;
  const optionalId = (key: "categoryId" | "accountId" | "recurrenceId") => (o[key] === null ? null : r.id(`${path}.${key}`, o[key]));
  return {
    id: r.id(`${path}.id`, o.id),
    name: r.string(`${path}.name`, o.name),
    creditor: r.string(`${path}.creditor`, o.creditor),
    direction: r.oneOf(`${path}.direction`, o.direction, ["owe", "lent"] as const),
    principal: r.euros(`${path}.principal`, o.principal, "nonneg"),
    paidManual: r.euros(`${path}.paidManual`, o.paidManual, "nonneg"),
    mode: r.oneOf(`${path}.mode`, o.mode, ["installments", "free"] as const),
    installmentAmount: r.euros(`${path}.installmentAmount`, o.installmentAmount, "nonneg"),
    installmentCount: r.int(`${path}.installmentCount`, o.installmentCount, 0, 1200),
    startDate: r.day(`${path}.startDate`, o.startDate),
    dayOfMonth: r.int(`${path}.dayOfMonth`, o.dayOfMonth, 1, 31),
    categoryId: optionalId("categoryId"),
    accountId: optionalId("accountId"),
    recurrenceId: optionalId("recurrenceId"),
    hidden: r.bool(`${path}.hidden`, o.hidden),
    pinned: r.bool(`${path}.pinned`, o.pinned),
    settled: r.bool(`${path}.settled`, o.settled),
    settledAt: r.optionalDay(`${path}.settledAt`, o.settledAt),
    archived: r.bool(`${path}.archived`, o.archived),
  };
}

/** Champs de compte et de catégorie selon le type : `cat` et `acc`, ou `from` et `to` pour un transfert. */
function readFlow(r: Reader, path: string, o: Obj): Flow {
  const t = r.oneOf(`${path}.t`, o.t, ["in", "out", "tx"] as const);
  return t === "tx"
    ? { t, from: r.id(`${path}.from`, o.from), to: r.id(`${path}.to`, o.to) }
    : { t, cat: r.id(`${path}.cat`, o.cat), acc: r.id(`${path}.acc`, o.acc) };
}
const flowKeys = (value: unknown) => (isObj(value) && value.t === "tx" ? ["from", "to"] : ["cat", "acc"]);

function readLinks(r: Reader, path: string, o: Obj): Links {
  const links: Links = {};
  for (const key of LINK_KEYS) if (key in o) links[key] = r.id(`${path}.${key}`, o[key]);
  return links;
}

function readRecurrence(r: Reader, path: string, value: unknown): LegacyRecurrence | null {
  // `active` et `end` absents valent « active » et « sans fin » dans l'ancienne application.
  const o = r.object(path, value, ["id", "label", "amt", "t", "day", "start", ...flowKeys(value)], ["end", "active", ...LINK_KEYS]);
  if (!o) return null;
  return {
    ...readFlow(r, path, o),
    ...readLinks(r, path, o),
    id: r.id(`${path}.id`, o.id),
    label: r.string(`${path}.label`, o.label),
    amt: r.euros(`${path}.amt`, o.amt, "positive"),
    day: r.int(`${path}.day`, o.day, 1, 31),
    start: r.month(`${path}.start`, o.start),
    end: o.end === null || o.end === undefined ? null : r.month(`${path}.end`, o.end),
    active: "active" in o ? r.bool(`${path}.active`, o.active) : true,
  };
}

function readItem(r: Reader, path: string, value: unknown, month: Month): LegacyItem | null {
  const o = r.object(path, value, ["id", "d", "t", "amt", "note", ...flowKeys(value)], [...LINK_KEYS, "rec"]);
  if (!o) return null;
  const d = r.day(`${path}.d`, o.d);
  if (isValidDay(o.d) && monthOf(d) !== month) r.fail(`${path}.d`, `le ${d} est rangé dans le mois ${month}`);
  const item: LegacyItem = {
    ...readFlow(r, path, o),
    ...readLinks(r, path, o),
    id: r.id(`${path}.id`, o.id),
    month,
    d,
    amt: r.euros(`${path}.amt`, o.amt, "positive"),
    note: r.string(`${path}.note`, o.note),
  };
  if ("rec" in o) item.rec = r.id(`${path}.rec`, o.rec);
  return item;
}

/** Lit l'export de l'ancienne application, sans rien en laisser de côté. */
export function readLegacyExport(raw: unknown): LegacyExport {
  const r = new Reader();
  const root = r.object("fichier", raw, ["settings", "months"]);
  const s = root ? r.object("settings", root.settings, SETTINGS_KEYS) : null;
  // Sans la charpente attendue, le reste ne veut rien dire : on s'arrête là.
  if (!root || !s || r.issues.length > 0) throw new LegacyImportError(r.issues);
  if (s.v !== LEGACY_VERSION) {
    throw new LegacyImportError([
      `settings.v : version ${JSON.stringify(s.v)} de l'ancien format, seule la version ${LEGACY_VERSION} est prise en charge`,
    ]);
  }

  const notNull = <T>(x: T | null): x is T => x !== null;
  const cats = r.list("settings.cats", s.cats).map((c, i) => readCategory(r, `settings.cats[${i}]`, c));
  const accounts = r.list("settings.accounts", s.accounts).map((a, i) => readAccount(r, `settings.accounts[${i}]`, a));
  const goals = r.list("settings.goals", s.goals).map((g, i) => readGoal(r, `settings.goals[${i}]`, g));
  const debts = r
    .list("settings.debts", s.debts)
    .map((d, i) => readDebt(r, `settings.debts[${i}]`, d))
    .filter(notNull);
  const recurring = r
    .list("settings.recurring", s.recurring)
    .map((x, i) => readRecurrence(r, `settings.recurring[${i}]`, x))
    .filter(notNull);

  const splitsObj = r.object("settings.splits", s.splits, BUCKETS);
  const splits = Object.fromEntries(
    BUCKETS.map((b) => {
      const v = splitsObj?.[b];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) r.fail(`settings.splits.${b}`, "fraction de 0 à 1 attendue");
      return [b, typeof v === "number" ? v : 0];
    }),
  ) as Record<Bucket, number>;

  // `pinned` absent : la précaution est épinglée (§7).
  const safetyObj = r.object("settings.safety", s.safety, ["mode", "months", "amount", "hidden"], ["pinned"]);
  const safety = {
    mode: r.oneOf("settings.safety.mode", safetyObj?.mode, ["months", "amount"] as const),
    months: r.int("settings.safety.months", safetyObj?.months, 0, 120),
    amount: r.euros("settings.safety.amount", safetyObj?.amount, "nonneg"),
    hidden: r.bool("settings.safety.hidden", safetyObj?.hidden),
    pinned: safetyObj && "pinned" in safetyObj ? r.bool("settings.safety.pinned", safetyObj.pinned) : true,
  };

  const basis = r.oneOf("settings.basis", s.basis, ["month", "avg"] as const);
  const window = r.oneOf("settings.window", s.window, AVERAGE_WINDOWS);
  const dashOrder = r.list("settings.dashOrder", s.dashOrder).map((k, i) => r.oneOf(`settings.dashOrder[${i}]`, k, DASH_BLOCKS));

  const catColorsObj = r.object("settings.catColors", s.catColors, [], Object.keys(isObj(s.catColors) ? s.catColors : {}));
  const catColors = Object.fromEntries(Object.entries(catColorsObj ?? {}).map(([id, v]) => [id, r.hex(`settings.catColors.${id}`, v)]));
  const bucketColorsObj = r.object("settings.bucketColors", s.bucketColors, [], BUCKETS);
  const bucketColors = Object.fromEntries(
    Object.entries(bucketColorsObj ?? {}).map(([b, v]) => [b, r.hex(`settings.bucketColors.${b}`, v)]),
  ) as Partial<Record<Bucket, string>>;

  const months: Month[] = [];
  const items: LegacyItem[] = [];
  const skips: { month: Month; rec: string }[] = [];
  if (!isObj(root.months)) r.fail("months", "objet attendu");
  else {
    for (const [month, value] of Object.entries(root.months)) {
      const path = `months["${month}"]`;
      if (!isValidMonth(month)) r.fail(path, "clé de mois AAAA-MM attendue");
      const m = r.object(path, value, ["items", "skips"]);
      if (!m) continue;
      months.push(month);
      r.list(`${path}.items`, m.items).forEach((it, i) => {
        const item = readItem(r, `${path}.items[${i}]`, it, month);
        if (item) items.push(item);
      });
      // Un mois annulé est l'identifiant de la récurrence, une fois par mois.
      const seen = new Set<string>();
      r.list(`${path}.skips`, m.skips).forEach((x, i) => {
        const rec = r.id(`${path}.skips[${i}]`, x);
        if (rec && !seen.has(rec)) skips.push({ month, rec });
        seen.add(rec);
      });
    }
  }

  // Identifiants.
  r.unique("settings.cats", cats.map((c) => c.id));
  r.unique("settings.accounts", accounts.map((a) => a.id));
  r.unique("settings.goals", goals.map((g) => g.id));
  r.unique("settings.debts", debts.map((d) => d.id));
  r.unique("settings.recurring", recurring.map((x) => x.id));
  r.unique("months", items.map((it) => it.id));
  goals.forEach((g, i) => r.unique(`settings.goals[${i}].steps`, g.steps.map((st) => st.id)));

  // Catégories et comptes : une référence introuvable fait refuser le fichier.
  const catById = new Map(cats.map((c) => [c.id, c]));
  const accountIds = new Set(accounts.map((a) => a.id));
  const checkFlow = (path: string, f: Flow) => {
    if (f.t === "tx") {
      for (const a of [f.from, f.to]) if (!accountIds.has(a)) r.fail(path, `compte ${JSON.stringify(a)} introuvable`);
      if (f.from === f.to) r.fail(path, "transfert d'un compte vers lui-même");
      return;
    }
    const cat = catById.get(f.cat);
    if (!cat) r.fail(path, `catégorie ${JSON.stringify(f.cat)} introuvable`);
    else if (cat.kind !== f.t) r.fail(path, `catégorie ${JSON.stringify(f.cat)} d'un autre type que l'opération`);
    if (!accountIds.has(f.acc)) r.fail(path, `compte ${JSON.stringify(f.acc)} introuvable`);
  };
  for (const it of items) checkFlow(`months["${it.month}"], opération ${JSON.stringify(it.id)}`, it);
  recurring.forEach((x, i) => checkFlow(`settings.recurring[${i}]`, x));
  goals.forEach((g, i) =>
    g.accounts.forEach((a) => accountIds.has(a) || r.fail(`settings.goals[${i}].accounts`, `compte ${JSON.stringify(a)} introuvable`)),
  );
  debts.forEach((d, i) => {
    if (d.categoryId !== null && !catById.has(d.categoryId)) {
      r.fail(`settings.debts[${i}].categoryId`, `catégorie ${JSON.stringify(d.categoryId)} introuvable`);
    }
    if (d.accountId !== null && !accountIds.has(d.accountId)) {
      r.fail(`settings.debts[${i}].accountId`, `compte ${JSON.stringify(d.accountId)} introuvable`);
    }
  });

  // Objectifs, dettes et récurrences supprimés : l'ancienne application laissait leurs liens
  // en place et les ignorait. Ils sont écartés et comptés (décision 36).
  const goalIds = new Set(goals.map((g) => g.id));
  const debtIds = new Set(debts.map((d) => d.id));
  const recIds = new Set(recurring.map((x) => x.id));
  let deadLinks = 0;
  const prune = (x: Links & { rec?: string }) => {
    if (x.goal !== undefined && !goalIds.has(x.goal)) (delete x.goal, deadLinks++);
    if (x.debt !== undefined && !debtIds.has(x.debt)) (delete x.debt, deadLinks++);
    if (x.rec !== undefined && !recIds.has(x.rec)) (delete x.rec, deadLinks++);
  };
  items.forEach(prune);
  recurring.forEach(prune);
  for (const d of debts) if (d.recurrenceId !== null && !recIds.has(d.recurrenceId)) (d.recurrenceId = null, deadLinks++);
  const liveSkips = skips.filter((x) => recIds.has(x.rec));
  deadLinks += skips.length - liveSkips.length;
  for (const id of Object.keys(catColors)) if (!catById.has(id)) (delete catColors[id], deadLinks++);

  if (r.issues.length > 0) throw new LegacyImportError(r.issues);
  return {
    cats,
    accounts,
    splits,
    basis,
    window,
    safety,
    goals,
    debts,
    recurring,
    catColors,
    bucketColors,
    dashOrder,
    months,
    items,
    skips: liveSkips,
    deadLinks,
  };
}

// ── Conversion ───────────────────────────────────────────────────────────

const meta = (kind: string, id: string) => ({ id: legacyId(kind, id), updatedAt: LEGACY_STAMP, deletedAt: null });
const series = (i: number) => (i % 7) as SeriesColor;
export const legacyAccountId = (id: string): string => legacyId("account", id);
const legacyRecurrenceId = (id: string): string => legacyId("recurrence", id);

/** Fraction → points de base, sans rien arrondir en silence. */
function basisPoints(r: Reader, splits: Record<Bucket, number>): Record<Bucket, number> {
  const out = {} as Record<Bucket, number>;
  for (const b of BUCKETS) {
    const scaled = splits[b] * SPLITS_TOTAL;
    out[b] = Math.round(scaled);
    if (Math.abs(scaled - out[b]) > 1e-6) r.fail(`settings.splits.${b}`, `${splits[b]} est plus fin que le centième de pour cent`);
  }
  if (out.besoin + out.envie + out.invest !== SPLITS_TOTAL) r.fail("settings.splits", "la répartition ne fait pas 100 %");
  return out;
}

/** Champs communs aux opérations et aux récurrences. */
function flowFields(f: Flow & Links): Pick<Operation, "type" | "categoryId" | "accountId" | "fromAccountId" | "toAccountId" | "goalId" | "debtId"> {
  return {
    type: f.t as OpType,
    ...(f.t === "tx"
      ? { fromAccountId: legacyAccountId(f.from), toAccountId: legacyAccountId(f.to) }
      : { categoryId: legacyCategoryId(f.cat), accountId: legacyAccountId(f.acc) }),
    ...(f.goal !== undefined ? { goalId: legacyId("goal", f.goal) } : {}),
    ...(f.debt !== undefined ? { debtId: legacyId("debt", f.debt) } : {}),
  };
}

export type LegacyConverted = {
  data: Dataset;
  /** Dettes reprises sans catégorie : la leur était de l'autre nature (décision 35). */
  clearedDebtCategories: string[];
};

/** Convertit en jeu Cashmyr, horodaté `LEGACY_STAMP`. */
export function convertLegacyExport(file: LegacyExport): LegacyConverted {
  const r = new Reader();
  const collections = emptyCollections();
  const colors = categoryColors(file.cats.map((c) => c.kind));
  const kindOf = new Map(file.cats.map((c) => [c.id, c.kind]));

  collections.categories = file.cats.map(
    (c, i): Category => ({
      id: legacyCategoryId(c.id),
      updatedAt: LEGACY_STAMP,
      deletedAt: null,
      name: c.name,
      kind: c.kind,
      ...(c.bucket ? { bucket: c.bucket } : {}),
      color: colors[i]!,
    }),
  );
  collections.accounts = file.accounts.map(
    (a, i): Account => ({
      ...meta("account", a.id),
      name: a.name,
      role: a.role,
      opening: eurosToCents(a.opening),
      safety: a.safety,
      // L'ancienne application ne datait pas la valeur déclarée.
      ...(a.mv !== undefined ? { declaredValue: eurosToCents(a.mv) } : {}),
      color: series(i),
    }),
  );
  collections.goals = file.goals.map(
    (g, i): Goal => ({
      ...meta("goal", g.id),
      name: g.name,
      target: eurosToCents(g.target),
      targetMode: g.targetMode,
      source: g.source,
      accountIds: g.accounts.map(legacyAccountId),
      due: g.due,
      hidden: g.hidden,
      pinned: g.pinned,
      done: g.done,
      doneAt: g.doneAt,
      archived: g.archived,
      position: i,
      color: series(i),
    }),
  );
  collections.goalSteps = file.goals.flatMap((g) =>
    g.steps.map(
      (st, i): GoalStep => ({
        ...meta("goal-step", `${g.id}/${st.id}`),
        goalId: legacyId("goal", g.id),
        label: st.label,
        amount: eurosToCents(st.amount),
        done: st.done,
        position: i,
      }),
    ),
  );

  const clearedDebtCategories: string[] = [];
  collections.debts = file.debts.map((d, i): Debt => {
    // Décision 35 : une catégorie de l'autre nature que la dette (dette basculée de « je dois »
    // à « on me doit ») n'est pas reprise ; Cashmyr la demandera au prochain versement.
    const expected = d.direction === "owe" ? "out" : "in";
    const keepCategory = d.categoryId !== null && kindOf.get(d.categoryId) === expected;
    if (d.categoryId !== null && !keepCategory) clearedDebtCategories.push(d.name);
    return {
      ...meta("debt", d.id),
      name: d.name,
      creditor: d.creditor,
      direction: d.direction,
      principal: eurosToCents(d.principal),
      paidManual: eurosToCents(d.paidManual),
      mode: d.mode,
      installmentAmount: eurosToCents(d.installmentAmount),
      installmentCount: d.installmentCount,
      startDate: d.startDate,
      dayOfMonth: d.dayOfMonth,
      categoryId: keepCategory ? legacyCategoryId(d.categoryId!) : null,
      accountId: d.accountId === null ? null : legacyAccountId(d.accountId),
      recurrenceId: d.recurrenceId === null ? null : legacyRecurrenceId(d.recurrenceId),
      hidden: d.hidden,
      pinned: d.pinned,
      settled: d.settled,
      settledAt: d.settledAt,
      archived: d.archived,
      position: i,
      color: series(i),
    };
  });
  collections.recurrences = file.recurring.map(
    (x): Recurrence => ({
      ...meta("recurrence", x.id),
      ...flowFields(x),
      label: x.label,
      amount: eurosToCents(x.amt),
      dayOfMonth: x.day,
      startMonth: x.start,
      endMonth: x.end,
      active: x.active,
    }),
  );
  collections.skips = file.skips.map((x): Skip => {
    const recurrenceId = legacyRecurrenceId(x.rec);
    // Même identifiant qu'une annulation faite dans Cashmyr pour ce mois.
    return { id: skipId(recurrenceId, x.month), updatedAt: LEGACY_STAMP, deletedAt: null, month: x.month, recurrenceId };
  });
  // Une opération générée prend l'identifiant de l'occurrence de son mois, celui que Cashmyr
  // lui aurait donné : il la reconnaît et ne la génère pas une seconde fois. Une deuxième
  // pour le même mois (occurrence déplacée d'un mois à l'autre) reste une opération rattachée.
  const occurrences = new Set<string>();
  collections.operations = file.items.map((it): Operation => {
    const recurrenceId = it.rec === undefined ? undefined : legacyRecurrenceId(it.rec);
    const occurrence = recurrenceId === undefined ? undefined : occurrenceId(recurrenceId, it.month);
    const canonical = occurrence !== undefined && !occurrences.has(occurrence);
    if (canonical) occurrences.add(occurrence);
    return {
      ...(canonical ? { id: occurrence, updatedAt: LEGACY_STAMP, deletedAt: null } : meta("operation", it.id)),
      ...flowFields(it),
      date: it.d,
      amount: eurosToCents(it.amt),
      note: it.note,
      ...(recurrenceId !== undefined ? { recurrenceId } : {}),
    };
  });

  const preferences = defaultPreferences();
  preferences.splits = basisPoints(r, file.splits);
  preferences.basis = file.basis;
  preferences.averageWindow = file.window;
  preferences.safety = { ...file.safety, amount: eurosToCents(file.safety.amount) };
  preferences.dashOrder = normalizeDashOrder(file.dashOrder);
  preferences.categoryColors = Object.fromEntries(Object.entries(file.catColors).map(([id, hex]) => [legacyCategoryId(id), hex]));
  preferences.bucketColors = { ...file.bucketColors };
  // Le thème n'existait pas : il garde son horodatage 0 et ne remplace rien.
  const fromFile: PrefKey[] = ["splits", "basis", "averageWindow", "safety", "dashOrder", "categoryColors", "bucketColors"];
  for (const key of fromFile) preferences.updatedAt[key] = LEGACY_STAMP;

  if (r.issues.length > 0) throw new LegacyImportError(r.issues);
  return { data: { schemaVersion: SCHEMA_VERSION, collections, preferences }, clearedDebtCategories };
}

export type LegacyConversion = {
  data: Dataset;
  counts: {
    categories: number;
    accounts: number;
    goals: number;
    debts: number;
    recurrences: number;
    operations: number;
    /** Mois qui contiennent au moins une opération. */
    months: number;
    skips: number;
  };
  /** Ce que la vérification croisée a trouvé identique au centime. */
  checked: LegacyChecked;
  /** Liens vers des éléments supprimés dans l'ancienne application, écartés (décision 36). */
  deadLinks: number;
  /** Dettes reprises sans catégorie (décision 35). */
  clearedDebtCategories: string[];
};

/** Lit, convertit, valide et vérifie. Au moindre écart, rien n'est retenu. */
export function importLegacy(raw: unknown): LegacyConversion {
  const file = readLegacyExport(raw);
  const { data, clearedDebtCategories } = convertLegacyExport(file);
  const invalid = validateDataset(data);
  if (invalid.length > 0) throw new LegacyImportError(invalid.map((issue) => `après conversion, ${issue}`));
  const { issues, checked } = crossCheckLegacy(file, data);
  if (issues.length > 0) throw new LegacyImportError(issues);
  const c = data.collections;
  return {
    data,
    counts: {
      categories: c.categories.length,
      accounts: c.accounts.length,
      goals: c.goals.length,
      debts: c.debts.length,
      recurrences: c.recurrences.length,
      operations: c.operations.length,
      months: new Set(file.items.map((it) => it.month)).size,
      skips: c.skips.length,
    },
    checked,
    deadLinks: file.deadLinks,
    clearedDebtCategories,
  };
}
