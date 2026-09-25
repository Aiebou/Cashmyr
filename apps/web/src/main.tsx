import { startApp } from "@cashmyr/ui";
import { createWebHost } from "./platform";

const root = document.getElementById("root")!;

startApp(createWebHost(), root).catch((error: unknown) => {
  // Démarrage impossible (stockage local illisible, navigateur trop ancien) : on le dit, sans rien effacer.
  root.innerHTML = "";
  const message = document.createElement("p");
  message.style.cssText = "max-width:560px;margin:48px auto;padding:0 16px;font:16px/1.5 system-ui";
  message.textContent = `Cashmyr n'a pas pu démarrer : ${error instanceof Error ? error.message : String(error)}`;
  root.append(message);
});
