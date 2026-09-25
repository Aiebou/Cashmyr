import { findTag, type Dataset } from "@cashmyr/core";
import { tagSuggestions } from "../lib/tags";
import { Field, TextInput } from "./controls";

type Props = { id: string; data: Dataset; value: string; onChange(value: string): void };

/**
 * Champ Tag d'une opération ou d'une récurrence : les tags existants sont proposés ; un nom
 * nouveau crée le tag à l'enregistrement.
 */
export function TagField({ id, data, value, onChange }: Props) {
  const isNew = value.trim() !== "" && !findTag(data, value);
  return (
    <Field
      label="Tag"
      htmlFor={id}
      hint={isNew ? `Nouveau tag « ${value.trim().replace(/\s+/g, " ")} », créé à l'enregistrement` : "Facultatif : relie des opérations d'un même projet"}
    >
      <TextInput id={id} list={`${id}-list`} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      <datalist id={`${id}-list`}>
        {tagSuggestions(data).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </Field>
  );
}
