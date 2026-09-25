import { useState, type DragEvent, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, GripIcon } from "./icons";
import s from "./Reorderable.module.css";

type BlockProps = {
  id: string;
  title: string;
  index: number;
  count: number;
  onMove(id: string, delta: -1 | 1): void;
  onDropOn(dragged: string, target: string, after: boolean): void;
  action?: ReactNode;
  children: ReactNode;
};

const MIME = "application/x-cashmyr-block";

/**
 * Glisser-déposer d'un élément dans une liste : l'élément ne devient déplaçable que tant que la
 * poignée est tenue, et montre où il se posera (avant ou après la cible). `mime` sépare les listes.
 */
export function useReorderDrag(id: string, mime: string, onDropOn: (dragged: string, target: string, after: boolean) => void) {
  const [draggable, setDraggable] = useState(false);
  const [over, setOver] = useState<"before" | "after" | null>(null);
  const container = {
    draggable,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.setData(mime, id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => setDraggable(false),
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes(mime)) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      setOver(e.clientY > rect.top + rect.height / 2 ? "after" : "before");
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: DragEvent<HTMLElement>) => {
      const dragged = e.dataTransfer.getData(mime);
      const after = over === "after";
      setOver(null);
      if (dragged && dragged !== id) {
        e.preventDefault();
        onDropOn(dragged, id, after);
      }
    },
  };
  const grip = { onPointerDown: () => setDraggable(true), onPointerUp: () => setDraggable(false) };
  return { container, grip, overClass: over ? s[over] : "" };
}

type MoveBarProps = {
  /** Nom de l'élément, dans les libellés accessibles. */
  name: string;
  /** « le bloc », « le compte »… */
  what: string;
  index: number;
  count: number;
  grip: { onPointerDown(): void; onPointerUp(): void };
  onMove(delta: -1 | 1): void;
};

/** Poignée de glisser-déposer et deux flèches, indispensables au doigt et au clavier. */
export function MoveBar({ name, what, index, count, grip, onMove }: MoveBarProps) {
  return (
    <div className={s.handleBar} role="group" aria-label={`Déplacer ${what} « ${name} »`}>
      <span className={s.grip} aria-hidden="true" title="Glisser pour déplacer" {...grip}>
        <GripIcon size={16} />
      </span>
      <button type="button" className={s.arrow} aria-label={`Monter « ${name} »`} title="Monter" disabled={index === 0} onClick={() => onMove(-1)}>
        <ArrowUpIcon size={16} />
      </button>
      <button
        type="button"
        className={s.arrow}
        aria-label={`Descendre « ${name} »`}
        title="Descendre"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDownIcon size={16} />
      </button>
    </div>
  );
}

/**
 * Bloc du tableau de bord déplaçable. En haut à droite, une barre discrète,
 * plus marquée au survol : une poignée de glisser-déposer, et deux flèches.
 */
export function ReorderableBlock({ id, title, index, count, onMove, onDropOn, action, children }: BlockProps) {
  const { container, grip, overClass } = useReorderDrag(id, MIME, onDropOn);
  return (
    <section className={`${s.block} ${overClass}`} aria-labelledby={`block-${id}`} {...container}>
      <header className={s.header}>
        <h3 id={`block-${id}`} className={s.title}>
          {title}
        </h3>
        <div className={s.tools}>
          {action}
          <MoveBar name={title} what="le bloc" index={index} count={count} grip={grip} onMove={(delta) => onMove(id, delta)} />
        </div>
      </header>
      {children}
    </section>
  );
}

/**
 * Déplace une clé d'un cran parmi les clés visibles, sans toucher à la place
 * des blocs masqués dans l'ordre enregistré.
 */
export function moveAmongVisible<T>(order: readonly T[], visible: readonly T[], key: T, delta: -1 | 1): T[] {
  const v = visible.indexOf(key);
  const neighbour = visible[v + delta];
  if (v < 0 || neighbour === undefined) return [...order];
  const next = [...order];
  const a = next.indexOf(key);
  const b = next.indexOf(neighbour);
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}

/** Place `dragged` juste avant (ou après) `target`. */
export function dropBefore<T>(order: readonly T[], dragged: T, target: T, after: boolean): T[] {
  const next = order.filter((k) => k !== dragged);
  const at = next.indexOf(target);
  next.splice(after ? at + 1 : at, 0, dragged);
  return next;
}
