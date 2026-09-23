import { startApp } from "@cashmyr/ui";
import { createDesktopPlatform } from "./platform";

const root = document.getElementById("root")!;

startApp(await createDesktopPlatform(), root).catch((error: unknown) => {
  // Démarrage impossible (fichier de données illisible, par exemple) : on le dit, sans rien effacer.
  root.innerHTML = "";
  const message = document.createElement("p");
  message.style.cssText = "max-width:560px;margin:48px auto;padding:0 16px;font:16px/1.5 system-ui";
  message.textContent = `Cashmyr n'a pas pu démarrer : ${error instanceof Error ? error.message : String(error)}`;
  root.append(message);
});
