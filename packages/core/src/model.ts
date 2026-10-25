/** Montant en centimes : entier sûr, jamais un flottant. */
export type Cents = number;
/** Jour civil "YYYY-MM-DD". */
export type Day = string;
/** Mois civil "YYYY-MM". */
export type Month = string;
export type SeriesColor = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const SERIES_COLORS = 7;

export type Meta = {
  id: string;
  /** Epoch ms de la dernière écriture, horloge de l'appareil qui a écrit. */
  updatedAt: number;
  /** Pierre tombale : on ne supprime jamais une ligne, on la marque. */
  deletedAt: number | null;
};

/**
 * Les trois usages du format 2. Le format 3 les remplace par des budgets (décision 71) ; ils ne
 * servent plus qu'à la reprise de l'ancien fichier et à la mise à niveau.
 */
export type Bucket = "besoin" | "envie" | "invest";
/** Nature d'un budget : ce qu'on dépense, ou ce qu'on met de côté (décision 74). */
export type BudgetNature = "spend" | "save";
export type Role = "courant" | "epargne" | "invest" | "autre";
export type OpType = "in" | "out" | "tx";

/** Budget (format 3, décision 71) : Dépenses courantes, Loisirs, Épargne, ou ceux qu'on ajoute. */
export type Budget = Meta & {
  name: string;
  nature: BudgetNature;
  position: number;
  /** Couleur de série d'un budget ajouté ; les trois budgets par défaut suivent le thème. */
  color: SeriesColor;
};

/** Objectif d'un type (décision 79) : en mois de dépenses ou en montant, comme l'ancienne précaution. */
export type TypeObjective = {
  mode: "months" | "amount";
  months: number;
  amount: Cents;
  hidden: boolean;
  pinned: boolean;
};

/**
 * Type d'un budget (format 3, décision 72) : Charges fixes, Épargne de précaution… Son budget ne
 * change jamais après la création, pour qu'une fusion ne sépare pas une catégorie de son type.
 */
export type BudgetType = Meta & {
  budgetId: string;
  name: string;
  position: number;
  objective: TypeObjective | null;
};

export type Category = Meta & {
  name: string;
  kind: "in" | "out";
  /** Obligatoire si kind = "out", absent si kind = "in" (format 3). */
  budgetId?: string;
  /** Facultatif ; un type du même budget (format 3). */
  typeId?: string;
  color: SeriesColor;
};

export type Account = Meta & {
  name: string;
  role: Role;
  /** Solde de départ, point zéro du suivi. Peut être négatif. */
  opening: Cents;
  /**
   * Types auxquels le compte est rattaché, le premier étant son type principal (format 3,
   * décision 77). Absent = aucun.
   */
  typeIds?: string[];
  /**
   * Valeur saisie à la main, jamais calculée. Pour un compte épargne, placement ou autre, elle
   * remplace le capital injecté dans le total des comptes et le patrimoine net (décisions 42 à 44).
   */
  declaredValue?: Cents;
  declaredAt?: Day;
  color: SeriesColor;
  /**
   * Ordre d'affichage, choisi dans Mes comptes et synchronisé (format 2). Absent : après les comptes
   * ordonnés, dans l'ordre d'arrivée.
   */
  position?: number;
};

export type Operation = Meta & {
  date: Day;
  /** Toujours positif ; le signe vient du type. */
  amount: Cents;
  type: OpType;
  note: string;
  categoryId?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  goalId?: string;
  /** Rattachement à une dette ; peut coexister avec goalId. */
  debtId?: string;
  recurrenceId?: string;
  /** Tag (format 2). Un tag supprimé ne s'affiche plus, sans que l'opération soit réécrite. */
  tagId?: string;
  /** Part réservée à un type dans le compte (format 3, décision 78). */
  typeId?: string;
};

export type GoalStep = Meta & {
  goalId: string;
  label: string;
  amount: Cents;
  done: boolean;
  position: number;
};

export type Goal = Meta & {
  name: string;
  target: Cents;
  targetMode: "manual" | "steps";
  source: "tagged" | "account";
  accountIds: string[];
  due: Day | null;
  hidden: boolean;
  pinned: boolean;
  done: boolean;
  doneAt: Day | null;
  archived: boolean;
  position: number;
  color: SeriesColor;
};

export type Recurrence = Meta & {
  label: string;
  amount: Cents;
  type: OpType;
  categoryId?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  goalId?: string;
  /** Propagé à chaque occurrence ; la génération suit alors l'échéancier de la dette. */
  debtId?: string;
  /** Propagé à chaque occurrence (format 2). */
  tagId?: string;
  /** Propagé à chaque occurrence (format 3). */
  typeId?: string;
  /** 1–31, rabattu sur le dernier jour des mois courts. */
  dayOfMonth: number;
  startMonth: Month;
  endMonth: Month | null;
  active: boolean;
};

export type DebtDirection = "owe" | "lent";
/** Plafond de l'échéancier : 100 ans de mensualités. */
export const MAX_INSTALLMENTS = 1200;

export type Debt = Meta & {
  name: string;
  /** Organisme ou personne, texte libre. */
  creditor: string;
  /** « je dois » ou « on me doit ». */
  direction: DebtDirection;
  /** Montant total ; 0 = non renseigné, le total est alors calculé. */
  principal: Cents;
  /** Déjà réglé hors application : sert à rattraper l'historique d'une dette entamée. */
  paidManual: Cents;
  mode: "installments" | "free";
  /** > 0 en mode échéances ; ignoré en mode libre. */
  installmentAmount: Cents;
  /** ≥ 1 en mode échéances ; ignoré en mode libre. */
  installmentCount: number;
  /** Première échéance. */
  startDate: Day;
  /** Déduit de startDate, modifiable ; rabattu sur le dernier jour des mois courts. */
  dayOfMonth: number;
  /** « je dois » → catégorie de dépense ; « on me doit » → catégorie de revenu. */
  categoryId: string | null;
  accountId: string | null;
  /** Prélèvement automatique associé. */
  recurrenceId: string | null;
  hidden: boolean;
  pinned: boolean;
  /** Drapeau manuel, comme `done` des objectifs. */
  settled: boolean;
  settledAt: Day | null;
  archived: boolean;
  position: number;
  color: SeriesColor;
};

/**
 * Tag d'opérations (format 2) : relie des opérations d'un même projet ou objectif. Son identifiant
 * se déduit de son nom à la création (décision 47) ; le renommer garde son identité.
 */
export type Tag = Meta & { name: string };

/** Occurrence annulée. */
export type Skip = Meta & { month: Month; recurrenceId: string };

export type DashBlock = "goals" | "debts" | "stats" | "months" | "savings" | "cats";
export const DASH_BLOCKS: readonly DashBlock[] = ["goals", "debts", "stats", "months", "savings", "cats"];

export type AverageWindow = 3 | 6 | 12;
export const AVERAGE_WINDOWS: readonly AverageWindow[] = [3, 6, 12];

/**
 * Répartition en points de base entiers par budget : 5000 = 50 %. Somme exactement 10 000 ; un
 * budget absent compte pour 0 (décision 75).
 */
export type Splits = Record<string, number>;
export const SPLITS_TOTAL = 10_000;

export type Preferences = {
  splits: Splits;
  basis: "month" | "avg";
  averageWindow: AverageWindow;
  dashOrder: DashBlock[];
  theme: "system" | "light" | "dark";
  /** Couleur choisie par source de revenu : id de catégorie → "#rrggbb". */
  categoryColors: Record<string, string>;
  /** Couleur choisie par budget : id de budget → "#rrggbb" ; absente = couleur par défaut (décision 76). */
  budgetColors: Record<string, string>;
  /** Horodatage par clé, pour la fusion clé par clé. */
  updatedAt: Record<PrefKey, number>;
};
export type PrefKey = Exclude<keyof Preferences, "updatedAt">;
export const PREF_KEYS: readonly PrefKey[] = [
  "splits",
  "basis",
  "averageWindow",
  "dashOrder",
  "theme",
  "categoryColors",
  "budgetColors",
];

export type Collections = {
  categories: Category[];
  accounts: Account[];
  operations: Operation[];
  goals: Goal[];
  goalSteps: GoalStep[];
  debts: Debt[];
  recurrences: Recurrence[];
  skips: Skip[];
  tags: Tag[];
  budgets: Budget[];
  types: BudgetType[];
};
export type CollectionName = keyof Collections;
export const COLLECTION_NAMES: readonly CollectionName[] = [
  "categories",
  "accounts",
  "operations",
  "goals",
  "goalSteps",
  "debts",
  "recurrences",
  "skips",
  "tags",
  "budgets",
  "types",
];
export type AnyRecord = Collections[CollectionName][number];

/**
 * 2 : tags, tag des opérations et des récurrences, ordre des comptes (version 0.2.0).
 * 3 : budgets et types à la place des usages, comptes et opérations rattachés aux types, précaution
 * devenue l'objectif d'un type (version 0.6.0, décisions 71 à 83).
 */
export const SCHEMA_VERSION = 3;

export type Dataset = {
  schemaVersion: typeof SCHEMA_VERSION;
  collections: Collections;
  preferences: Preferences;
};

/** Lignes à insérer ou remplacer, par collection. */
export type Changes = { [K in CollectionName]?: Collections[K] };
