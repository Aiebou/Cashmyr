import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CheckIcon } from "./icons";
import s from "./Menu.module.css";

export type MenuItem = {
  id: string;
  label: string;
  /** Complément discret, juste après le libellé (« aujourd'hui »). */
  detail?: string;
  hint?: string;
  /** Entrée d'un choix exclusif : cochée ou non (menuitemradio). */
  checked?: boolean;
  onSelect(): void;
};

type MenuProps = {
  /** Contenu du bouton d'ouverture. */
  trigger: ReactNode;
  triggerLabel: string;
  triggerClassName?: string;
  /** Groupes d'entrées, séparés par un filet. */
  groups: MenuItem[][];
  /** Bord du bouton sur lequel le menu s'aligne ; à droite par défaut. */
  align?: "start" | "end";
};

/**
 * Menu déroulant accessible : aria-haspopup, aria-expanded, role="menu".
 * Se ferme au clic à l'extérieur, à la touche Échap et après le choix d'une entrée.
 */
export function Menu({ trigger, triggerLabel, triggerClassName, groups, align = "end" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const focusItem = (index: number) => {
    const nodes = root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!nodes || nodes.length === 0) return;
    nodes[(index + nodes.length) % nodes.length]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    focusItem(0);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const nodes = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "ArrowDown":
        e.preventDefault();
        focusItem(current + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem(current - 1);
        break;
      case "Home":
        e.preventDefault();
        focusItem(0);
        break;
      case "End":
        e.preventDefault();
        focusItem(nodes.length - 1);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  return (
    <div className={s.root} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div className={align === "start" ? `${s.menu} ${s.menuStart}` : s.menu} role="menu" id={menuId} aria-label={triggerLabel}>
          {groups.map((group, g) => (
            <Fragment key={g}>
              {g > 0 && <div className={s.separator} role="separator" />}
              {group.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                  aria-checked={item.checked}
                  tabIndex={-1}
                  className={s.item}
                  onClick={() => {
                    close(false);
                    item.onSelect();
                  }}
                >
                  <span>
                    {item.label}
                    {item.detail && (
                      <>
                        {" "}
                        <span className={s.detail}>{item.detail}</span>
                      </>
                    )}
                  </span>
                  {item.hint && <span className={s.hint}>{item.hint}</span>}
                  {item.checked && <span className={s.check} aria-hidden="true">
                      <CheckIcon size={16} />
                    </span>}
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
