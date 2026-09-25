import { deleteTag, liveTags, renameTag, tagUsage, type Tag } from "@cashmyr/core";
import { Button, cx, InlineText } from "../../components/controls";
import { TrashIcon } from "../../components/icons";
import { Card } from "../../components/layout";
import { count } from "../../lib/format";
import { useActions, useApp } from "../../store/context";
import s from "./Settings.module.css";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tags (décisions 47 et 48) : ils naissent dans la saisie d'une opération, se renomment et se suppriment ici. */
export function TagsSection() {
  const data = useApp((st) => st.data);
  const { apply, ask, toast } = useActions();
  const tags = liveTags(data);
  const usage = tagUsage(data);

  const usageText = (tag: Tag) => {
    const u = usage.get(tag.id);
    const parts = [
      u?.operations ? count(u.operations, "opération", "opérations") : "",
      u?.recurrences ? count(u.recurrences, "récurrence", "récurrences") : "",
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "Aucune opération";
  };

  const rename = (tag: Tag, name: string) => {
    try {
      void apply(renameTag(data, tag.id, name, Date.now()));
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const remove = async (tag: Tag) => {
    const used = usage.has(tag.id);
    const ok = await ask({
      title: `Supprimer le tag « ${tag.name} » ?`,
      message: used
        ? `${usageText(tag)} le portent. Elles ne sont pas modifiées : elles ne l'affichent plus, et le retrouveront si un tag de ce nom est recréé.`
        : "Aucune opération ne le porte.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (ok) await apply(deleteTag(data, tag.id, Date.now()), undefined, "Tag supprimé");
  };

  return (
    <Card title="Tags" subtitle="Un tag relie des opérations d'un même projet ou objectif, quelles que soient leurs catégories.">
      {tags.length === 0 ? (
        <p className={s.muted}>Aucun tag pour l'instant : tape un nom dans le champ Tag d'une opération pour en créer un.</p>
      ) : (
        <ul className={cx(s.list, s.categoryList)}>
          {tags.map((tag) => (
            <li key={tag.id} className={s.categoryRow}>
              <InlineText label={`Nom du tag « ${tag.name} »`} value={tag.name} required onCommit={(name) => rename(tag, name)} />
              <span className={s.muted}>{usageText(tag)}</span>
              <Button size="small" variant="ghost" aria-label={`Supprimer le tag « ${tag.name} »`} onClick={() => void remove(tag)}>
                <TrashIcon size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className={s.muted}>
        Deux tags qui ne diffèrent que par les majuscules, les accents ou les espaces n'en font qu'un, sur tous tes appareils. Le total
        d'un tag se lit dans Opérations, en filtrant sur lui.
      </p>
    </Card>
  );
}
