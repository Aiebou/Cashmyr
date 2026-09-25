import { startApp } from "@cashmyr/ui";
import { createDesktopHost } from "./platform";

const root = document.getElementById("root")!;

// Des données locales refusées ouvrent l'écran de secours (startApp) ; arrive ici tout le reste.
createDesktopHost()
  .then((host) => startApp(host, root))
  .catch((error: unknown) => {
    // Démarrage impossible : on le dit, sans rien effacer.
    const message = document.createElement("p");
    message.style.cssText = "max-width:560px;margin:48px auto;padding:0 16px;font:16px/1.5 system-ui";
    message.textContent = `Cashmyr n'a pas pu démarrer : ${error instanceof Error ? error.message : String(error)}`;
    root.replaceChildren(message);
  });
