import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button } from "../components/controls";
import { useActions, useApp } from "../store/context";
import { stepText, TOUR, type TourStep } from "./steps";
import s from "./Tour.module.css";

/** Marge autour de l'élément mis en lumière. */
const PAD = 6;
/** Écart entre l'élément et la bulle, et marge aux bords de l'écran. */
const GAP = 12;
const EDGE = 16;

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Où poser la bulle : sous l'élément, sinon au-dessus, sinon en bas de l'écran (téléphone compris). */
function placement(rect: DOMRect, bubble: { width: number; height: number }): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw > 640) {
    const left = Math.min(Math.max(rect.left, EDGE), vw - bubble.width - EDGE);
    if (vh - rect.bottom >= bubble.height + GAP + EDGE) return { top: rect.bottom + PAD + GAP, left };
    if (rect.top >= bubble.height + GAP + EDGE) return { top: rect.top - PAD - GAP - bubble.height, left };
  }
  // Téléphone, ou pas de place autour : en bas de l'écran, ou en haut si l'élément est en bas.
  const low = rect.top + rect.height / 2 > vh / 2;
  return low ? { top: EDGE, left: EDGE, right: EDGE } : { bottom: EDGE, left: EDGE, right: EDGE };
}

/**
 * Tutoriel (décisions 65 à 67) : à la première visite d'un onglet, pour un profil né avec la 0.4.0,
 * une bulle présente ses éléments un à un, mis en lumière. On regarde sans rien modifier : le reste
 * de l'écran est assombri et ne répond pas. « Passer » ne ferme que l'onglet en cours.
 */
export function Tour() {
  const tab = useApp((st) => st.tab);
  const fresh = useApp((st) => st.fresh);
  const busy = useApp((st) => st.modal !== null || st.confirm !== null);
  const seen = useApp((st) => st.device.tour?.seen);
  const shortcut = useApp((st) => st.platform.shortcutHint);
  const { tour } = useActions();
  const pending = seen !== undefined && !seen.includes(tab) && !fresh && !busy;

  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);

  // L'onglet vient d'être dessiné : on ne garde que les étapes dont l'élément est à l'écran.
  useEffect(() => {
    if (!pending) {
      setSteps(null);
      return;
    }
    const present = TOUR[tab].filter((step) => document.querySelector(step.target));
    if (present.length === 0) {
      void tour.done(tab);
      return;
    }
    setIndex(0);
    setSteps(present);
  }, [pending, tab, tour]);

  if (!steps) return null;
  const finish = () => {
    setSteps(null);
    void tour.done(tab);
  };
  return (
    <Bubble
      key={`${tab}-${index}`}
      step={steps[index]!}
      index={index}
      count={steps.length}
      text={stepText(steps[index]!, { shortcut })}
      onPrevious={() => setIndex((i) => Math.max(0, i - 1))}
      onNext={() => (index + 1 < steps.length ? setIndex(index + 1) : finish())}
      onSkip={finish}
    />
  );
}

type BubbleProps = {
  step: TourStep;
  index: number;
  count: number;
  text: string;
  onPrevious(): void;
  onNext(): void;
  onSkip(): void;
};

function Bubble({ step, index, count, text, onPrevious, onNext, onSkip }: BubbleProps) {
  const titleId = useId();
  const textId = useId();
  const bubble = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const last = index + 1 === count;

  // L'élément vient au centre de l'écran, et la lumière le suit (défilement, redimensionnement).
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(step.target);
    if (!el) return;
    el.scrollIntoView?.({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [step]);

  useLayoutEffect(() => {
    if (!rect || !bubble.current) return;
    setStyle(placement(rect, { width: bubble.current.offsetWidth, height: bubble.current.offsetHeight }));
  }, [rect]);

  useEffect(() => primary.current?.focus(), []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onSkip();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onNext();
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      onPrevious();
    } else if (e.key === "Tab" && bubble.current) {
      // Le focus reste dans la bulle : le reste de l'écran ne répond pas pendant le tutoriel.
      const items = [...bubble.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
      const first = items[0];
      const end = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        end?.focus();
      } else if (!e.shiftKey && document.activeElement === end) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  return createPortal(
    <div className={s.layer}>
      {rect && (
        <div
          className={s.spot}
          aria-hidden="true"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD }}
        />
      )}
      <div
        ref={bubble}
        className={s.bubble}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        onKeyDown={onKeyDown}
      >
        <p className={s.count}>
          {index + 1} / {count}
        </p>
        <h2 className={s.title} id={titleId}>
          {step.title}
        </h2>
        <p className={s.text} id={textId}>
          {text}
        </p>
        <div className={s.actions}>
          <Button variant="ghost" size="small" onClick={onSkip}>
            Passer
          </Button>
          <span className={s.spacer} />
          {index > 0 && (
            <Button size="small" onClick={onPrevious}>
              Précédent
            </Button>
          )}
          <Button ref={primary} variant="primary" size="small" onClick={onNext}>
            {last ? "Terminer" : "Suivant"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
