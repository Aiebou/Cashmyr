import type { Tab } from "../store/app-store";

/** Une étape : l'élément mis en lumière (sélecteur CSS) et ce qu'en dit la bulle. */
export type TourStep = {
  target: string;
  title: string;
  text: string | ((ctx: TourContext) => string);
};

export type TourContext = { shortcut: string | null };

const at = (name: string) => `[data-tour="${name}"]`;

/**
 * Le tutoriel de chaque onglet (décisions 65 à 67), montré à sa première visite. Une étape dont
 * l'élément n'est pas à l'écran (aucun objectif, aucune dette…) est sautée.
 */
export const TOUR: Record<Tab, TourStep[]> = {
  dashboard: [
    {
      target: at("tabs"),
      title: "Les sections",
      text: "Cashmyr se lit par sections. Chacune te présente ses outils la première fois que tu l'ouvres.",
    },
    {
      target: at("add"),
      title: "Ajouter",
      text: ({ shortcut }) =>
        `Une dépense, un revenu, un transfert entre tes comptes, un objectif, une dette ou un compte.${shortcut ? ` Raccourci : ${shortcut}.` : ""}`,
    },
    {
      target: at("sync"),
      title: "Synchronisation",
      text: "Où en est la synchronisation avec tes autres appareils. Un clic mène à ses réglages.",
    },
    {
      target: at("profile"),
      title: "Ton profil",
      text: "Passe d'un profil à l'autre, ou crée un budget à part, pour le foyer par exemple.",
    },
    {
      target: at("period"),
      title: "L'année affichée",
      text: "Remonte les années avec les flèches ; « Cette année » te ramène à aujourd'hui.",
    },
    {
      target: at("banner"),
      title: "Le total de tes comptes",
      text: "Touche le titre pour choisir le total : valeurs déclarées, ou capital injecté. La barre répartit ce total entre tes comptes.",
    },
    {
      target: at("targets"),
      title: "Tes cibles du mois",
      text: "Ce qu'il te reste pour tes besoins et tes envies, et ce qu'il reste à mettre de côté. Une cible dépassée passe en rouge.",
    },
    {
      target: at("blocks"),
      title: "Tes blocs",
      text: "Objectifs, dettes, indicateurs et courbes de l'année : déplace chaque bloc avec ses flèches, ou en le faisant glisser.",
    },
  ],
  month: [
    {
      target: at("period"),
      title: "Le mois affiché",
      text: "Passe d'un mois à l'autre avec les flèches.",
    },
    {
      target: at("month-split"),
      title: "Répartition",
      text: "Tes dépenses du mois en besoins, envies et mise de côté, face aux cibles que tu as fixées.",
    },
    {
      target: at("month-charts"),
      title: "Dépenses et revenus",
      text: "Tes dépenses par poste et tes revenus par source. « Masquer » range les graphiques.",
    },
    {
      target: at("month-ops"),
      title: "Dernières opérations",
      text: "Les opérations du mois ; un clic sur l'une d'elles la modifie.",
    },
  ],
  goals: [
    {
      target: at("safety"),
      title: "Épargne de précaution",
      text: "Le coussin pour les imprévus : combien de mois de dépenses il couvre, et où il en est.",
    },
    {
      target: at("goal"),
      title: "Un objectif",
      text: "Son avancement, suivi par le solde de comptes ou par les opérations que tu y rattaches. Avec une échéance, ce qu'il faut mettre de côté chaque mois.",
    },
    {
      target: at("new-goal"),
      title: "Nouvel objectif",
      text: "Un nom, un montant cible et, si tu veux, une échéance.",
    },
  ],
  debts: [
    {
      target: at("debt"),
      title: "Une dette",
      text: "Ce qui reste dû, la prochaine échéance et la date de fin. Tu peux y créer le prélèvement mensuel.",
    },
    {
      target: at("new-debt"),
      title: "Nouvelle dette",
      text: "Montant total, montant par échéance, nombre d'échéances : deux suffisent, le troisième se calcule.",
    },
  ],
  accounts: [
    {
      target: at("banner"),
      title: "Le total de tes comptes",
      text: "Le même total que sur le tableau de bord ; touche le titre pour en changer.",
    },
    {
      target: at("accounts-actions"),
      title: "Comptes et transferts",
      text: "Ajoute un compte, ou déplace de l'argent d'un compte à l'autre.",
    },
    {
      target: at("accounts-filter"),
      title: "Filtrer",
      text: "N'affiche que certains types de comptes : courants, épargne, placements…",
    },
    {
      target: at("accounts-list"),
      title: "Vos comptes",
      text: "Solde, valeur déclarée et capital injecté de chaque compte. « Modifier l'ordre » les range comme tu veux.",
    },
  ],
  operations: [
    {
      target: at("period"),
      title: "Le mois affiché",
      text: "Les opérations se lisent mois par mois.",
    },
    {
      target: at("ops-filters"),
      title: "Chercher et filtrer",
      text: "Par libellé, catégorie, compte, objectif, dette ou tag. Filtrer sur un tag donne ses totaux du mois.",
    },
    {
      target: at("ops-list"),
      title: "Tes opérations",
      text: "Un clic sur une opération la modifie ou la supprime.",
    },
  ],
  settings: [
    {
      target: at("settings-toc"),
      title: "Les réglages",
      text: "Un clic mène à chaque section : budget, comptes, catégories, profils, synchronisation, sauvegardes…",
    },
    {
      target: "#reglages-budget",
      title: "Ta répartition",
      text: "Les parts de tes revenus visées pour tes besoins, tes envies et ta mise de côté.",
    },
    {
      target: "#reglages-synchronisation",
      title: "Synchronisation",
      text: "Relie tes appareils par un fichier dans ton dossier cloud ; rien ne passe par un serveur.",
    },
    {
      target: "#reglages-sauvegardes",
      title: "Sauvegardes",
      text: "Exporte tes données, restaure une copie, ou repars de zéro.",
    },
  ],
};

export const stepText = (step: TourStep, ctx: TourContext): string => (typeof step.text === "function" ? step.text(ctx) : step.text);
