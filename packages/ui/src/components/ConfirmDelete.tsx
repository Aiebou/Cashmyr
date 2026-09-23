import { useState, type ReactNode } from "react";
import { Button } from "./controls";
import s from "./ConfirmDelete.module.css";
import { TrashIcon } from "./icons";

/** Suppression définitive en deux temps. `detail` précise ce qui arrive aux éléments liés. */
export function ConfirmDelete({ label, detail, onConfirm }: { label: string; detail?: ReactNode; onConfirm(): void }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button variant="danger" size="small" onClick={() => setArmed(true)}>
        <TrashIcon size={16} />
        {label}
      </Button>
    );
  }
  return (
    <div className={s.confirm} role="group" aria-label="Confirmer la suppression">
      <span>Supprimer définitivement ? C'est irréversible.{detail ? <> {detail}</> : null}</span>
      <Button variant="danger" size="small" onClick={onConfirm}>
        Supprimer
      </Button>
      <Button variant="ghost" size="small" onClick={() => setArmed(false)}>
        Annuler
      </Button>
    </div>
  );
}
