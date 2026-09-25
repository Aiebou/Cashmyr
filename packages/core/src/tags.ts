import { indexOf } from "./dataset";
import { derivedId, newId } from "./ids";
import type { Cents, Changes, Dataset, Operation, Tag } from "./model";
import { cleanName, nameKey } from "./names";
import { createRecord, revive, tombstone, touch } from "./records";

export class TagError extends Error {
  override name = "TagError";
}

/** Nom affiché d'un tag : espaces en trop retirés. */
export const cleanTagName = cleanName;

/** Clé d'identité d'un tag : sans casse, accents ni espaces en trop (« Société  A » = « societe a »). */
export const tagKey = nameKey;

/** Identifiant d'un tag créé sous ce nom : le même sur tous les appareils (décision 47). */
export const tagIdFor = (name: string): string => derivedId("tag", tagKey(name));

const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) || a.id.localeCompare(b.id);

/** Tags vivants, par ordre alphabétique. */
export const liveTags = (data: Dataset): Tag[] => data.collections.tags.filter((t) => t.deletedAt === null).sort(byName);

/** Tag vivant de ce nom, à la casse, aux accents et aux espaces près. */
export function findTag(data: Dataset, name: string): Tag | undefined {
  const key = tagKey(name);
  return liveTags(data).find((t) => tagKey(t.name) === key);
}

/** Tag à afficher pour une opération ou une récurrence : seulement s'il est vivant (décision 48). */
export function shownTag(data: Dataset, tagId: string | undefined): Tag | undefined {
  if (!tagId) return undefined;
  const tag = indexOf(data).tags.get(tagId);
  return tag && tag.deletedAt === null ? tag : undefined;
}

/**
 * Le tag de ce nom, existant ou à créer (décision 47). Un tag vivant du même nom est repris.
 * Sinon, l'identifiant se déduit du nom, pour que deux appareils qui créent le même nom créent le
 * même tag. Si cet identifiant est celui d'un tag supprimé du même nom, ce tag revient, et les
 * opérations qui le portaient le retrouvent ; s'il est celui d'un tag renommé depuis, le nouveau
 * tag reçoit un identifiant aléatoire.
 */
export function resolveTag(data: Dataset, name: string, now: number): { tag: Tag; changes: Changes } {
  const clean = cleanTagName(name);
  if (clean === "") throw new TagError("Donne un nom au tag.");
  const existing = findTag(data, clean);
  if (existing) return { tag: existing, changes: {} };
  const id = tagIdFor(clean);
  const taken = indexOf(data).tags.get(id);
  let tag: Tag;
  if (!taken) tag = createRecord<Tag>(id, { name: clean }, now);
  else if (taken.deletedAt !== null && tagKey(taken.name) === tagKey(clean)) tag = revive(taken, { name: clean }, now);
  else tag = createRecord<Tag>(newId(), { name: clean }, now);
  return { tag, changes: { tags: [tag] } };
}

/** Renomme un tag, qui garde son identité ; refuse un nom déjà porté par un autre tag. */
export function renameTag(data: Dataset, id: string, name: string, now: number): Changes {
  const tag = indexOf(data).tags.get(id);
  if (!tag || tag.deletedAt !== null) throw new TagError("Tag introuvable.");
  const clean = cleanTagName(name);
  if (clean === "") throw new TagError("Donne un nom au tag.");
  const other = findTag(data, clean);
  if (other && other.id !== id) throw new TagError(`Le tag « ${other.name} » existe déjà.`);
  return clean === tag.name ? {} : { tags: [touch(tag, { name: clean }, now)] };
}

/**
 * Supprime un tag (décision 48). Les opérations et récurrences qui le portent ne sont pas
 * réécrites : elles ne l'affichent plus, et le retrouvent s'il revient.
 */
export function deleteTag(data: Dataset, id: string, now: number): Changes {
  const tag = indexOf(data).tags.get(id);
  if (!tag || tag.deletedAt !== null) throw new TagError("Tag introuvable.");
  return { tags: [tombstone(tag, now)] };
}

/** Opérations et récurrences vivantes qui portent chaque tag. */
export function tagUsage(data: Dataset): Map<string, { operations: number; recurrences: number }> {
  const usage = new Map<string, { operations: number; recurrences: number }>();
  const entry = (id: string) => {
    let e = usage.get(id);
    if (!e) usage.set(id, (e = { operations: 0, recurrences: 0 }));
    return e;
  };
  for (const op of indexOf(data).liveOps) if (op.tagId) entry(op.tagId).operations++;
  for (const rec of data.collections.recurrences) if (rec.deletedAt === null && rec.tagId) entry(rec.tagId).recurrences++;
  return usage;
}

export type TagTotals = {
  inflow: Cents;
  outflow: Cents;
  /** Entrées − sorties. */
  net: Cents;
  /** Transferts du tag : listés, jamais comptés, ils ne font que déplacer l'argent entre tes comptes. */
  transfers: number;
};

/** Totaux des opérations d'un tag sur la période affichée (décision 48). */
export function tagTotals(ops: readonly Operation[]): TagTotals {
  const totals: TagTotals = { inflow: 0, outflow: 0, net: 0, transfers: 0 };
  for (const op of ops) {
    if (op.type === "in") totals.inflow += op.amount;
    else if (op.type === "out") totals.outflow += op.amount;
    else totals.transfers++;
  }
  totals.net = totals.inflow - totals.outflow;
  return totals;
}
