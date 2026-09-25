import { indexOf, shownTag, type Cents, type Dataset, type OpType } from "@cashmyr/core";
import { BUCKET_LABELS } from "./data";

/** Colonnes de l'export de l'ancienne application, colonne Dette comprise, puis le tag (version 0.2.0). */
export const CSV_HEADER = ["Date", "Type", "Categorie", "Usage", "Compte", "Vers", "Objectif", "Dette", "Libelle", "Montant", "Tag"] as const;

const TYPE_LABELS: Record<OpType, string> = { out: "Dépense", in: "Revenu", tx: "Transfert" };

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** « 1234,56 » : euros, virgule décimale, sans séparateur de milliers ni signe (le type porte le sens). */
export const csvAmount = (cents: Cents): string => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;

/**
 * Opérations en CSV, comme l'ancienne application : champs entre guillemets, séparés par des
 * points-virgules, lignes terminées par CRLF. Un BOM UTF-8 en tête, pour qu'Excel lise les accents.
 * Les noms sont ceux du moment, y compris pour un élément supprimé depuis ; sauf un tag supprimé,
 * qui ne s'affiche plus nulle part (décision 48).
 */
export function operationsCsv(data: Dataset): string {
  const ix = indexOf(data);
  const name = (map: Map<string, { name: string }>, id: string | undefined) => (id ? (map.get(id)?.name ?? "") : "");
  const ops = [...ix.liveOps].sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
  const rows = ops.map((op) => {
    const category = op.categoryId ? ix.categories.get(op.categoryId) : undefined;
    return [
      op.date,
      TYPE_LABELS[op.type],
      category?.name ?? "",
      op.type === "out" && category?.bucket ? BUCKET_LABELS[category.bucket] : "",
      name(ix.accounts, op.type === "tx" ? op.fromAccountId : op.accountId),
      op.type === "tx" ? name(ix.accounts, op.toAccountId) : "",
      name(ix.goals, op.goalId),
      name(ix.debts, op.debtId),
      op.note,
      csvAmount(op.amount),
      shownTag(data, op.tagId)?.name ?? "",
    ];
  });
  return `﻿${[CSV_HEADER as readonly string[], ...rows].map((r) => r.map(quote).join(";")).join("\r\n")}\r\n`;
}
