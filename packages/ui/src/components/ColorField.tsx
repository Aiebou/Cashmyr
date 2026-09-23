import { useEffect, useRef, useState } from "react";
import s from "./ColorField.module.css";
import { IconButton } from "./controls";
import { RestoreIcon } from "./icons";

/** Valeur hexadécimale d'une couleur CSS, variable du thème comprise ; noir si le navigateur ne sait pas la résoudre. */
export function resolveColor(css: string): string {
  if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
  if (typeof document === "undefined") return "#000000";
  const probe = document.createElement("span");
  probe.style.color = css;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return "#000000";
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

type Props = {
  /** Ce que la couleur désigne, pour les libellés accessibles : « Salaire », « Besoins ». */
  label: string;
  /** Couleur en vigueur, telle que l'accesseur la renvoie (hexadécimal ou variable du thème). */
  value: string;
  custom: boolean;
  onPick(hex: string): void;
  onReset(): void;
};

/**
 * Sélecteur de couleur (section 5). Le choix s'enregistre quand le sélecteur se ferme,
 * pas à chaque mouvement. Une couleur choisie reste la même en clair et en sombre ;
 * le bouton de retour rend la couleur du thème.
 */
export function ColorField({ label, value, custom, onPick, onReset }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(() => resolveColor(value));
  useEffect(() => setShown(resolveColor(value)), [value]);

  // L'événement natif « change » ne part qu'à la fermeture du sélecteur ; React n'expose que « input ».
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const commit = () => pick.current(el.value.toLowerCase());
    el.addEventListener("change", commit);
    return () => el.removeEventListener("change", commit);
  }, []);

  return (
    <span className={s.field}>
      <input
        ref={input}
        type="color"
        className={s.swatch}
        aria-label={`Couleur de ${label}`}
        title={`Couleur de ${label}`}
        value={shown}
        onChange={(e) => setShown(e.target.value)}
      />
      {custom && (
        <IconButton label={`Rendre à ${label} sa couleur d'origine`} onClick={onReset}>
          <RestoreIcon size={16} />
        </IconButton>
      )}
    </span>
  );
}
