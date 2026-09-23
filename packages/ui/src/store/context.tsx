import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import type { AppActions, AppState, AppStore } from "./app-store";

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

function useAppStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("StoreProvider manquant");
  return store;
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(useAppStore(), selector);
}

export const useActions = (): AppActions => useApp((s) => s.actions);
