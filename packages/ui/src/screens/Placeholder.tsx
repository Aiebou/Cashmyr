import { Empty } from "../components/layout";
import { TABS, type Tab } from "../store/app-store";

/** Écran pas encore livré : il arrive dans la suite de l'étape 4. */
export function Placeholder({ tab }: { tab: Tab }) {
  const label = TABS.find((t) => t.id === tab)?.label ?? "";
  return <Empty message={`L'écran « ${label} » arrive dans la prochaine livraison de l'interface.`} />;
}
