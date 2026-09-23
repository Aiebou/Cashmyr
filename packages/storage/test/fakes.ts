import type { Account, Bucket, Category, Operation, Role } from "@cashmyr/core";
import type { BrowserEnv, FsFileHandle, HandleStore } from "../src/web";
import type { FsLike, Invoke, KeyValueLike } from "../src/tauri";

export const TODAY = "2026-09-23";
export const T0 = Date.UTC(2026, 8, 23, 12);
export const MIN = 60_000;

/** Une horloge que les tests font avancer. */
export class Clock {
  constructor(public t = T0) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

/** Minuteries déclenchées à la main. */
export class ManualTimers {
  private next = 1;
  private pending = new Map<number, { fn: () => void; ms: number }>();
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.pending.set(id, { fn, ms });
    return id;
  };
  clearTimeout = (id: unknown) => {
    this.pending.delete(id as number);
  };
  get count() {
    return this.pending.size;
  }
  delays() {
    return [...this.pending.values()].map((p) => p.ms);
  }
  fire() {
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const t of due) t.fn();
  }
}

export const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

const namedError = (name: string, message = name) => Object.assign(new Error(message), { name });

// ── Fichiers ────────────────────────────────────────────────────────────────

/** Système de fichiers en mémoire, avec pannes provoquées. */
export class MemoryFs implements FsLike {
  files = new Map<string, string>();
  dirs = new Set<string>();
  log: string[] = [];
  /** La prochaine opération de ce nom échoue. */
  failNext: string | null = null;

  private maybeFail(op: string) {
    if (this.failNext === op) {
      this.failNext = null;
      throw new Error(`panne simulée : ${op}`);
    }
  }
  async exists(path: string) {
    return this.files.has(path) || this.dirs.has(path);
  }
  async readTextFile(path: string) {
    const text = this.files.get(path);
    if (text === undefined) throw namedError("NotFound", `introuvable : ${path}`);
    return text;
  }
  async writeTextFile(path: string, data: string) {
    this.log.push(`write ${path}`);
    this.maybeFail("writeTextFile");
    this.files.set(path, data);
  }
  async rename(from: string, to: string) {
    this.log.push(`rename ${from} → ${to}`);
    this.maybeFail("rename");
    const text = this.files.get(from);
    if (text === undefined) throw new Error(`introuvable : ${from}`);
    this.files.delete(from);
    this.files.set(to, text);
  }
  async mkdir(path: string) {
    this.dirs.add(path);
  }
  async readDir(path: string) {
    const prefix = `${path}/`;
    return [...this.files.keys()]
      .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/"))
      .map((f) => ({ name: f.slice(prefix.length), isFile: true }));
  }
  async remove(path: string) {
    this.files.delete(path);
  }
}

export class MemoryKv implements KeyValueLike {
  values = new Map<string, unknown>();
  saved = 0;
  async get<T>(key: string) {
    return structuredClone(this.values.get(key)) as T | undefined;
  }
  async set(key: string, value: unknown) {
    this.values.set(key, structuredClone(value));
  }
  async save() {
    this.saved++;
  }
}

/** Le fichier de synchronisation posé dans le cloud de l'utilisateur. */
export class CloudFile {
  content: string | null = null;
  writes = 0;
  /** La prochaine écriture échoue avant d'avoir remplacé l'original. */
  failNextWrite = false;
  constructor(public name = "finances-sync.json") {}
}

/** Commandes Rust de synchronisation, simulées sur un CloudFile. */
export function fakeTauriInvoke(cloud: CloudFile): Invoke & { calls: string[] } {
  let chosen = false;
  const calls: string[] = [];
  const invoke = (async (command: string, args?: Record<string, unknown>) => {
    calls.push(command);
    switch (command) {
      case "sync_choose":
        chosen = true;
        if (args?.kind === "create" && cloud.content === null) cloud.content = "";
        return { name: cloud.name };
      case "sync_status":
        return !chosen ? "unconfigured" : cloud.content === null ? "missing" : "ready";
      case "sync_target_name":
        return chosen ? cloud.name : null;
      case "sync_read":
        return cloud.content;
      case "sync_write_atomic":
        if (cloud.failNextWrite) {
          cloud.failNextWrite = false;
          throw new Error("disque plein");
        }
        cloud.content = args?.content as string;
        cloud.writes++;
        return undefined;
      case "sync_forget":
        chosen = false;
        return undefined;
      default:
        throw new Error(`commande inconnue : ${command}`);
    }
  }) as Invoke & { calls: string[] };
  invoke.calls = calls;
  return invoke;
}

/** FileSystemFileHandle simulé : l'écriture ne remplace l'original qu'à `close()`. */
export class FakeFileHandle implements FsFileHandle {
  permission: "granted" | "prompt" | "denied" = "granted";
  grantOnRequest = true;
  aborted = 0;
  constructor(public cloud: CloudFile) {}
  get name() {
    return this.cloud.name;
  }
  async getFile() {
    if (this.permission !== "granted") throw namedError("NotAllowedError");
    if (this.cloud.content === null) throw namedError("NotFoundError");
    const text = this.cloud.content;
    return { text: async () => text };
  }
  async createWritable() {
    let buffer = "";
    return {
      write: async (data: string) => {
        if (this.cloud.failNextWrite) {
          this.cloud.failNextWrite = false;
          throw new Error("écriture interrompue");
        }
        buffer += data;
      },
      close: async () => {
        this.cloud.content = buffer;
        this.cloud.writes++;
      },
      abort: async () => {
        this.aborted++;
      },
    };
  }
  async queryPermission() {
    return this.permission;
  }
  async requestPermission() {
    if (this.grantOnRequest) this.permission = "granted";
    return this.permission;
  }
}

export class MemoryHandleStore implements HandleStore {
  handle: FsFileHandle | null = null;
  async get() {
    return this.handle;
  }
  async set(h: FsFileHandle | null) {
    this.handle = h;
  }
}

// ── Navigateur ──────────────────────────────────────────────────────────────

type Listener = () => void;

/** Juste assez de DOM pour le sélecteur de fichiers, le téléchargement et le partage. */
export class FakeBrowser {
  /** Réponse du prochain sélecteur de fichiers ; null = l'utilisateur annule. */
  nextPick: { name: string; content: string } | null = null;
  downloads: { name: string; blob: Blob }[] = [];
  shared: File[] = [];
  canShare = false;
  shareError: string | null = null;
  attached = 0;
  private blobs = new Map<string, Blob>();

  env(): BrowserEnv {
    const browser = this;
    const createElement = (tag: string) => {
      const listeners = new Map<string, Listener>();
      const el = {
        type: "",
        accept: "",
        href: "",
        download: "",
        rel: "",
        style: {} as Record<string, string>,
        files: null as File[] | null,
        addEventListener: (event: string, fn: Listener) => listeners.set(event, fn),
        remove: () => {
          browser.attached--;
        },
        click: () => {
          if (tag === "a") {
            browser.downloads.push({ name: el.download, blob: browser.blobs.get(el.href)! });
            return;
          }
          const pick = browser.nextPick;
          queueMicrotask(() => {
            if (!pick) return listeners.get("cancel")?.();
            el.files = [new File([pick.content], pick.name, { type: "application/json" })];
            listeners.get("change")?.();
          });
        },
      };
      return el;
    };
    let url = 0;
    return {
      document: {
        createElement: createElement as unknown as BrowserEnv["document"]["createElement"],
        body: { appendChild: () => browser.attached++ },
      },
      navigator: {
        canShare: () => browser.canShare,
        share: async (data: ShareData) => {
          if (browser.shareError) throw namedError(browser.shareError);
          browser.shared.push(...(data.files ?? []));
        },
      },
      URL: {
        createObjectURL: (blob: Blob) => {
          const key = `blob:${++url}`;
          browser.blobs.set(key, blob);
          return key;
        },
        revokeObjectURL: (key: string) => browser.blobs.delete(key),
      },
      setTimeout: () => 0,
    };
  }

  /** L'utilisateur enregistre le dernier fichier proposé à la place de l'original. */
  async saveLastOfferOver(cloud: CloudFile) {
    const last = this.shared.at(-1) ?? this.downloads.at(-1)?.blob;
    if (!last) throw new Error("aucun fichier proposé");
    cloud.content = await last.text();
    cloud.writes++;
  }
}

// ── Données ─────────────────────────────────────────────────────────────────

export const cat = (id: string, name: string, kind: "in" | "out", bucket?: Bucket, updatedAt = 1): Category => ({
  id,
  updatedAt,
  deletedAt: null,
  name,
  kind,
  ...(bucket ? { bucket } : {}),
  color: 0,
});

export const acc = (id: string, name: string, role: Role, opening = 0, updatedAt = 1): Account => ({
  id,
  updatedAt,
  deletedAt: null,
  name,
  role,
  opening,
  safety: role === "epargne",
  color: 0,
});

export const op = (
  id: string,
  date: string,
  amount: number,
  categoryId: string,
  accountId: string,
  updatedAt: number,
  type: "in" | "out" = "out",
): Operation => ({ id, updatedAt, deletedAt: null, date, amount, type, note: "", categoryId, accountId });

/** Catégories et comptes de départ. */
export const seed = {
  categories: [
    cat("cat-salaire", "Salaire", "in"),
    cat("cat-courses", "Courses", "out", "besoin"),
    cat("cat-resto", "Restaurants", "out", "envie"),
    cat("cat-credit", "Crédit", "out", "besoin"),
  ],
  accounts: [acc("acc-courant", "Compte courant", "courant", 100_000), acc("acc-livret", "Livret A", "epargne")],
};
