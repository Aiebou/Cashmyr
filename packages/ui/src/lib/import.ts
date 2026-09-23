import { BackupError, importBackup, LegacyImportError, parseImport, type LegacyConversion, type ParsedImport } from "@cashmyr/core";
import type { AppStore } from "../store/app-store";
import { count } from "./format";

/** « a, b et c » */
const list = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} et ${parts.at(-1)}`);

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Ce que contient l'ancien fichier, en une phrase. */
function legacyContents({ counts }: LegacyConversion): string {
  return list(
    [
      counts.accounts > 0 ? count(counts.accounts, "compte", "comptes") : "",
      counts.categories > 0 ? count(counts.categories, "catégorie", "catégories") : "",
      counts.goals > 0 ? count(counts.goals, "objectif", "objectifs") : "",
      counts.debts > 0 ? count(counts.debts, "dette", "dettes") : "",
      count(counts.operations, "opération", "opérations"),
    ].filter(Boolean),
  );
}

/** Ce que la vérification croisée a trouvé identique. */
function legacyChecked({ checked }: LegacyConversion): string {
  return list(
    [
      checked.months > 0 ? `les totaux de ${count(checked.months, "mois", "mois")}` : "",
      checked.accounts > 0 ? `les soldes de ${count(checked.accounts, "compte", "comptes")}` : "",
      checked.goals > 0 ? `l'avancement de ${count(checked.goals, "objectif", "objectifs")}` : "",
      checked.debts > 0 ? `le réglé de ${count(checked.debts, "dette", "dettes")}` : "",
    ].filter(Boolean),
  );
}

/** Un import refusé le dit en entier, dans une fenêtre, jamais dans un message qui s'efface. */
function refuse(store: AppStore, issues: string[]): void {
  const shown = issues.slice(0, 6).map((issue) => `• ${issue}`);
  const more = issues.length > 6 ? [`… et ${issues.length - 6} autres problèmes.`] : [];
  void store.getState().actions.ask({
    title: "Reprise refusée",
    message: ["Rien n'a été écrit. Le fichier contient ce que Cashmyr ne sait pas reprendre sans risque :", "", ...shown, ...more].join("\n"),
    confirmLabel: "Compris",
    cancelLabel: null,
  });
}

/**
 * Importer un fichier, depuis l'accueil ou les paramètres : sauvegarde Cashmyr,
 * `finances-sync.json`, ou export de l'ancienne application (`mes-finances.json`).
 * Dans tous les cas, la fusion garde la version la plus récente de chaque ligne ;
 * les lignes reprises de l'ancienne application sont plus anciennes que tout ce qui a
 * été écrit dans Cashmyr (décisions 32 et 34).
 */
export async function importFromFile(store: AppStore): Promise<void> {
  const { platform, actions } = store.getState();
  const file = await platform.files.openText([".json", "application/json"]);
  if (!file) return;

  let parsed: ParsedImport;
  try {
    parsed = parseImport(file.content);
  } catch (e) {
    if (e instanceof LegacyImportError) refuse(store, e.issues);
    else actions.toast(e instanceof BackupError ? e.message : String(e), "error");
    return;
  }

  const { data: current, fresh } = store.getState();
  const imported = parsed.kind === "legacy" ? parsed.conversion.data : parsed.data;
  const result = importBackup(current, imported);
  if (result.added === 0 && result.modified === 0 && result.preferencesModified.length === 0) {
    actions.toast(
      parsed.kind === "legacy"
        ? "Rien de nouveau dans ce fichier : tout ce qu'il contient est déjà dans Cashmyr."
        : "Rien de nouveau dans ce fichier : cet appareil a déjà tout, dans une version au moins aussi récente.",
    );
    return;
  }

  // Seul ce qui change vraiment est annoncé : une ligne identique à l'horodatage près ne compte pas.
  const changes = `${capitalized(
    list(
      [
        result.added > 0 ? count(result.added, "ligne sera ajoutée", "lignes seront ajoutées") : "",
        result.modified > 0 ? count(result.modified, "ligne sera mise à jour", "lignes seront mises à jour") : "",
        result.preferencesModified.length > 0 ? count(result.preferencesModified.length, "réglage changera", "réglages changeront") : "",
      ].filter(Boolean),
    ),
  )}.`;
  const ok =
    parsed.kind === "legacy"
      ? await actions.ask({
          title: `Reprendre « ${file.name} » ?`,
          message: [
            `Ancienne application : ${legacyContents(parsed.conversion)}.`,
            `Vérifié au centime près par un recalcul sur l'ancien fichier : ${legacyChecked(parsed.conversion)}.`,
            fresh ? "" : `${changes} Rien de ce que Cashmyr contient déjà n'est écrasé.`,
          ]
            .filter(Boolean)
            .join("\n"),
          confirmLabel: "Reprendre mes données",
        })
      : await actions.ask({
          title: `Importer « ${file.name} » ?`,
          message: `${changes} Pour chaque ligne, la version la plus récente gagne : rien de plus récent n'est écrasé.`,
          confirmLabel: "Importer",
        });
  if (!ok) return;
  await actions.apply(
    result.changes,
    result.preferences,
    parsed.kind === "legacy" ? "Données de l'ancienne application reprises" : "Sauvegarde importée",
  );
}
