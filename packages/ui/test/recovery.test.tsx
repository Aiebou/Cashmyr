import { applyChanges, emptyDataset, type Dataset, type Operation } from "@cashmyr/core";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startApp } from "../src/boot";
import { defaultCategories } from "../src/lib/data";
import { stamp } from "../src/lib/format";
import { accounts, MemoryProfileHost, renderApp } from "./helpers";

afterEach(() => {
  cleanup();
  // Les écrans montés par startApp ne passent pas par render : on vide la page à la main.
  document.body.replaceChildren();
});

const T1 = Date.UTC(2026, 8, 20, 9);
const T2 = Date.UTC(2026, 8, 22, 9);

const valid: Dataset = applyChanges(emptyDataset(), { categories: defaultCategories(), accounts: [accounts.courant] });

/** Une opération au montant non entier : refusée par la validation à l'ouverture. */
function broken(): Dataset {
  const bad = {
    id: "op-x",
    updatedAt: 5,
    deletedAt: null,
    date: "2026-09-21",
    amount: 12.5,
    type: "out",
    note: "",
    categoryId: valid.collections.categories.find((c) => c.kind === "out")!.id,
    accountId: accounts.courant.id,
  } as Operation;
  const data = structuredClone(valid);
  data.collections.operations.push(bad);
  return data;
}

/** Appareil aux données abîmées : une bonne copie (T1), et, si demandé, une copie abîmée plus récente (T2). */
async function damagedDevice({ goodCopy = true, badCopy = false } = {}) {
  const saveAs = vi.fn(async (_name: string, _mime: string, _content: string) => true);
  const host = new MemoryProfileHost({ target: "web", deviceLabel: "test", files: { saveAs, openText: async () => null }, shortcutHint: null });
  const local = host.storeOf("principal");
  if (goodCopy) {
    local.data = valid;
    await local.snapshot(T1);
  }
  local.data = broken();
  if (badCopy) local.snapshots.unshift({ info: { id: "snap-bad", takenAt: T2, bytes: 10 }, data: broken() });
  const restart = vi.fn();
  const element = document.body.appendChild(document.createElement("div"));
  await act(() => startApp(host, element, { restart }));
  return { local, saveAs, restart };
}

describe("écran de secours", () => {
  it("s'affiche au lieu de l'application, avec les copies vérifiées une à une", async () => {
    await damagedDevice({ badCopy: true });
    expect(screen.getByRole("heading", { name: "Les données de cet appareil sont abîmées" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
    const list = await screen.findByRole("list");
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("abîmée elle aussi");
    expect(within(rows[0]!).queryByRole("button")).toBeNull();
    expect(within(rows[1]!).getByRole("button", { name: `Restaurer la copie du ${stamp(T1)}` })).toBeTruthy();
    // Il existe une copie utilisable : pas de remise à zéro proposée.
    expect(screen.queryByRole("button", { name: "Repartir de zéro" })).toBeNull();
  });

  it("restaurer : la copie reprend sa place, la version abîmée est gardée, l'application redémarre", async () => {
    const { local, restart } = await damagedDevice();
    const damagedRaw = JSON.stringify(local.data);
    await userEvent.click(await screen.findByRole("button", { name: `Restaurer la copie du ${stamp(T1)}` }));
    expect(local.data).toEqual(valid);
    expect(local.setAsideList.map((v) => v.content)).toEqual([damagedRaw]);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("restaurée");
  });

  it("sans copie utilisable : repartir de zéro, après confirmation", async () => {
    const { local, restart } = await damagedDevice({ goodCopy: false, badCopy: true });
    await userEvent.click(await screen.findByRole("button", { name: "Repartir de zéro" }));
    expect(local.data).not.toBeNull();
    expect(restart).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirmer : repartir de zéro" }));
    expect(local.data).toBeNull();
    expect(local.setAsideList).toHaveLength(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("enregistrer la version abîmée telle qu'elle est", async () => {
    const { local, saveAs } = await damagedDevice();
    await userEvent.click(await screen.findByRole("button", { name: "Enregistrer la version abîmée" }));
    expect(saveAs).toHaveBeenCalledTimes(1);
    const [name, mime, content] = saveAs.mock.calls[0]!;
    expect(name).toMatch(/^cashmyr-version-abimee-\d{4}-\d{2}-\d{2}\.json$/);
    expect(mime).toBe("application/json");
    expect(content).toBe(JSON.stringify(local.data));
  });

  it("une restauration qui échoue le dit, et laisse réessayer", async () => {
    const { local, restart } = await damagedDevice();
    const replace = vi.spyOn(local, "replace").mockRejectedValueOnce(new Error("disque plein"));
    const button = await screen.findByRole("button", { name: `Restaurer la copie du ${stamp(T1)}` });
    await userEvent.click(button);
    expect(screen.getByRole("alert").textContent).toContain("disque plein");
    expect(restart).not.toHaveBeenCalled();
    replace.mockRestore();
    await userEvent.click(button);
    expect(local.data).toEqual(valid);
    expect(restart).toHaveBeenCalledTimes(1);
  });
});

describe("Paramètres : versions abîmées mises de côté", () => {
  it("absentes : pas de carte ; présentes : enregistrer, ou supprimer après confirmation", async () => {
    const saveAs = vi.fn(async () => true);
    const app = await renderApp({ files: { saveAs } });
    act(() => app.actions.setTab("settings"));
    expect(screen.queryByRole("heading", { name: "Versions abîmées mises de côté" })).toBeNull();
    cleanup();

    const next = await renderApp({ files: { saveAs } });
    next.local.setAsideList = [{ info: { id: String(T2), setAsideAt: T2, bytes: 2048 }, content: "{abîmé" }];
    act(() => next.actions.setTab("settings"));
    const card = (await screen.findByRole("heading", { name: "Versions abîmées mises de côté" })).closest("section")!;
    expect(within(card).getByText(/2 Ko/)).toBeTruthy();

    await userEvent.click(within(card).getByRole("button", { name: `Enregistrer la version mise de côté le ${stamp(T2)}` }));
    expect(saveAs).toHaveBeenCalledWith(expect.stringMatching(/^cashmyr-version-abimee-/), "application/json", "{abîmé");

    await userEvent.click(within(card).getByRole("button", { name: `Supprimer la version mise de côté le ${stamp(T2)}` }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Supprimer" }));
    expect(next.local.setAsideList).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Versions abîmées mises de côté" })).toBeNull();
  });
});
