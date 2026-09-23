import type { AssistedSyncFile, FileIO } from "../types";

/** Ce que les fonctions de fichiers du navigateur utilisent de l'environnement. */
export type BrowserEnv = {
  document: {
    createElement(tag: "input"): HTMLInputElement;
    createElement(tag: "a"): HTMLAnchorElement;
    body: { appendChild(node: Node): unknown };
  };
  navigator: {
    canShare?(data: ShareData): boolean;
    share?(data: ShareData): Promise<void>;
  };
  URL: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };
  setTimeout(fn: () => void, ms: number): unknown;
};

const errorName = (e: unknown) => (typeof e === "object" && e !== null ? (e as { name?: string }).name : undefined);

/** Ouvre le sélecteur de fichiers et lit le fichier choisi ; null si l'utilisateur annule. */
export function pickTextFile(
  env: BrowserEnv,
  accept: readonly string[],
): Promise<{ name: string; content: string } | null> {
  return new Promise((resolve, reject) => {
    const input = env.document.createElement("input");
    input.type = "file";
    input.accept = accept.join(",");
    input.style.display = "none";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return resolve(null);
        file.text().then((content) => resolve({ name: file.name, content }), reject);
      },
      { once: true },
    );
    input.addEventListener(
      "cancel",
      () => {
        input.remove();
        resolve(null);
      },
      { once: true },
    );
    // Certains navigateurs n'ouvrent le sélecteur que si le champ est dans le document.
    env.document.body.appendChild(input);
    input.click();
  });
}

/** Déclenche le téléchargement d'un texte. */
export function downloadText(env: BrowserEnv, name: string, mime: string, content: string): void {
  const url = env.URL.createObjectURL(new Blob([content], { type: mime }));
  const link = env.document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  env.document.body.appendChild(link);
  link.click();
  link.remove();
  // Laisser au navigateur le temps de commencer le téléchargement.
  env.setTimeout(() => env.URL.revokeObjectURL(url), 60_000);
}

/**
 * Safari, Firefox et mobiles : pas d'accès direct au fichier. L'utilisateur désigne
 * le fichier, l'application fusionne, puis propose le fichier fusionné : partage
 * natif (« Enregistrer dans Fichiers » sur iOS) si possible, téléchargement sinon.
 * L'application ne peut pas vérifier que l'original a bien été remplacé.
 */
export function createAssistedSync(env: BrowserEnv): AssistedSyncFile {
  return {
    mode: "assisted",
    pickAndRead: () => pickTextFile(env, [".json", "application/json"]),
    async offer(content, name) {
      const file = new File([content], name, { type: "application/json" });
      if (env.navigator.share && env.navigator.canShare?.({ files: [file] })) {
        try {
          await env.navigator.share({ files: [file], title: name });
          return "shared";
        } catch (e) {
          if (errorName(e) === "AbortError") return "cancelled";
          // Partage refusé (activation expirée, type non pris en charge) : téléchargement.
        }
      }
      downloadText(env, name, "application/json", content);
      return "downloaded";
    },
  };
}

/** Exports et imports de fichiers dans le navigateur. */
export function createWebFileIO(env: BrowserEnv): FileIO {
  return {
    async saveAs(name, mime, content) {
      downloadText(env, name, mime, content);
      return true;
    },
    openText: (accept) => pickTextFile(env, accept),
  };
}
