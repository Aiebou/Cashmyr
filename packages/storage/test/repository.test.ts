import { applyChanges, occurrenceId, setPreference, tombstone, touch, ValidationError, type Recurrence } from "@cashmyr/core";
import { describe, expect, it } from "vitest";
import { LocalDataError, Repository } from "../src";
import { TauriFileLocalStore } from "../src/tauri";
import { Clock, MemoryFs, MemoryKv, op, seed, TODAY } from "./fakes";

function setup(today = TODAY) {
  const clock = new Clock();
  const fs = new MemoryFs();
  const kv = new MemoryKv();
  const local = new TauriFileLocalStore(fs, kv);
  const open = (day = today) => Repository.open({ local, deviceLabel: "Mac", now: clock.now, today: () => day });
  return { clock, fs, kv, local, open };
}

const rent: Recurrence = {
  id: "rec-loyer",
  updatedAt: 1,
  deletedAt: null,
  label: "Loyer",
  amount: 80_000,
  type: "out",
  categoryId: "cat-courses",
  accountId: "acc-courant",
  dayOfMonth: 5,
  startMonth: "2026-07",
  endMonth: null,
  active: true,
};

describe("dépôt local", () => {
  it("un appareil neuf attend le tutoriel ; un appareil déjà en service ne le voit pas (décision 65)", async () => {
    const fresh = setup();
    expect((await fresh.open()).device.tour).toEqual({ seen: [] });

    const before = setup();
    const { tour: _tour, ...older } = (await before.open()).device;
    await before.local.setDevice(older);
    expect((await before.open()).device.tour).toBeUndefined();
  });

  it("premier lancement : jeu vide, appareil créé, aucune sauvegarde", async () => {
    const { open, local } = setup();
    const repo = await open();
    expect(repo.isFresh).toBe(true);
    expect(repo.pending).toBe(0);
    expect(repo.device.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await local.getDevice()).toEqual(repo.device);
    expect(await local.listSnapshots()).toEqual([]);
  });

  it("la première écriture enregistre aussi les préférences : le jeu se relit", async () => {
    const { open, local } = setup();
    const repo = await open();
    await repo.apply(seed);
    const again = await open();
    expect(again.isFresh).toBe(false);
    expect(again.data).toEqual(repo.data);
    expect(again.device.deviceId).toBe(repo.device.deviceId);
    // Au démarrage, une copie de sauvegarde est prise.
    expect(await local.listSnapshots()).toHaveLength(1);
  });

  it("refuse tout un lot qui viole un invariant, sans rien écrire", async () => {
    const { open, fs } = setup();
    const repo = await open();
    await repo.apply(seed);
    const before = fs.files.get("data.json");
    const orphan = op("op-1", "2026-09-01", 100, "cat-courses", "compte-inconnu", 2);
    const fine = op("op-2", "2026-09-01", 100, "cat-courses", "acc-courant", 2);
    await expect(repo.apply({ operations: [fine, orphan] })).rejects.toThrow(ValidationError);
    expect(fs.files.get("data.json")).toBe(before);
    expect(repo.data.collections.operations).toEqual([]);
    // Les écritures suivantes ne sont pas bloquées.
    await repo.apply({ operations: [fine] });
    expect(repo.data.collections.operations).toHaveLength(1);
  });

  it("compte les modifications en attente, lignes et préférences", async () => {
    const { open } = setup();
    const repo = await open();
    await repo.apply(seed);
    expect(repo.pending).toBe(6);
    await repo.apply({}, setPreference(repo.data.preferences, "theme", "dark", 10));
    expect(repo.device.dirty["pref:theme"]).toBe(10);
    expect(repo.pending).toBe(7);
  });

  it("génère les occurrences dues à l'ouverture, puis le jour venu", async () => {
    const { open } = setup();
    const repo = await open();
    await repo.apply({ ...seed, recurrences: [rent] });
    expect(repo.data.collections.operations.map((o) => o.date).sort()).toEqual(["2026-07-05", "2026-08-05", "2026-09-05"]);
    expect(repo.device.dirty[`operations:${occurrenceId(rent.id, "2026-09")}`]).toBeDefined();
    const nextMonth = await open("2026-10-06");
    expect(nextMonth.data.collections.operations).toHaveLength(4);
  });

  it("confirme ce que le fichier contient, garde ce qui est plus récent, oublie ce qui a été purgé", async () => {
    const { open } = setup();
    const repo = await open();
    await repo.apply(seed);
    const inFile = repo.data;
    await repo.apply({ accounts: [touch(seed.accounts[0]!, { name: "Courant" }, 50)] });
    await repo.confirmInFile(inFile);
    expect(Object.keys(repo.device.dirty)).toEqual(["accounts:acc-courant"]);

    const gone = tombstone(op("op-9", "2026-09-01", 1, "cat-courses", "acc-courant", 2), 60);
    await repo.apply({ operations: [gone] });
    await repo.acceptMerge({ ...repo.data, collections: { ...repo.data.collections, operations: [] } }, repo.data);
    await repo.confirmInFile(repo.data);
    expect(repo.pending).toBe(0);
  });

  it("une fusion n'efface pas ce qui a été saisi pendant qu'elle se calculait", async () => {
    const { open } = setup();
    const repo = await open();
    await repo.apply(seed);
    const base = repo.data;
    const fromFile = op("op-file", "2026-09-02", 200, "cat-courses", "acc-courant", 5);
    const merged = applyChanges(base, { operations: [fromFile] });
    const typedMeanwhile = op("op-local", "2026-09-03", 300, "cat-resto", "acc-courant", 6);
    await repo.apply({ operations: [typedMeanwhile] });
    await repo.acceptMerge(merged, base);
    expect(repo.data.collections.operations.map((o) => o.id).sort()).toEqual(["op-file", "op-local"]);
  });

  it("refuse d'ouvrir un jeu local incohérent, sans en prendre de copie", async () => {
    const { open, fs } = setup();
    const repo = await open();
    await repo.apply(seed);
    await open(); // ouverture réussie : une bonne copie
    const backups = () => new Map([...fs.files].filter(([k]) => k.startsWith("backups/")));
    const good = backups();
    expect(good.size).toBe(1);
    const broken = JSON.parse(fs.files.get("data.json")!);
    broken.collections.operations.push(op("op-x", "2026-09-01", 12.5, "cat-courses", "acc-courant", 2));
    fs.files.set("data.json", JSON.stringify(broken));
    await expect(open()).rejects.toThrow(LocalDataError);
    // La copie restante est celle d'avant : l'écran de secours peut y renvoyer.
    expect(backups()).toEqual(good);
  });

  it("un import remplace tout et rend tout à synchroniser", async () => {
    const { open } = setup();
    const repo = await open();
    await repo.replaceAll(applyChanges(repo.data, seed));
    expect(repo.isFresh).toBe(false);
    expect(repo.pending).toBe(6);
  });
});
