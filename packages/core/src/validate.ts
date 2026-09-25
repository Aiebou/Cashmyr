import { isValidDay, isValidMonth } from "./dates";
import {
  AVERAGE_WINDOWS,
  COLLECTION_NAMES,
  DASH_BLOCKS,
  MAX_INSTALLMENTS,
  PREF_KEYS,
  SCHEMA_VERSION,
  SERIES_COLORS,
  SPLITS_TOTAL,
  type AnyRecord,
  type CollectionName,
  type Dataset,
} from "./model";

export class ValidationError extends Error {
  constructor(readonly issues: string[]) {
    const shown = issues.slice(0, 20).join("\n- ");
    const more = issues.length > 20 ? `\n… et ${issues.length - 20} autres` : "";
    super(`Données invalides :\n- ${shown}${more}`);
    this.name = "ValidationError";
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isNat = (v: unknown): v is number => isInt(v) && v >= 0;
const isPos = (v: unknown): v is number => isInt(v) && v > 0;
const isColor = (v: unknown) => isInt(v) && v >= 0 && v < SERIES_COLORS;
const isHex = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const oneOf =
  <T extends string | number>(values: readonly T[]) =>
  (v: unknown): v is T =>
    values.includes(v as T);

type Check = (v: unknown) => boolean;
type Shape = Record<string, { check: Check; optional?: boolean; label: string }>;

const req = (check: Check, label: string) => ({ check, label });
const opt = (check: Check, label: string) => ({ check, label, optional: true });
const nullable = (check: Check) => (v: unknown) => v === null || check(v);

const META: Shape = {
  id: req(isId, "identifiant non vide"),
  updatedAt: req(isNat, "entier ≥ 0"),
  deletedAt: req(nullable(isNat), "null ou entier ≥ 0"),
};

const SHAPES: Record<CollectionName, Shape> = {
  categories: {
    ...META,
    name: req(isStr, "texte"),
    kind: req(oneOf(["in", "out"]), "« in » ou « out »"),
    bucket: opt(oneOf(["besoin", "envie", "invest"]), "besoin, envie ou invest"),
    color: req(isColor, "couleur 0–6"),
  },
  accounts: {
    ...META,
    name: req(isStr, "texte"),
    role: req(oneOf(["courant", "epargne", "invest", "autre"]), "rôle connu"),
    opening: req(isInt, "centimes entiers"),
    safety: req(isBool, "booléen"),
    declaredValue: opt(isInt, "centimes entiers"),
    declaredAt: opt(isValidDay, "date AAAA-MM-JJ"),
    color: req(isColor, "couleur 0–6"),
    position: opt(isInt, "entier"),
  },
  operations: {
    ...META,
    date: req(isValidDay, "date AAAA-MM-JJ"),
    amount: req(isPos, "centimes entiers > 0"),
    type: req(oneOf(["in", "out", "tx"]), "in, out ou tx"),
    note: req(isStr, "texte"),
    categoryId: opt(isId, "identifiant"),
    accountId: opt(isId, "identifiant"),
    fromAccountId: opt(isId, "identifiant"),
    toAccountId: opt(isId, "identifiant"),
    goalId: opt(isId, "identifiant"),
    debtId: opt(isId, "identifiant"),
    recurrenceId: opt(isId, "identifiant"),
    tagId: opt(isId, "identifiant"),
  },
  goals: {
    ...META,
    name: req(isStr, "texte"),
    target: req(isNat, "centimes entiers ≥ 0"),
    targetMode: req(oneOf(["manual", "steps"]), "manual ou steps"),
    source: req(oneOf(["tagged", "account"]), "tagged ou account"),
    accountIds: req((v) => Array.isArray(v) && v.every(isId), "liste d'identifiants"),
    due: req(nullable(isValidDay), "null ou date"),
    hidden: req(isBool, "booléen"),
    pinned: req(isBool, "booléen"),
    done: req(isBool, "booléen"),
    doneAt: req(nullable(isValidDay), "null ou date"),
    archived: req(isBool, "booléen"),
    position: req(isInt, "entier"),
    color: req(isColor, "couleur 0–6"),
  },
  goalSteps: {
    ...META,
    goalId: req(isId, "identifiant"),
    label: req(isStr, "texte"),
    amount: req(isNat, "centimes entiers ≥ 0"),
    done: req(isBool, "booléen"),
    position: req(isInt, "entier"),
  },
  debts: {
    ...META,
    name: req(isStr, "texte"),
    creditor: req(isStr, "texte"),
    direction: req(oneOf(["owe", "lent"]), "owe ou lent"),
    principal: req(isNat, "centimes entiers ≥ 0"),
    paidManual: req(isNat, "centimes entiers ≥ 0"),
    mode: req(oneOf(["installments", "free"]), "installments ou free"),
    installmentAmount: req(isNat, "centimes entiers ≥ 0"),
    installmentCount: req((v) => isNat(v) && v <= MAX_INSTALLMENTS, `entier 0–${MAX_INSTALLMENTS}`),
    startDate: req(isValidDay, "date AAAA-MM-JJ"),
    dayOfMonth: req((v) => isInt(v) && v >= 1 && v <= 31, "jour 1–31"),
    categoryId: req(nullable(isId), "null ou identifiant"),
    accountId: req(nullable(isId), "null ou identifiant"),
    recurrenceId: req(nullable(isId), "null ou identifiant"),
    hidden: req(isBool, "booléen"),
    pinned: req(isBool, "booléen"),
    settled: req(isBool, "booléen"),
    settledAt: req(nullable(isValidDay), "null ou date"),
    archived: req(isBool, "booléen"),
    position: req(isInt, "entier"),
    color: req(isColor, "couleur 0–6"),
  },
  recurrences: {
    ...META,
    label: req(isStr, "texte"),
    amount: req(isPos, "centimes entiers > 0"),
    type: req(oneOf(["in", "out", "tx"]), "in, out ou tx"),
    categoryId: opt(isId, "identifiant"),
    accountId: opt(isId, "identifiant"),
    fromAccountId: opt(isId, "identifiant"),
    toAccountId: opt(isId, "identifiant"),
    goalId: opt(isId, "identifiant"),
    debtId: opt(isId, "identifiant"),
    tagId: opt(isId, "identifiant"),
    dayOfMonth: req((v) => isInt(v) && v >= 1 && v <= 31, "jour 1–31"),
    startMonth: req(isValidMonth, "mois AAAA-MM"),
    endMonth: req(nullable(isValidMonth), "null ou mois"),
    active: req(isBool, "booléen"),
  },
  skips: {
    ...META,
    month: req(isValidMonth, "mois AAAA-MM"),
    recurrenceId: req(isId, "identifiant"),
  },
  tags: {
    ...META,
    name: req((v) => isStr(v) && v.trim() !== "" && v === v.trim(), "texte non vide, sans espace en bord"),
  },
};

function checkShape(value: unknown, shape: Shape, where: string, issues: string[]): value is Obj {
  if (!isObj(value)) {
    issues.push(`${where} : objet attendu`);
    return false;
  }
  let ok = true;
  for (const [key, rule] of Object.entries(shape)) {
    const v = value[key];
    if (v === undefined) {
      if (!rule.optional) {
        issues.push(`${where}.${key} manquant (${rule.label})`);
        ok = false;
      }
    } else if (!rule.check(v)) {
      issues.push(`${where}.${key} invalide : ${JSON.stringify(v)} (${rule.label})`);
      ok = false;
    }
  }
  for (const key of Object.keys(value)) {
    if (!(key in shape) && value[key] !== undefined) {
      issues.push(`${where}.${key} : champ inconnu`);
      ok = false;
    }
  }
  return ok;
}

/** Cohérence entre champs, indépendante des autres lignes. */
function checkInvariants(name: CollectionName, r: Obj, where: string, issues: string[]): void {
  if (name === "categories") {
    if (r.kind === "out" && r.bucket === undefined) issues.push(`${where} : une catégorie de dépense doit avoir une enveloppe`);
    if (r.kind === "in" && r.bucket !== undefined) issues.push(`${where} : une catégorie de revenu n'a pas d'enveloppe`);
  }
  if (name === "operations" || name === "recurrences") {
    if (r.type === "tx") {
      if (r.fromAccountId === undefined || r.toAccountId === undefined)
        issues.push(`${where} : un transfert exige un compte source et un compte destination`);
      else if (r.fromAccountId === r.toAccountId) issues.push(`${where} : source et destination identiques`);
      if (r.categoryId !== undefined || r.accountId !== undefined)
        issues.push(`${where} : un transfert ne porte ni catégorie ni compte simple`);
    } else {
      if (r.categoryId === undefined || r.accountId === undefined)
        issues.push(`${where} : une dépense ou un revenu exige une catégorie et un compte`);
      if (r.fromAccountId !== undefined || r.toAccountId !== undefined)
        issues.push(`${where} : seuls les transferts portent des comptes source et destination`);
    }
  }
  if (name === "debts" && r.mode === "installments") {
    const amount = r.installmentAmount as number;
    const count = r.installmentCount as number;
    if (amount <= 0 || count < 1) {
      issues.push(`${where} : un échéancier exige un montant par échéance et au moins une échéance`);
    } else if ((r.principal as number) > amount * count) {
      issues.push(`${where} : le montant total dépasse ce que couvrent les échéances (${count} × ${amount})`);
    }
  }
  if (name === "recurrences" && isValidMonth(r.endMonth) && isValidMonth(r.startMonth) && r.endMonth < r.startMonth) {
    issues.push(`${where} : fin avant le début`);
  }
}

type Lookup = Record<CollectionName, Map<string, Obj>>;

/** Références d'une ligne vivante : elles doivent exister, vivantes ou supprimées. */
function checkReferences(name: CollectionName, r: Obj, where: string, lookup: Lookup, issues: string[]): void {
  const ref = (key: string, target: CollectionName) => {
    const id = r[key];
    if (id === undefined) return undefined;
    const found = lookup[target].get(id as string);
    if (!found) issues.push(`${where}.${key} : référence introuvable (${String(id)})`);
    return found;
  };
  if (name === "operations" || name === "recurrences") {
    const category = ref("categoryId", "categories");
    if (category && category.kind !== r.type) issues.push(`${where} : catégorie de type « ${String(category.kind)} » sur une opération « ${String(r.type)} »`);
    ref("accountId", "accounts");
    ref("fromAccountId", "accounts");
    ref("toAccountId", "accounts");
    ref("goalId", "goals");
    ref("debtId", "debts");
    ref("tagId", "tags");
    if (name === "operations") ref("recurrenceId", "recurrences");
  }
  if (name === "debts") {
    const category = r.categoryId === null ? undefined : ref("categoryId", "categories");
    const expected = r.direction === "owe" ? "out" : "in";
    if (category && category.kind !== expected) {
      issues.push(`${where} : une dette « ${String(r.direction)} » attend une catégorie « ${expected} »`);
    }
    if (r.accountId !== null) ref("accountId", "accounts");
    if (r.recurrenceId !== null) ref("recurrenceId", "recurrences");
  }
  if (name === "goals" && Array.isArray(r.accountIds)) {
    for (const id of r.accountIds) {
      if (!lookup.accounts.has(id as string)) issues.push(`${where}.accountIds : référence introuvable (${String(id)})`);
    }
  }
  if (name === "goalSteps") ref("goalId", "goals");
  if (name === "skips") ref("recurrenceId", "recurrences");
}

function checkPreferences(value: unknown, issues: string[]): void {
  const where = "preferences";
  if (!isObj(value)) {
    issues.push(`${where} : objet attendu`);
    return;
  }
  const shape: Shape = {
    splits: req(isObj, "objet"),
    basis: req(oneOf(["month", "avg"]), "month ou avg"),
    averageWindow: req(oneOf(AVERAGE_WINDOWS), "3, 6 ou 12"),
    safety: req(isObj, "objet"),
    dashOrder: req(Array.isArray, "liste"),
    theme: req(oneOf(["system", "light", "dark"]), "system, light ou dark"),
    categoryColors: req((v) => isObj(v) && Object.values(v).every(isHex), "id → #rrggbb"),
    bucketColors: req(
      (v) => isObj(v) && Object.entries(v).every(([k, c]) => ["besoin", "envie", "invest"].includes(k) && isHex(c)),
      "besoin / envie / invest → #rrggbb",
    ),
    updatedAt: req(isObj, "objet"),
  };
  if (!checkShape(value, shape, where, issues)) return;
  const splits = value.splits as Obj;
  if (
    checkShape(
      splits,
      { besoin: req(isNat, "entier ≥ 0"), envie: req(isNat, "entier ≥ 0"), invest: req(isNat, "entier ≥ 0") },
      `${where}.splits`,
      issues,
    ) &&
    (splits.besoin as number) + (splits.envie as number) + (splits.invest as number) !== SPLITS_TOTAL
  ) {
    issues.push(`${where}.splits : la somme doit valoir ${SPLITS_TOTAL} (100 %)`);
  }
  checkShape(
    value.safety,
    {
      mode: req(oneOf(["months", "amount"]), "months ou amount"),
      months: req((v) => isInt(v) && v >= 1 && v <= 60, "entier 1–60"),
      amount: req(isNat, "centimes entiers ≥ 0"),
      hidden: req(isBool, "booléen"),
      pinned: req(isBool, "booléen"),
    },
    `${where}.safety`,
    issues,
  );
  const order = value.dashOrder as unknown[];
  if (order.length !== DASH_BLOCKS.length || !DASH_BLOCKS.every((b) => order.includes(b))) {
    issues.push(`${where}.dashOrder : doit contenir exactement ${DASH_BLOCKS.join(", ")}`);
  }
  checkShape(
    value.updatedAt,
    Object.fromEntries(PREF_KEYS.map((k) => [k, req(isNat, "entier ≥ 0")])),
    `${where}.updatedAt`,
    issues,
  );
}

/** Liste toutes les anomalies d'un jeu de données ; vide s'il est valide. */
export function validateDataset(value: unknown): string[] {
  const issues: string[] = [];
  if (!isObj(value)) return ["jeu de données : objet attendu"];
  if (value.schemaVersion !== SCHEMA_VERSION) issues.push(`schemaVersion : ${SCHEMA_VERSION} attendu`);
  const collections = value.collections;
  if (!isObj(collections)) return [...issues, "collections : objet attendu"];
  for (const key of Object.keys(collections)) {
    if (!COLLECTION_NAMES.includes(key as CollectionName)) issues.push(`collections.${key} : collection inconnue`);
  }

  const lookup = Object.fromEntries(COLLECTION_NAMES.map((n) => [n, new Map<string, Obj>()])) as Lookup;
  const valid: [CollectionName, Obj, string][] = [];
  for (const name of COLLECTION_NAMES) {
    const list = collections[name];
    if (!Array.isArray(list)) {
      issues.push(`collections.${name} : liste attendue`);
      continue;
    }
    list.forEach((record, i) => {
      const where = `${name}[${i}]`;
      if (!checkShape(record, SHAPES[name], where, issues)) return;
      checkInvariants(name, record, where, issues);
      const id = record.id as string;
      if (lookup[name].has(id)) issues.push(`${where} : identifiant en double (${id})`);
      lookup[name].set(id, record);
      valid.push([name, record, where]);
    });
  }
  for (const [name, record, where] of valid) {
    if (record.deletedAt === null) checkReferences(name, record, where, lookup, issues);
  }
  checkPreferences(value.preferences, issues);
  return issues;
}

export function assertValidDataset(value: unknown): asserts value is Dataset {
  const issues = validateDataset(value);
  if (issues.length > 0) throw new ValidationError(issues);
}

/** Vérifie une ligne avant écriture, références comprises, contre le jeu où elle va entrer. */
export function validateRecord(name: CollectionName, record: AnyRecord, data: Dataset): string[] {
  const issues: string[] = [];
  const where = `${name}:${record.id}`;
  if (!checkShape(record, SHAPES[name], where, issues)) return issues;
  checkInvariants(name, record as unknown as Obj, where, issues);
  if (record.deletedAt === null) {
    const lookup = Object.fromEntries(
      COLLECTION_NAMES.map((n) => [n, new Map(data.collections[n].map((r) => [r.id, r as unknown as Obj]))]),
    ) as Lookup;
    lookup[name].set(record.id, record as unknown as Obj);
    checkReferences(name, record as unknown as Obj, where, lookup, issues);
  }
  return issues;
}
