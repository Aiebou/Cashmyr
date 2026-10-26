import { indexOf, reservableTypes, type Dataset } from "@cashmyr/core";
import { Field, Select } from "./controls";

type Props = {
  id: string;
  data: Dataset;
  /** Les comptes que touche l'opération : le compte, ou la source et la destination d'un transfert. */
  accountIds: readonly (string | undefined)[];
  value: string;
  onChange(typeId: string): void;
};

/**
 * Réserver une part (décision 78) : à quel type d'un compte cette somme revient. Proposé seulement
 * quand un compte touché porte un type en plus de son principal ; sans choix, la somme va au principal.
 * Un rattachement déjà posé reste affiché, même si le compte ne porte plus ce type.
 */
export function ReserveField({ id, data, accountIds, value, onChange }: Props) {
  const types = reservableTypes(data, accountIds);
  const kept = value && !types.some((t) => t.id === value) ? indexOf(data).types.get(value) : undefined;
  if (types.length === 0 && !kept) return null;
  return (
    <Field label="Part réservée à" htmlFor={id} hint="Facultatif : sans choix, la somme revient au type principal du compte">
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Aucune (type principal)</option>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        {kept && <option value={kept.id}>{kept.deletedAt === null ? `${kept.name} (pas sur ce compte)` : `${kept.name} (supprimé)`}</option>}
      </Select>
    </Field>
  );
}
