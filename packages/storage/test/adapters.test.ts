import { describe, expect, it } from "vitest";
import { createTauriFileIO, createTauriSync } from "../src/tauri";
import { createAssistedSync, createFsAccessSync, createWebFileIO, detectWebSyncMode, type FsPickers } from "../src/web";
import { CloudFile, FakeBrowser, FakeFileHandle, fakeTauriInvoke, MemoryHandleStore } from "./fakes";

const abort = () => Object.assign(new Error("annulé"), { name: "AbortError" });

function pickers(handle: FakeFileHandle | null): FsPickers {
  return {
    showOpenFilePicker: async () => {
      if (!handle) throw abort();
      return [handle];
    },
    showSaveFilePicker: async () => {
      if (!handle) throw abort();
      if (handle.cloud.content === null) handle.cloud.content = "";
      return handle;
    },
  };
}

describe("choix du mode dans le navigateur", () => {
  const chrome = { showOpenFilePicker() {}, showSaveFilePicker() {} };
  it("accès direct seulement sur un Chromium de bureau", () => {
    expect(detectWebSyncMode({ ...chrome, navigator: { userAgent: "Mozilla/5.0 (Macintosh) Chrome/140" } })).toBe("fs-access");
    expect(detectWebSyncMode({ navigator: { userAgent: "Mozilla/5.0 (Macintosh) Safari/605" } })).toBe("assisted");
    expect(detectWebSyncMode({ navigator: { userAgent: "Mozilla/5.0 Firefox/140" } })).toBe("assisted");
    expect(
      detectWebSyncMode({ ...chrome, navigator: { userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile" } }),
    ).toBe("assisted");
    expect(
      detectWebSyncMode({ ...chrome, navigator: { userAgent: "Mozilla/5.0 (Linux) Chrome/140", userAgentData: { mobile: true } } }),
    ).toBe("assisted");
  });
});

describe("Chromium : File System Access", () => {
  it("choisit un fichier, le lit, l'écrit, s'en souvient", async () => {
    const cloud = new CloudFile();
    cloud.content = "contenu";
    const store = new MemoryHandleStore();
    const sync = createFsAccessSync(pickers(new FakeFileHandle(cloud)), store);
    expect(await sync.status()).toBe("unconfigured");
    expect(await sync.choose("open")).toEqual({ name: "finances-sync.json" });
    expect(await sync.status()).toBe("ready");
    expect(await sync.read()).toBe("contenu");
    await sync.writeAtomic("nouveau");
    expect(cloud.content).toBe("nouveau");
    // Nouvelle session : le handle revient d'IndexedDB.
    const again = createFsAccessSync(pickers(null), store);
    expect(await again.targetName()).toBe("finances-sync.json");
    expect(await again.read()).toBe("nouveau");
  });

  it("annuler le sélecteur ne change rien", async () => {
    const sync = createFsAccessSync(pickers(null), new MemoryHandleStore());
    expect(await sync.choose("open")).toBeNull();
    expect(await sync.status()).toBe("unconfigured");
  });

  it("permission expirée : il faut la redemander", async () => {
    const cloud = new CloudFile();
    cloud.content = "x";
    const handle = new FakeFileHandle(cloud);
    const sync = createFsAccessSync(pickers(handle), new MemoryHandleStore());
    await sync.choose("open");
    handle.permission = "prompt";
    expect(await sync.status()).toBe("needs-permission");
    expect(await sync.requestPermission()).toBe(true);
    expect(await sync.status()).toBe("ready");
  });

  it("fichier déplacé ou supprimé : signalé comme manquant", async () => {
    const cloud = new CloudFile();
    cloud.content = "x";
    const sync = createFsAccessSync(pickers(new FakeFileHandle(cloud)), new MemoryHandleStore());
    await sync.choose("open");
    cloud.content = null;
    expect(await sync.status()).toBe("missing");
    expect(await sync.read()).toBeNull();
  });

  it("une écriture interrompue laisse l'original intact", async () => {
    const cloud = new CloudFile();
    cloud.content = "original";
    const handle = new FakeFileHandle(cloud);
    const sync = createFsAccessSync(pickers(handle), new MemoryHandleStore());
    await sync.choose("open");
    cloud.failNextWrite = true;
    await expect(sync.writeAtomic("nouveau")).rejects.toThrow("écriture interrompue");
    expect(cloud.content).toBe("original");
    expect(handle.aborted).toBe(1);
  });
});

describe("mode assisté", () => {
  it("lit le fichier désigné par l'utilisateur ; annuler renvoie null", async () => {
    const browser = new FakeBrowser();
    const sync = createAssistedSync(browser.env());
    browser.nextPick = { name: "finances-sync.json", content: "{}" };
    expect(await sync.pickAndRead()).toEqual({ name: "finances-sync.json", content: "{}" });
    browser.nextPick = null;
    expect(await sync.pickAndRead()).toBeNull();
    expect(browser.attached).toBe(0);
  });

  it("propose le fichier par le partage natif quand il est disponible", async () => {
    const browser = new FakeBrowser();
    browser.canShare = true;
    const sync = createAssistedSync(browser.env());
    expect(await sync.offer("{}", "finances-sync.json")).toBe("shared");
    expect(browser.shared.map((f) => f.name)).toEqual(["finances-sync.json"]);
    browser.shareError = "AbortError";
    expect(await sync.offer("{}", "finances-sync.json")).toBe("cancelled");
  });

  it("sinon, ou si le partage est refusé, en téléchargement", async () => {
    const browser = new FakeBrowser();
    const sync = createAssistedSync(browser.env());
    expect(await sync.offer('{"a":1}', "finances-sync.json")).toBe("downloaded");
    browser.canShare = true;
    browser.shareError = "NotAllowedError";
    expect(await sync.offer('{"a":2}', "finances-sync.json")).toBe("downloaded");
    expect(await Promise.all(browser.downloads.map((d) => d.blob.text()))).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("exports et imports passent par les mêmes mécanismes", async () => {
    const browser = new FakeBrowser();
    const files = createWebFileIO(browser.env());
    expect(await files.saveAs("mes-finances.csv", "text/csv", "a;b")).toBe(true);
    expect(browser.downloads[0]?.name).toBe("mes-finances.csv");
    browser.nextPick = { name: "sauvegarde.json", content: "{}" };
    expect(await files.openText([".json"])).toEqual({ name: "sauvegarde.json", content: "{}" });
  });
});

describe("bureau : commandes Rust", () => {
  it("relaie chaque opération à la commande correspondante", async () => {
    const cloud = new CloudFile();
    const invoke = fakeTauriInvoke(cloud);
    const sync = createTauriSync(invoke);
    expect(await sync.status()).toBe("unconfigured");
    expect(await sync.choose("create")).toEqual({ name: "finances-sync.json" });
    expect(await sync.status()).toBe("ready");
    expect(await sync.read()).toBe("");
    await sync.writeAtomic("{}");
    expect(cloud.content).toBe("{}");
    expect(await sync.requestPermission()).toBe(true);
    await sync.forget();
    expect(await sync.status()).toBe("unconfigured");
    expect(invoke.calls).toEqual([
      "sync_status",
      "sync_choose",
      "sync_status",
      "sync_read",
      "sync_write_atomic",
      "sync_forget",
      "sync_status",
    ]);
  });

  it("exports et imports par les dialogues natifs", async () => {
    const written = new Map<string, string>();
    const files = createTauriFileIO(
      {
        save: async (o) => `/Users/moi/Documents/${o.defaultPath}`,
        open: async () => "/Users/moi/Documents/sauvegarde.json",
      },
      { readTextFile: async () => "{}", writeTextFile: async (p, d) => void written.set(p, d) },
    );
    expect(await files.saveAs("mes-finances.csv", "text/csv", "a;b")).toBe(true);
    expect(written.get("/Users/moi/Documents/mes-finances.csv")).toBe("a;b");
    expect(await files.openText([".json"])).toEqual({ name: "sauvegarde.json", content: "{}" });
  });
});
