import { LocalFileCorruptedError, localRecoverySteps } from "@cashmyr/storage/tauri";
import { startApp } from "@cashmyr/ui";
import { appDataDir } from "@tauri-apps/api/path";
import { createDesktopPlatform } from "./platform";

const root = document.getElementById("root")!;

/** data.json illisible (JSON abîmé) ou invalide (refusé par la validation) : même remède. */
const localDataProblem = (error: unknown) =>
  error instanceof LocalFileCorruptedError || (error instanceof Error && error.name === "ValidationError");

/** Dossier de données, si Tauri ne sait pas le donner : les emplacements du README. */
function knownDataDir(): string {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return "%APPDATA%\\io.github.aiebou.cashmyr";
  if (/Mac OS X|Macintosh/.test(ua)) return "~/Library/Application Support/io.github.aiebou.cashmyr";
  return "~/.local/share/io.github.aiebou.cashmyr";
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, css = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.textContent = text;
  el.style.cssText = css;
  return el;
}

createDesktopPlatform()
  .then((platform) => startApp(platform, root))
  .catch(async (error: unknown) => {
    // Démarrage impossible : on le dit, sans rien effacer ni écrire.
    const detail = error instanceof Error ? error.message : String(error);
    const box = document.createElement("div");
    box.style.cssText = "max-width:620px;margin:48px auto;padding:0 16px;font:16px/1.5 system-ui";
    if (localDataProblem(error)) {
      const dir = await appDataDir().catch(knownDataDir);
      const steps = document.createElement("ol");
      steps.style.cssText = "padding-left:22px";
      for (const step of localRecoverySteps(dir)) steps.append(element("li", step, "margin:6px 0"));
      box.append(
        element(
          "p",
          "Cashmyr n'a pas pu démarrer : son fichier de données, data.json, est abîmé. Cashmyr n'y a pas touché, " +
            "et tes copies de sauvegarde sont intactes.",
        ),
        element("p", "Pour repartir de la dernière copie :", "margin-bottom:0"),
        steps,
        element("p", `Détail : ${detail}`, "font-size:13px;opacity:.7;white-space:pre-line"),
      );
    } else {
      box.append(element("p", `Cashmyr n'a pas pu démarrer : ${detail}`));
    }
    root.replaceChildren(box);
  });
