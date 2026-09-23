import type { Meta } from "./model";

type Fields<T extends Meta> = Partial<Omit<T, keyof Meta>>;

/**
 * Horodatage d'une écriture : jamais inférieur ni égal à la version précédente.
 * Une modification faite après avoir vu une version la bat toujours à la fusion,
 * même si l'horloge locale retarde.
 */
export const nextStamp = (now: number, previous?: Pick<Meta, "updatedAt">): number =>
  previous ? Math.max(now, previous.updatedAt + 1) : now;

export const isAlive = (record: Pick<Meta, "deletedAt">): boolean => record.deletedAt === null;

export const alive = <T extends Meta>(records: readonly T[]): T[] => records.filter(isAlive);

export function createRecord<T extends Meta>(id: string, fields: Omit<T, keyof Meta>, now: number): T {
  return { ...fields, id, updatedAt: now, deletedAt: null } as T;
}

export function touch<T extends Meta>(record: T, patch: Fields<T>, now: number): T {
  return { ...record, ...patch, updatedAt: nextStamp(now, record) };
}

export function tombstone<T extends Meta>(record: T, now: number): T {
  const stamp = nextStamp(now, record);
  return { ...record, updatedAt: stamp, deletedAt: stamp };
}

export function revive<T extends Meta>(record: T, patch: Fields<T>, now: number): T {
  return { ...record, ...patch, updatedAt: nextStamp(now, record), deletedAt: null };
}
