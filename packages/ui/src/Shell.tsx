import { addMonths, monthOf, yearOf } from "@cashmyr/core";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Button, IconButton } from "./components/controls";
import { ChevronLeft, ChevronRight, PlusIcon, SyncIcon } from "./components/icons";
import { Toasts } from "./components/layout";
import { Menu } from "./components/Menu";
import { Modal } from "./components/Modal";
import { monthTitle, stamp } from "./lib/format";
import { initialOf } from "./lib/profiles";
import { CreateAccountModal, CreateDebtModal, CreateGoalModal } from "./screens/CreateModals";
import { DashboardScreen } from "./screens/DashboardScreen";
import { AccountsScreen } from "./screens/AccountsScreen";
import { DebtsScreen } from "./screens/DebtsScreen";
import { GoalsScreen } from "./screens/GoalsScreen";
import { MonthScreen } from "./screens/MonthScreen";
import { OperationsScreen } from "./screens/OperationsScreen";
import { OperationModal } from "./screens/OperationModal";
import { RecurrenceModal } from "./screens/RecurrenceModal";
import { DeleteCategoryModal } from "./screens/settings/DeleteCategoryModal";
import { CreateProfileModal, DeleteProfileModal } from "./screens/settings/ProfileModals";
import { SettingsScreen } from "./screens/settings/SettingsScreen";
import { Welcome } from "./screens/Welcome";
import { TABS, type Tab } from "./store/app-store";
import { useActions, useApp } from "./store/context";
import s from "./Shell.module.css";

function PeriodPicker() {
  const tab = useApp((st) => st.tab);
  const year = useApp((st) => st.year);
  const month = useApp((st) => st.month);
  const today = useApp((st) => st.today);
  const { setYear, setMonth } = useActions();
  const byMonth = TABS.find((t) => t.id === tab)?.period === "month";
  const label = byMonth ? monthTitle(month) : String(year);
  const isCurrent = byMonth ? month === monthOf(today) : year === yearOf(today);
  const shift = (d: number) => (byMonth ? setMonth(addMonths(month, d)) : setYear(year + d));
  return (
    <div className={s.period} aria-label={byMonth ? "Mois affiché" : "Année affichée"} role="group">
      <IconButton label={byMonth ? "Mois précédent" : "Année précédente"} onClick={() => shift(-1)}>
        <ChevronLeft />
      </IconButton>
      <span className={s.periodLabel} aria-live="polite">
        {label}
      </span>
      <IconButton label={byMonth ? "Mois suivant" : "Année suivante"} onClick={() => shift(1)}>
        <ChevronRight />
      </IconButton>
      {!isCurrent && (
        <button
          type="button"
          className={s.todayLink}
          onClick={() => (byMonth ? setMonth(monthOf(today)) : setYear(yearOf(today)))}
        >
          {byMonth ? "Ce mois-ci" : "Cette année"}
        </button>
      )}
    </div>
  );
}

/** État de la synchronisation, en clair ; un clic mène aux paramètres. */
function SyncBadge() {
  const sync = useApp((st) => st.sync);
  const { setTab } = useActions();
  let text: string;
  let tone: string | undefined = "";
  if (sync.status === "error") {
    text = "Synchronisation en erreur";
    tone = s.badgeError;
  } else if (sync.status === "syncing") text = "Synchronisation…";
  else if (sync.status === "needs-permission") {
    text = "Accès au fichier à réautoriser";
    tone = s.badgeWarn;
  } else if (sync.status === "missing") {
    text = "Fichier de synchronisation introuvable";
    tone = s.badgeWarn;
  } else if (sync.status === "unconfigured") text = "Données sur cet appareil seulement";
  else if (sync.offerReady) {
    text = "Fichier fusionné à enregistrer";
    tone = s.badgeWarn;
  } else if (sync.pending > 0) text = `${sync.pending} modification${sync.pending > 1 ? "s" : ""} à synchroniser`;
  else if (sync.lastMergeAt) text = `Synchronisé · ${stamp(sync.lastMergeAt)}`;
  else text = "Synchronisation manuelle";
  return (
    <button type="button" className={`${s.badge} ${tone ?? ""}`} onClick={() => setTab("settings")} title={text} aria-label={`${text}. Voir la synchronisation`}>
      <SyncIcon size={16} />
      <span className={s.badgeText}>{text}</span>
    </button>
  );
}

/** Profil ouvert, toujours affiché : on passe d'un profil à l'autre ou on en crée un d'ici (décision 63). */
function ProfileMenu() {
  const { list, current } = useApp((st) => st.profiles);
  const { profiles, setTab, openModal } = useActions();
  return (
    <Menu
      triggerLabel={`Profil « ${current.name} ». Changer de profil`}
      triggerClassName={s.profile}
      trigger={
        <>
          <span className={s.profileInitial} aria-hidden="true">
            {initialOf(current.name)}
          </span>
          <span className={s.profileName}>{current.name}</span>
        </>
      }
      groups={[
        [
          ...list.map((p) => ({
            id: p.id,
            label: p.name,
            checked: p.id === current.id,
            onSelect: () => void (p.id !== current.id && profiles.open(p.id)),
          })),
          { id: "create", label: "Nouveau profil…", onSelect: () => openModal({ kind: "create-profile" }) },
        ],
        [
          {
            id: "manage",
            label: "Gérer les profils",
            onSelect: () => {
              setTab("settings");
              requestAnimationFrame(() => document.getElementById("reglages-profils")?.scrollIntoView());
            },
          },
        ],
      ]}
    />
  );
}

function AddMenu() {
  const { openModal } = useActions();
  return (
    <Menu
      triggerLabel="Ajouter"
      triggerClassName={s.add}
      trigger={
        <>
          <PlusIcon size={18} />
          <span>Ajouter</span>
        </>
      }
      groups={[
        [
          { id: "out", label: "Dépense", onSelect: () => openModal({ kind: "operation", type: "out" }) },
          { id: "in", label: "Revenu", onSelect: () => openModal({ kind: "operation", type: "in" }) },
          { id: "tx", label: "Transfert", onSelect: () => openModal({ kind: "operation", type: "tx" }) },
        ],
        [
          { id: "goal", label: "Objectif", onSelect: () => openModal({ kind: "create-goal" }) },
          { id: "debt", label: "Dette", onSelect: () => openModal({ kind: "create-debt" }) },
          { id: "account", label: "Compte", onSelect: () => openModal({ kind: "create-account" }) },
        ],
      ]}
    />
  );
}

function Modals() {
  const modal = useApp((st) => st.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case "operation":
      return <OperationModal key={modal.editId ?? modal.type} type={modal.type} {...(modal.editId ? { editId: modal.editId } : {})} />;
    case "create-goal":
      return <CreateGoalModal />;
    case "create-debt":
      return <CreateDebtModal />;
    case "create-account":
      return <CreateAccountModal stay={modal.stay ?? false} />;
    case "recurrence":
      return <RecurrenceModal key={modal.editId ?? "new"} {...(modal.editId ? { editId: modal.editId } : {})} />;
    case "delete-category":
      return <DeleteCategoryModal categoryId={modal.categoryId} />;
    case "create-profile":
      return <CreateProfileModal />;
    case "delete-profile":
      return <DeleteProfileModal profileId={modal.profileId} check={modal.check} />;
  }
}

/** Nouvelle version prête : l'application propose, l'utilisateur choisit le moment. */
function UpdateBanner() {
  const update = useApp((st) => st.update);
  const { updates } = useActions();
  if (!update || update.dismissed) return null;
  const { version, kind } = update.available;
  const busy = kind === "reload" ? "Rechargement…" : "Installation…";
  const label = kind === "reload" ? "Recharger" : "Installer et redémarrer";
  return (
    <div className={s.update} role="status">
      <p className={s.updateText}>{version ? `Cashmyr ${version} est disponible.` : "Nouvelle version disponible."}</p>
      <div className={s.updateActions}>
        <Button size="small" variant="ghost" onClick={updates.dismiss} disabled={update.applying}>
          Plus tard
        </Button>
        <Button size="small" variant="primary" onClick={() => void updates.apply()} disabled={update.applying}>
          {update.applying ? busy : label}
        </Button>
      </div>
    </div>
  );
}

/** Question en attente de réponse (synchronisation, restauration, suppression). */
function ConfirmDialog() {
  const request = useApp((st) => st.confirm);
  const { answer } = useActions();
  if (!request) return null;
  return (
    <Modal
      title={request.title}
      width="narrow"
      onClose={() => answer(false)}
      footer={
        <>
          {request.cancelLabel !== null && (
            <Button variant="ghost" onClick={() => answer(false)}>
              {request.cancelLabel ?? "Annuler"}
            </Button>
          )}
          <Button variant={request.danger ? "danger" : "primary"} onClick={() => answer(true)} data-autofocus>
            {request.confirmLabel}
          </Button>
        </>
      }
    >
      <p className={s.confirmText}>{request.message}</p>
    </Modal>
  );
}

function Screen({ tab }: { tab: Tab }) {
  switch (tab) {
    case "dashboard":
      return <DashboardScreen />;
    case "month":
      return <MonthScreen />;
    case "goals":
      return <GoalsScreen />;
    case "debts":
      return <DebtsScreen />;
    case "accounts":
      return <AccountsScreen />;
    case "operations":
      return <OperationsScreen />;
    case "settings":
      return <SettingsScreen />;
  }
}

export function Shell() {
  const tab = useApp((st) => st.tab);
  const fresh = useApp((st) => st.fresh);
  const platform = useApp((st) => st.platform);
  const { setTab, openModal, onFocus } = useActions();

  // Raccourci global : ⌘/Ctrl+N sur le bureau, N dans le navigateur (hors champ de saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]");
      const desktop = platform.target === "desktop" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n";
      const web = platform.target === "web" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "n";
      if ((desktop || web) && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        openModal({ kind: "operation", type: "out" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [platform.target, openModal]);

  // Hauteur de l'en-tête collant, pour ce qui se fige juste dessous (graphiques de l'écran Mois).
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = header.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty("--header-h", `${Math.round(el.getBoundingClientRect().height)}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--header-h");
    };
  }, []);

  // Retour au premier plan : jour courant, occurrences dues, relecture du fichier.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void onFocus();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onFocus]);

  return (
    <div className={s.app}>
      <header className={s.header} ref={header}>
        <div className={s.brandRow}>
          <div className={s.headerLeft}>
            <h1 className={s.brand}>Cashmyr</h1>
            <SyncBadge />
          </div>
          <div className={s.headerRight}>
            <AddMenu />
            <ProfileMenu />
          </div>
        </div>
        {!fresh && (
          <div className={s.navRow}>
            <nav className={s.tabs} aria-label="Sections">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={s.tab}
                  aria-current={t.id === tab ? "page" : undefined}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            {TABS.find((t) => t.id === tab)?.period && <PeriodPicker />}
          </div>
        )}
      </header>
      <UpdateBanner />
      <main className={s.main}>{fresh ? <Welcome /> : <Screen tab={tab} />}</main>
      {!fresh && (
        <button type="button" className={s.fab} onClick={() => openModal({ kind: "operation", type: "out" })} aria-label="Nouvelle dépense">
          <PlusIcon size={24} />
        </button>
      )}
      <Modals />
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
