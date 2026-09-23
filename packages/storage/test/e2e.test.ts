import "fake-indexeddb/auto";
import {
  COLLECTION_NAMES,
  parseSyncDocument,
  recordDebtPayment,
  setPreference,
  tombstone,
  touch,
  type Dataset,
  type Debt,
} from "@cashmyr/core";
import { describe, expect, it, vi } from "vitest";
import { Repository, SyncEngine, type LocalStore, type SyncFile } from "../src";
import { createTauriSync, TauriFileLocalStore } from "../src/tauri";
import { createAssistedSync, createFsAccessSync, IndexedDbLocalStore } from "../src/web";
import {
  Clock,
  CloudFile,
  FakeBrowser,
  FakeFileHandle,
  fakeTauriInvoke,
  ManualTimers,
  MemoryFs,
  MemoryHandleStore,
  MemoryKv,
  MIN,
  op,
  seed,
  TODAY,
} from "./fakes";

let dbCount = 0;

/** Un appareil complet : stockage local réel (IndexedDB ou fichier), adaptateur, moteur. */
async function makeDevice(kind: "tauri" | "chrome" | "phone", cloud: CloudFile, clock: Clock) {
  const local: LocalStore =
    kind === "tauri"
      ? new TauriFileLocalStore(new MemoryFs(), new MemoryKv())
      : await IndexedDbLocalStore.open(`e2e-${kind}-${++dbCount}`);
  const browser = new FakeBrowser();
  const handle = new FakeFileHandle(cloud);
  const sync: SyncFile =
    kind === "tauri"
      ? createTauriSync(fakeTauriInvoke(cloud))
      : kind === "chrome"
        ? createFsAccessSync(
            { showOpenFilePicker: async () => [handle], showSaveFilePicker: async () => handle },
            new MemoryHandleStore(),
          )
        : createAssistedSync(browser.env());
  const timers = new ManualTimers();
  const hooks = { confirmFirstJoin: vi.fn(async () => true), confirmDropPurged: vi.fn(async () => true) };
  const open = () => Repository.open({ local, deviceLabel: kind, now: clock.now, today: () => TODAY });
  const repo = await open();
  const engine = new SyncEngine({ repository: repo, sync, hooks, now: clock.now, timers });
  await engine.start();

  return {
    repo,
    engine,
    local,
    open,
    hooks,
    /** Le téléphone : désigner le fichier, fusionner, enregistrer le résultat à la place de l'original. */
    async assistedSync() {
      browser.nextPick = { name: cloud.name, content: cloud.content! };
      const outcome = await engine.syncNow();
      expect(outcome).toMatchObject({ kind: "merged", offerReady: true });
      await engine.offerMerged();
      await browser.saveLastOfferOver(cloud);
    },
    /** Les 2 s d'attente s'écoulent. */
    async debounceElapses() {
      timers.fire();
      await engine.whenIdle();
    },
  };
}

/** Jeu comparable : lignes triées par identifiant, préférences. */
const normalize = (d: { collections: Dataset["collections"]; preferences: Dataset["preferences"] }) =>
  JSON.stringify({
    collections: Object.fromEntries(
      COLLECTION_NAMES.map((n) => [n, [...d.collections[n]].sort((a, b) => a.id.localeCompare(b.id))]),
    ),
    preferences: d.preferences,
  });

const find = (d: Dataset, id: string) => d.collections.operations.find((o) => o.id === id);

describe("de bout en bout : trois appareils divergents se retrouvent", () => {
  it("bureau Tauri, Chrome de bureau et téléphone en mode assisté convergent vers le même jeu", async () => {
    const cloud = new CloudFile();
    const clock = new Clock();
    const laptop = await makeDevice("tauri", cloud, clock);
    const chrome = await makeDevice("chrome", cloud, clock);
    const phone = await makeDevice("phone", cloud, clock);

    // ── Mise en place : le bureau crée le fichier, les deux autres le rejoignent.
    const x = op("op-x", "2026-09-02", 4_500, "cat-courses", "acc-courant", 1);
    const y = op("op-y", "2026-09-03", 2_000, "cat-resto", "acc-courant", 1);
    const z = op("op-z", "2026-09-04", 9_900, "cat-courses", "acc-courant", 1);
    await laptop.repo.apply({ ...seed, operations: [x, y, z] });
    expect(await laptop.engine.connect("create")).toMatchObject({ kind: "merged", wrote: true });
    expect(await chrome.engine.connect("open")).toMatchObject({ kind: "merged" });
    await phone.assistedSync();
    for (const d of [chrome, phone]) expect(normalize(d.repo.data)).toBe(normalize(laptop.repo.data));

    // ── Hors ligne, chacun de son côté.
    clock.advance(MIN);
    await laptop.repo.apply({
      operations: [
        touch(x, { amount: 4_750 }, clock.t),
        op("op-laptop", "2026-09-10", 1_200, "cat-resto", "acc-courant", clock.t),
      ],
    });
    clock.advance(MIN);
    await chrome.repo.apply(
      { operations: [tombstone(y, clock.t), touch(z, { note: "marché (Chrome)" }, clock.t)] },
      setPreference(chrome.repo.data.preferences, "theme", "dark", clock.t),
    );
    clock.advance(MIN);
    const loan: Debt = {
      id: "debt-auto",
      updatedAt: clock.t,
      deletedAt: null,
      name: "Prêt auto",
      creditor: "Banque",
      direction: "owe",
      principal: 0,
      paidManual: 0,
      mode: "installments",
      installmentAmount: 20_000,
      installmentCount: 5,
      startDate: "2026-10-10",
      dayOfMonth: 10,
      categoryId: "cat-credit",
      accountId: "acc-courant",
      recurrenceId: null,
      hidden: false,
      pinned: false,
      settled: false,
      settledAt: null,
      archived: false,
      position: 0,
      color: 0,
    };
    await phone.repo.apply(
      { debts: [loan] },
      setPreference(phone.repo.data.preferences, "splits", { besoin: 6000, envie: 2000, invest: 2000 }, clock.t),
    );
    await phone.repo.apply(
      recordDebtPayment(phone.repo.data, loan.id, { amount: 35_000, date: TODAY, inBudget: true }, clock.t, "op-versement"),
    );
    clock.advance(MIN);
    // Le bureau modifie aussi Z, plus tard que Chrome : sa version l'emporte en entier.
    await laptop.repo.apply({ operations: [touch(z, { amount: 10_500 }, clock.t)] });

    // ── Les appareils se retrouvent, dans le désordre.
    await chrome.debounceElapses();
    await laptop.engine.onFocus();
    await phone.assistedSync();
    await laptop.engine.onFocus();
    await chrome.engine.onFocus();
    // Le téléphone relit le fichier : ses propres modifications y sont, donc confirmées.
    await phone.assistedSync();

    // ── Un seul et même jeu partout, fichier compris.
    const file = parseSyncDocument(cloud.content!);
    const reference = normalize(file);
    for (const d of [laptop, chrome, phone]) expect(normalize(d.repo.data)).toBe(reference);

    const data = laptop.repo.data;
    expect(find(data, "op-x")?.amount).toBe(4_750);
    expect(find(data, "op-y")?.deletedAt).not.toBeNull();
    expect(find(data, "op-z")).toMatchObject({ amount: 10_500, note: "" });
    expect(find(data, "op-laptop")).toBeDefined();
    expect(find(data, "op-versement")).toMatchObject({ debtId: "debt-auto", amount: 35_000, type: "out" });
    expect(data.collections.debts.map((d) => d.id)).toEqual(["debt-auto"]);
    expect(data.preferences.theme).toBe("dark");
    expect(data.preferences.splits).toEqual({ besoin: 6000, envie: 2000, invest: 2000 });
    expect(Object.values(file.devices).map((d) => d.label).sort()).toEqual(["chrome", "phone", "tauri"]);

    // ── Plus rien en attente, et chaque appareil relit son stockage local à l'identique.
    for (const d of [laptop, chrome, phone]) {
      expect(d.engine.state.pending).toBe(0);
      await d.repo.flush();
      const reopened = await d.open();
      expect(normalize(reopened.data)).toBe(reference);
      expect(reopened.device.dirty).toEqual({});
    }
  });

  it("le fichier en cours d'envoi par le cloud ne casse rien", async () => {
    const cloud = new CloudFile();
    const clock = new Clock();
    const laptop = await makeDevice("tauri", cloud, clock);
    const chrome = await makeDevice("chrome", cloud, clock);
    await laptop.repo.apply({ ...seed, operations: [op("op-1", "2026-09-01", 100, "cat-courses", "acc-courant", 1)] });
    await laptop.engine.connect("create");
    await chrome.engine.connect("open");

    clock.advance(MIN);
    await chrome.repo.apply({ operations: [op("op-2", "2026-09-02", 200, "cat-resto", "acc-courant", clock.t)] });
    const good = cloud.content!;
    // Le cloud n'a livré que la moitié du fichier au moment où Chrome veut écrire.
    cloud.content = good.slice(0, 200);
    await chrome.debounceElapses();
    expect(chrome.engine.state.status).toBe("error");
    expect(cloud.content).toBe(good.slice(0, 200));
    expect(chrome.engine.state.pending).toBe(1);

    // Le cloud termine sa livraison ; au retour au premier plan, tout repart.
    cloud.content = good;
    await chrome.engine.onFocus();
    await laptop.engine.onFocus();
    expect(normalize(laptop.repo.data)).toBe(normalize(chrome.repo.data));
    expect(find(laptop.repo.data, "op-2")).toBeDefined();
    expect(chrome.engine.state).toMatchObject({ status: "ready", pending: 0 });
  });
});
