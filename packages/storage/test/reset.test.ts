import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { Repository, resetDevice, type LocalStore } from "../src";
import { TauriFileLocalStore } from "../src/tauri";
import { IndexedDbLocalStore } from "../src/web";
import { Clock, MemoryFs, MemoryKv, op, seed, TODAY } from "./fakes";

let dbCount = 0;
const stores: [string, () => Promise<LocalStore>][] = [
  ["bureau", async () => new TauriFileLocalStore(new MemoryFs(), new MemoryKv())],
  ["web", async () => IndexedDbLocalStore.open(`remise-${++dbCount}`)],
];

describe.each(stores)("remise à zéro de cet appareil (%s)", (_, make) => {
  it("copie de sauvegarde, données retirées, état de l'appareil vidé sauf son identité ; l'accueil revient", async () => {
    const clock = new Clock();
    const local = await make();
    const open = () => Repository.open({ local, deviceLabel: "Mac", now: clock.now, today: () => TODAY });
    const repo = await open();
    await repo.apply(seed);
    await repo.apply({ operations: [op("op-1", "2026-09-10", 4_250, "cat-courses", "acc-courant", clock.now())] });
    await repo.updateDevice({
      sync: { fileId: "file-1", targetName: "finances-sync.json", lastMergeAt: 5, lastOfferAt: null, lastError: null },
      display: { bannerTotal: "injected" },
    });
    const { deviceId } = repo.device;
    await repo.flush();

    clock.advance(1000);
    await resetDevice(local, clock.now());

    expect(await local.load()).toBeNull();
    expect(await local.getDevice()).toEqual({
      deviceId,
      deviceLabel: "Mac",
      sync: { fileId: null, targetName: null, lastMergeAt: null, lastOfferAt: null, lastError: null },
      dirty: {},
    });
    const [copy] = await local.listSnapshots();
    expect((await local.readSnapshot(copy!.id)).collections.operations.map((o) => o.id)).toEqual(["op-1"]);
    const reopened = await open();
    expect(reopened.isFresh).toBe(true);
  });
});
