import { defaultPreferences, emptyCollections, normalizeDashOrder } from "../dataset";
import { isValidDay, isValidMonth, monthOf } from "../dates";
import { categoryColors, legacyCategoryId } from "../defaults";
import { legacyId } from "../ids";
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
  type Month,
  type Operation,
  type PrefKey,
  type Role,
  type SeriesColor,
} from "../model";
import { validateDataset } from "../validate";
import { crossCheckLegacy, type LegacyChecked } from "./legacy-check";

/**
 * Reprise de `mes-finances.json`, l'export de l'ancienne application : `{ settings, months }`,
 * montants en euros décimaux. Tout champ ou cas inconnu fait échouer l'import en entier
 * (décision 16), et une vérification croisée recalcule les totaux sur l'ancien format.
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

export type LegacyCategory = { id: string; kind: "in" | "out"; name: string; bucket?: Bucket };
export type LegacyAccount = { id: string; name: string; opening: number; role: Role; safety: boolean };
export type LegacyGoal = {
  id: string;
  name: string;
  target: number;
  source: "tagged" | "account";
  accounts: string[];
  due: Day;
  hidden: boolean;
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
  hidden: boolean;
  pinned: boolean;
  settled: boolean;
  archived: boolean;
};
export type LegacyItem = {
  id: string;
  /** Clé du mois qui range l'opération dans l'ancien fichier. */
  month: Month;
  d: Day;
  t: "in" | "out";
  amt: number;
  cat: string;
  acc: string;
  note: string;
};
export type LegacyExport = {
  cats: LegacyCategory[];
  accounts: LegacyAccount[];
  splits: Record<Bucket, number>;
  basis: "month" | "avg";
  window: AverageWindow;
  safety: { mode: "months" | "amount"; months: number; amount: number; hidden: boolean };
  goals: LegacyGoal[];
  debts: LegacyDebt[];
  dashOrder: string[];
  /** Clés de `months`, dans l'ordre. */
  months: Month[];
  items: LegacyItem[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Un fichier qui a la forme de l'export de l'ancienne application. */
export const isLegacyExport = (raw: unknown): boolean => isObj(raw) && "settings" in raw && "months" in raw;

/**
 * Cas que l'ancienne application connaît mais dont le format exact n'a pas encore été
 * vu dans un export : refusés plutôt que convertis à l'aveugle.
 */
const NOT_YET = "format pas encore pris en charge : l'import est refusé plutôt que de perdre ou de deviner ces données";

class Reader {
  readonly issues: string[] = [];

  fail(path: string, message: string): void {
    this.issues.push(`${path} : ${message}`);
  }

  /** Objet aux clés connues : une clé en trop ou manquante est une erreur. */
  object(path: string, value: unknown, keys: readonly string[]): Obj | null {
    if (!isObj(value)) {
      this.fail(path, "objet attendu");
      return null;
    }
    for (const key of Object.keys(value)) if (!keys.includes(key)) this.fail(`${path}.${key}`, "champ inconnu");
    for (const key of keys) if (!(key in value)) this.fail(`${path}.${key}`, "champ manquant");
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
  const o = r.object(path, value, ["id", "name", "opening", "role", "safety"]);
  if (!o) return { id: "", name: "", opening: 0, role: "courant", safety: false };
  return {
    id: r.id(`${path}.id`, o.id),
    name: r.string(`${path}.name`, o.name),
    opening: r.euros(`${path}.opening`, o.opening, "any"),
    role: r.oneOf(`${path}.role`, o.role, ROLES),
    safety: r.bool(`${path}.safety`, o.safety),
  };
}

function readGoal(r: Reader, path: string, value: unknown): LegacyGoal {
  const o = r.object(path, value, ["id", "name", "target", "source", "accounts", "due", "hidden"]);
  if (!o) return { id: "", name: "", target: 0, source: "tagged", accounts: [], due: "1970-01-01", hidden: false };
  return {
    id: r.id(`${path}.id`, o.id),
    name: r.string(`${path}.name`, o.name),
    target: r.euros(`${path}.target`, o.target, "nonneg"),
    source: r.oneOf(`${path}.source`, o.source, ["tagged", "account"] as const),
    accounts: r.list(`${path}.accounts`, o.accounts).map((a, i) => r.id(`${path}.accounts[${i}]`, a)),
    due: r.day(`${path}.due`, o.due),
    hidden: r.bool(`${path}.hidden`, o.hidden),
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
  const o = r.object(path, value, DEBT_KEYS);
  if (!o) return null;
  const optionalId = (key: "categoryId" | "accountId") => (o[key] === null ? null : r.id(`${path}.${key}`, o[key]));
  if (o.recurrenceId !== null) r.fail(`${path}.recurrenceId`, `prélèvement associé, ${NOT_YET}`);
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
    hidden: r.bool(`${path}.hidden`, o.hidden),
    pinned: r.bool(`${path}.pinned`, o.pinned),
    settled: r.bool(`${path}.settled`, o.settled),
    archived: r.bool(`${path}.archived`, o.archived),
  };
}

const ITEM_KEYS = ["id", "d", "t", "amt", "cat", "acc", "note"] as const;
/** Champs connus de l'ancienne application dont le format n'a pas encore été vu. */
const ITEM_PENDING: Record<string, string> = {
  goal: `rattachement à un objectif, ${NOT_YET}`,
  debt: `rattachement à une dette, ${NOT_YET}`,
};

function readItem(r: Reader, path: string, value: unknown, month: Month): LegacyItem | null {
  if (!isObj(value)) {
    r.fail(path, "objet attendu");
    return null;
  }
  const known = Object.fromEntries(Object.entries(value).filter(([k]) => !(k in ITEM_PENDING)));
  for (const key of Object.keys(value)) if (key in ITEM_PENDING) r.fail(`${path}.${key}`, ITEM_PENDING[key]!);
  if (value.t !== undefined && value.t !== "in" && value.t !== "out") {
    r.fail(`${path}.t`, `type ${JSON.stringify(value.t)} : ${value.t === "tx" ? `transfert, ${NOT_YET}` : "type inconnu"}`);
    return null;
  }
  const o = r.object(path, known, ITEM_KEYS);
  if (!o) return null;
  const d = r.day(`${path}.d`, o.d);
  if (isValidDay(o.d) && monthOf(d) !== month) r.fail(`${path}.d`, `le ${d} est rangé dans le mois ${month}`);
  return {
    id: r.id(`${path}.id`, o.id),
    month,
    d,
    t: r.oneOf(`${path}.t`, o.t, ["in", "out"] as const),
    amt: r.euros(`${path}.amt`, o.amt, "positive"),
    cat: r.id(`${path}.cat`, o.cat),
    acc: r.id(`${path}.acc`, o.acc),
    note: r.string(`${path}.note`, o.note),
  };
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

  const cats = r.list("settings.cats", s.cats).map((c, i) => readCategory(r, `settings.cats[${i}]`, c));
  const accounts = r.list("settings.accounts", s.accounts).map((a, i) => readAccount(r, `settings.accounts[${i}]`, a));
  const goals = r.list("settings.goals", s.goals).map((g, i) => readGoal(r, `settings.goals[${i}]`, g));
  const debts = r
    .list("settings.debts", s.debts)
    .map((d, i) => readDebt(r, `settings.debts[${i}]`, d))
    .filter((d): d is LegacyDebt => d !== null);

  const splitsObj = r.object("settings.splits", s.splits, BUCKETS);
  const splits = Object.fromEntries(
    BUCKETS.map((b) => {
      const v = splitsObj?.[b];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) r.fail(`settings.splits.${b}`, "fraction de 0 à 1 attendue");
      return [b, typeof v === "number" ? v : 0];
    }),
  ) as Record<Bucket, number>;

  const safetyObj = r.object("settings.safety", s.safety, ["mode", "months", "amount", "hidden"]);
  const safety = {
    mode: r.oneOf("settings.safety.mode", safetyObj?.mode, ["months", "amount"] as const),
    months: r.int("settings.safety.months", safetyObj?.months, 0, 120),
    amount: r.euros("settings.safety.amount", safetyObj?.amount, "nonneg"),
    hidden: r.bool("settings.safety.hidden", safetyObj?.hidden),
  };

  const basis = r.oneOf("settings.basis", s.basis, ["month", "avg"] as const);
  const window = r.oneOf("settings.window", s.window, AVERAGE_WINDOWS);
  const dashOrder = r.list("settings.dashOrder", s.dashOrder).map((k, i) => r.oneOf(`settings.dashOrder[${i}]`, k, DASH_BLOCKS));
  for (const key of ["catColors", "bucketColors"] as const) {
    const colors = s[key];
    if (!isObj(colors)) r.fail(`settings.${key}`, "objet attendu");
    else if (Object.keys(colors).length > 0) r.fail(`settings.${key}`, `couleurs choisies, ${NOT_YET}`);
  }
  if (r.list("settings.recurring", s.recurring).length > 0) r.fail("settings.recurring", `récurrences, ${NOT_YET}`);

  const months: Month[] = [];
  const items: LegacyItem[] = [];
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
      if (r.list(`${path}.skips`, m.skips).length > 0) r.fail(`${path}.skips`, `mois annulés de récurrences, ${NOT_YET}`);
    }
  }

  // Références et identifiants.
  r.unique("settings.cats", cats.map((c) => c.id));
  r.unique("settings.accounts", accounts.map((a) => a.id));
  r.unique("settings.goals", goals.map((g) => g.id));
  r.unique("settings.debts", debts.map((d) => d.id));
  r.unique("months", items.map((it) => it.id));
  const catById = new Map(cats.map((c) => [c.id, c]));
  const accountIds = new Set(accounts.map((a) => a.id));
  const kindOf = (id: string) => catById.get(id)?.kind;
  for (const it of items) {
    const path = `months["${it.month}"], opération ${JSON.stringify(it.id)}`;
    if (!catById.has(it.cat)) r.fail(path, `catégorie ${JSON.stringify(it.cat)} introuvable`);
    else if (kindOf(it.cat) !== it.t) r.fail(path, `catégorie ${JSON.stringify(it.cat)} d'un autre type que l'opération`);
    if (!accountIds.has(it.acc)) r.fail(path, `compte ${JSON.stringify(it.acc)} introuvable`);
  }
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
    dashOrder,
    months,
    items,
  };
}

// ── Conversion ───────────────────────────────────────────────────────────

const meta = (kind: string, id: string) => ({ id: legacyId(kind, id), updatedAt: LEGACY_STAMP, deletedAt: null });
const series = (i: number) => (i % 7) as SeriesColor;
export const legacyAccountId = (id: string): string => legacyId("account", id);

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

/** Convertit en jeu Cashmyr, horodaté `LEGACY_STAMP`. */
export function convertLegacyExport(file: LegacyExport): Dataset {
  const r = new Reader();
  const collections = emptyCollections();
  const colors = categoryColors(file.cats.map((c) => c.kind));

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
      color: series(i),
    }),
  );
  collections.goals = file.goals.map(
    (g, i): Goal => ({
      ...meta("goal", g.id),
      name: g.name,
      target: eurosToCents(g.target),
      // Champs que l'ancienne application ne connaissait pas (§7).
      targetMode: "manual",
      source: g.source,
      accountIds: g.accounts.map(legacyAccountId),
      due: g.due,
      hidden: g.hidden,
      pinned: false,
      done: false,
      doneAt: null,
      archived: false,
      position: i,
      color: series(i),
    }),
  );
  collections.debts = file.debts.map(
    (d, i): Debt => ({
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
      categoryId: d.categoryId === null ? null : legacyCategoryId(d.categoryId),
      accountId: d.accountId === null ? null : legacyAccountId(d.accountId),
      recurrenceId: null,
      hidden: d.hidden,
      pinned: d.pinned,
      settled: d.settled,
      settledAt: null,
      archived: d.archived,
      position: i,
      color: series(i),
    }),
  );
  collections.operations = file.items.map(
    (it): Operation => ({
      ...meta("operation", it.id),
      date: it.d,
      amount: eurosToCents(it.amt),
      type: it.t,
      note: it.note,
      categoryId: legacyCategoryId(it.cat),
      accountId: legacyAccountId(it.acc),
    }),
  );

  const preferences = defaultPreferences();
  preferences.splits = basisPoints(r, file.splits);
  preferences.basis = file.basis;
  preferences.averageWindow = file.window;
  preferences.safety = { ...file.safety, amount: eurosToCents(file.safety.amount), pinned: true };
  preferences.dashOrder = normalizeDashOrder(file.dashOrder);
  // Le thème n'existait pas : il garde son horodatage 0 et ne remplace rien.
  const fromFile: PrefKey[] = ["splits", "basis", "averageWindow", "safety", "dashOrder", "categoryColors", "bucketColors"];
  for (const key of fromFile) preferences.updatedAt[key] = LEGACY_STAMP;

  if (r.issues.length > 0) throw new LegacyImportError(r.issues);
  return { schemaVersion: SCHEMA_VERSION, collections, preferences };
}

export type LegacyConversion = {
  data: Dataset;
  counts: { categories: number; accounts: number; goals: number; debts: number; operations: number; months: number };
  /** Ce que la vérification croisée a trouvé identique au centime. */
  checked: LegacyChecked;
};

/** Lit, convertit, valide et vérifie. Au moindre écart, rien n'est retenu. */
export function importLegacy(raw: unknown): LegacyConversion {
  const file = readLegacyExport(raw);
  const data = convertLegacyExport(file);
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
      operations: c.operations.length,
      months: new Set(file.items.map((it) => it.month)).size,
    },
    checked,
  };
}
