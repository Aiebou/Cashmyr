import "./theme/global.css";
import { useEffect } from "react";
import { Shell } from "./Shell";
import type { AppStore } from "./store/app-store";
import { StoreProvider, useApp } from "./store/context";

/** Applique le thème choisi (clair, sombre, ou celui du système). */
function ThemeSync() {
  const theme = useApp((s) => s.data.preferences.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
  return null;
}

export function App({ store }: { store: AppStore }) {
  return (
    <StoreProvider store={store}>
      <ThemeSync />
      <Shell />
    </StoreProvider>
  );
}
