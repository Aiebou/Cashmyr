import type { ReactNode } from "react";
import { Segmented } from "../../components/controls";
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
  { id: "categories", title: "Catégories et couleurs", content: <CategoriesSection /> },
  { id: "tags", title: "Tags", content: <TagsSection /> },
  { id: "profils", title: "Profils", content: <ProfilesSection /> },
  { id: "synchronisation", title: "Synchronisation", content: <SyncSection /> },
  { id: "sauvegardes", title: "Sauvegardes", content: <DataSection /> },
  { id: "apparence", title: "Apparence", content: <Appearance /> },
  { id: "application", title: "Application", content: <AppSection /> },
];

export function SettingsScreen() {
  return (
    <Stack gap={22}>
      <ScreenTitle title="Paramètres" />
      <nav aria-label="Sections des paramètres" data-tour="settings-toc">
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
