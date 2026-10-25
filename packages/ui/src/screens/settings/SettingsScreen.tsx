import { useEffect, useRef, useState, type ReactNode } from "react";
import { Segmented } from "../../components/controls";
import { ArrowUpIcon } from "../../components/icons";
import { Card, ScreenTitle, Stack } from "../../components/layout";
import { useActions, useApp } from "../../store/context";
import { AccountsSection } from "./AccountsSection";
import { AppSection } from "./AppSection";
import { BudgetSection } from "./BudgetSection";
import { CategoriesSection } from "./CategoriesSection";
import { DataSection } from "./DataSection";
import { ProfilesSection } from "./ProfilesSection";
import { RecurrencesSection } from "./RecurrencesSection";
import s from "./Settings.module.css";
import { SyncSection } from "./SyncSection";
import { TagsSection } from "./TagsSection";

function Appearance() {
  const theme = useApp((st) => st.data.preferences.theme);
  const { setPreference } = useActions();
  return (
    <Card title="Thème" subtitle="« Système » suit le réglage clair ou sombre de l'appareil.">
      <Segmented
        label="Thème"
        value={theme}
        options={[
          { value: "system", label: "Système" },
          { value: "light", label: "Clair" },
          { value: "dark", label: "Sombre" },
        ]}
        onChange={(t) => setPreference("theme", t)}
      />
    </Card>
  );
}

const SECTIONS: { id: string; title: string; content: ReactNode }[] = [
  { id: "budget", title: "Budget", content: <BudgetSection /> },
  { id: "comptes", title: "Comptes", content: <AccountsSection /> },
  { id: "recurrences", title: "Récurrences", content: <RecurrencesSection /> },
  { id: "categories", title: "Catégories", content: <CategoriesSection /> },
  { id: "tags", title: "Tags", content: <TagsSection /> },
  { id: "profils", title: "Profils", content: <ProfilesSection /> },
  { id: "synchronisation", title: "Synchronisation", content: <SyncSection /> },
  { id: "sauvegardes", title: "Sauvegardes", content: <DataSection /> },
  { id: "apparence", title: "Apparence", content: <Appearance /> },
  { id: "application", title: "Application", content: <AppSection /> },
];

/** Le sommaire des Paramètres, repris par le menu latéral du grand écran. */
export const SETTINGS_TOC: readonly { id: string; title: string }[] = SECTIONS.map(({ id, title }) => ({ id, title }));

/**
 * « Haut de page », sur téléphone seulement (la feuille de style le cache au-delà) : il apparaît une fois
 * qu'on a défilé d'un écran, ramène en haut et rend le focus au sommaire.
 */
function BackToTop({ toc }: { toc: React.RefObject<HTMLElement | null> }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > window.innerHeight);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  if (!visible) return null;
  return (
    <button
      type="button"
      className={s.top}
      aria-label="Haut de page"
      title="Haut de page"
      onClick={() => {
        // Retour immédiat : un défilement animé s'arrête à mi-chemin quand le focus change.
        window.scrollTo({ top: 0 });
        toc.current?.querySelector("a")?.focus({ preventScroll: true });
      }}
    >
      <ArrowUpIcon size={20} />
    </button>
  );
}

export function SettingsScreen() {
  const toc = useRef<HTMLElement>(null);
  return (
    <Stack gap={22}>
      <ScreenTitle title="Paramètres" />
      <BackToTop toc={toc} />
      <nav ref={toc} aria-label="Sections des paramètres" data-tour="settings-toc">
        <ul className={s.toc}>
          {SECTIONS.map((sec) => (
            <li key={sec.id}>
              <a href={`#reglages-${sec.id}`}>{sec.title}</a>
            </li>
          ))}
        </ul>
      </nav>
      {SECTIONS.map((sec) => (
        // Les cartes portent les titres ; le sommaire mène à chaque section.
        <section key={sec.id} id={`reglages-${sec.id}`} className={s.section} aria-label={sec.title}>
          {sec.content}
        </section>
      ))}
    </Stack>
  );
}
