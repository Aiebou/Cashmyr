import { centsToInput, parseAmount, type Cents } from "@cashmyr/core";
import {
  forwardRef,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import s from "./controls.module.css";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "default" | "small";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "default", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        s.button,
        variant === "primary" && s.primary,
        variant === "ghost" && s.ghost,
        variant === "danger" && s.danger,
        size === "small" && s.small,
        className,
      )}
      {...rest}
    />
  );
});

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string };

/** Bouton d'icône : libellé accessible obligatoire, zone tactile de 44 px. */
export function IconButton({ label, className, children, ...rest }: IconButtonProps) {
  return (
    <button type="button" className={cx(s.iconButton, className)} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

type FieldProps = {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  hidden?: boolean;
  className?: string;
  children: ReactNode;
};

/** Conteneur de champ : libellé, contrôle, aide, erreur. */
export function Field({ label, htmlFor, hint, error, hidden, className, children }: FieldProps) {
  return (
    <div className={cx(s.field, className)} hidden={hidden}>
      <label className={s.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <p className={s.hint}>{hint}</p>}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(s.input, className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(s.select, className)} {...rest}>
      {children}
    </select>
  );
}

type AmountInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue"> & {
  initial?: Cents | null;
  onAmount(cents: Cents | null, text: string): void;
  allowNegative?: boolean;
  big?: boolean;
};

/** Saisie d'un montant : clavier numérique, virgule acceptée, jamais de flottant renvoyé. */
export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { initial = null, onAmount, allowNegative, big, className, ...rest },
  ref,
) {
  const [text, setText] = useState(initial === null ? "" : centsToInput(initial));
  const input = (
    <input
      ref={ref}
      className={cx(s.input, big ? s.amount : s.inlineAmount, className)}
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onAmount(parseAmount(e.target.value, { allowNegative }), e.target.value);
      }}
      {...rest}
    />
  );
  return big ? <div className={s.amountWrap}>{input}</div> : input;
});

type InlineAmountProps = {
  value: Cents;
  label: string;
  allowNegative?: boolean;
  onCommit(cents: Cents): void;
};

/** Montant modifiable sur place : enregistré à la sortie du champ ou avec Entrée. */
export function InlineAmount({ value, label, allowNegative, onCommit }: InlineAmountProps) {
  const [text, setText] = useState(centsToInput(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(centsToInput(value)), [value]);
  const commit = () => {
    const cents = parseAmount(text, { allowNegative });
    if (cents === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (cents !== value) onCommit(cents);
  };
  return (
    <input
      className={cx(s.input, s.inlineAmount)}
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

type InlineTextProps = { value: string; label: string; onCommit(text: string): void; required?: boolean };

/** Texte modifiable sur place, enregistré à la sortie du champ. */
export function InlineText({ value, label, onCommit, required }: InlineTextProps) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const next = text.trim();
    if (required && next === "") {
      setText(value);
      return;
    }
    if (next !== value) onCommit(next);
  };
  return (
    <input
      className={s.input}
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

type SegmentedProps<T extends string> = {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
};

/** Choix exclusif en segments (groupe de boutons radio). */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className={s.segmented} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={s.segment}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.value === value);
            const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (step === 0) return;
            e.preventDefault();
            const next = options[(i + step + options.length) % options.length]!;
            onChange(next.value);
            (e.currentTarget.parentElement?.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
          }}
          data-value={o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode };

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  const id = useId();
  return (
    <label className={cx(s.check, className)} htmlFor={rest.id ?? id}>
      <input type="checkbox" id={rest.id ?? id} {...rest} />
      <span>{label}</span>
    </label>
  );
}

/**
 * Entrée dans un champ de saisie valide le formulaire, même si le bouton
 * d'enregistrement est placé hors du <form> (pied de fenêtre modale).
 */
export function submitOnEnter(e: React.KeyboardEvent<HTMLFormElement>): void {
  const target = e.target as HTMLElement;
  if (e.key !== "Enter" || e.nativeEvent.isComposing || target.tagName !== "INPUT") return;
  e.preventDefault();
  e.currentTarget.requestSubmit();
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className={s.row}>{children}</div>;
}

export { cx };
