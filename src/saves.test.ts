import { test } from "node:test";
import assert from "node:assert/strict";
import { RangeManagement, UPGRADES, validateManagementSnapshot } from "./management.ts";
import { SaveStore, SaveOwnership, SAVE_PREFIX, normalizeSaveName } from "./saves.ts";
import type { SaveStorage } from "./saves.ts";

class MemoryStorage implements SaveStorage {
  values = new Map<string, string>();
  failWrites = false;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) { const error = new Error("Storage quota exceeded"); error.name = "QuotaExceededError"; throw error; }
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}
function fixture() {
  const memory = new MemoryStorage();
  let time = 1000, id = 0;
  const store = new SaveStore(memory, validateManagementSnapshot, () => ++time, () => `slot-${++id}`);
  const sim = new RangeManagement();
  const summary = () => ({ time: sim.time, cash: sim.cash, yards: sim.rangeYards, over: sim.over });
  return { memory, store, sim, summary };
}

test("management snapshots preserve upgrades, finances, pending events, and future seeded simulation", () => {
  const original = new RangeManagement();
  original.cash = 10000;
  for (const upgrade of UPGRADES)
    for (let tier = 0; tier < (upgrade.repeat ? 1 : upgrade.costs.length); tier++) assert.equal(original.buy(upgrade.id), "ok");
  original.collect(73);
  original.spill("obstacle");
  original.unload();
  original.deliverHelper(24);
  original.reserve = 5000;
  original.golfers[0].patience = 0;
  original.golfers[0].waiting = true;
  for (let frame = 0; frame < 100; frame++) original.update(0.05);
  const snapshot = JSON.parse(JSON.stringify(original.exportState()));
  const restored = new RangeManagement();
  restored.restoreState(snapshot);
  assert.deepEqual(restored.exportState(), snapshot);
  assert.deepEqual(restored.takeEvents(), original.takeEvents());
  for (let frame = 0; frame < 1000; frame++) assert.deepEqual(restored.update(0.05), original.update(0.05));
  assert.deepEqual(restored.exportState(), original.exportState());
});

test("exported and restored management state do not share mutable arrays with callers", () => {
  const sim = new RangeManagement(), saved = sim.exportState();
  saved.golfers[0].patience = 9;
  saved.levels.range = 2;
  assert.equal(sim.golfers[0].patience, 100);
  assert.equal(sim.levels.range, 0);
  sim.restoreState(saved);
  saved.golfers[0].patience = 3;
  saved.levels.range = 0;
  assert.equal(sim.golfers[0].patience, 9);
  assert.equal(sim.levels.range, 2);
});

test("invalid management saves are rejected before any live state is changed", () => {
  const sim = new RangeManagement(), before = sim.exportState();
  const badStates = [
    { ...before, cash: NaN }, { ...before, reserve: -1 }, { ...before, hopper: 76 },
    { ...before, levels: { ...before.levels, engine: 8 } },
    { ...before, golfers: [{ ...before.golfers[0], type: "constructor" }, ...before.golfers.slice(1)] },
    { ...before, golfers: [{ ...before.golfers[0], leftHanded: "yes" }, ...before.golfers.slice(1)] },
    { ...before, golfers: [{ ...before.golfers[0], booked: 1 }, ...before.golfers.slice(1)] },
    { ...before, golfers: [{ ...before.golfers[0], nextShot: Infinity }, ...before.golfers.slice(1)] },
    { ...before, golfers: before.golfers.slice(1) }, { ...before, over: "false" },
    { ...before, events: [{ kind: "arrival", golfer: 99, type: "casual" }] },
  ];
  for (const bad of badStates) {
    assert.throws(() => sim.restoreState(bad));
    assert.deepEqual(sim.exportState(), before);
  }
});

test("automatic saves, named saves, overwrite, and delete keep independent durable slots", () => {
  const { memory, store, sim, summary } = fixture();
  store.autosave(sim.exportState(), summary());
  const named = store.saveNamed("  Day   one  ", sim.exportState(), summary());
  sim.cash = 82;
  store.autosave(sim.exportState(), summary());
  const reopened = new SaveStore(memory, validateManagementSnapshot);
  assert.equal(reopened.read("autosave")!.payload.cash, 82);
  assert.equal(reopened.read(named.id)!.payload.cash, 20);
  assert.equal(reopened.read(named.id)!.name, "Day one");
  assert.throws(() => store.saveNamed("day one", sim.exportState(), summary()), /already exists/);
  store.overwrite(named.id, sim.exportState(), summary());
  assert.equal(reopened.read(named.id)!.payload.cash, 82);
  store.remove("autosave");
  assert.equal(reopened.read(named.id)!.payload.cash, 82);
  store.autosave(sim.exportState(), summary());
  store.remove(named.id);
  assert.equal(reopened.read("autosave")!.payload.cash, 82);
  assert.equal(reopened.read(named.id), null);
});

test("corrupt and unsupported saves remain visible and unchanged until explicit replacement", () => {
  const { memory, store, sim, summary } = fixture();
  const damaged = "{broken-json";
  memory.setItem(SAVE_PREFIX + "autosave", damaged);
  assert.match(store.list()[0].error!, /damaged/);
  assert.throws(() => store.autosave(sim.exportState(), summary()), /damaged/);
  assert.equal(memory.getItem(SAVE_PREFIX + "autosave"), damaged);
  store.autosave(sim.exportState(), summary(), true);
  const named = store.saveNamed("Future version", sim.exportState(), summary());
  const unsupported = JSON.parse(memory.getItem(SAVE_PREFIX + named.id)!);
  unsupported.version = 20;
  memory.setItem(SAVE_PREFIX + named.id, JSON.stringify(unsupported));
  assert.match(store.list().find(entry => entry.id === named.id)!.error!, /unsupported version/);
  assert.throws(() => store.read(named.id), /unsupported version/);
  assert.equal(JSON.parse(memory.getItem(SAVE_PREFIX + named.id)!).version, 20);
  store.remove(named.id);
  assert.equal(store.read(named.id), null);
});

test("a quota failure leaves both the previous autosave and named games intact", () => {
  const { memory, store, sim, summary } = fixture();
  store.autosave(sim.exportState(), summary());
  const named = store.saveNamed("Before quota", sim.exportState(), summary());
  sim.cash = 400;
  memory.failWrites = true;
  assert.throws(() => store.autosave(sim.exportState(), summary()), /storage is full/);
  assert.throws(() => store.overwrite(named.id, sim.exportState(), summary()), /storage is full/);
  assert.equal(store.read("autosave")!.payload.cash, 20);
  assert.equal(store.read(named.id)!.payload.cash, 20);
});

test("browser storage denial is reported without resetting a shift", () => {
  const blocked: SaveStorage = {
    get length() { throw new Error("Blocked"); }, key() { throw new Error("Blocked"); },
    getItem() { throw new Error("Blocked"); }, setItem() { throw new Error("Blocked"); }, removeItem() { throw new Error("Blocked"); },
  };
  const store = new SaveStore(blocked, validateManagementSnapshot);
  assert.throws(() => store.list(), /Allow site storage/);
  assert.throws(() => store.read("autosave"), /Allow site storage/);
});

test("save names are normalized and bounded, and invalid payloads never replace a good save", () => {
  assert.equal(normalizeSaveName(" Morning   round "), "Morning round");
  assert.throws(() => normalizeSaveName(" "));
  assert.throws(() => normalizeSaveName("x".repeat(49)));
  const { store, sim, summary } = fixture();
  store.autosave(sim.exportState(), summary());
  const invalid = sim.exportState(); invalid.cash = -5;
  assert.throws(() => store.autosave(invalid, summary()));
  assert.equal(store.read("autosave")!.payload.cash, 20);
  const loaded = store.read("autosave")!;
  loaded.payload.golfers[0].patience = 0;
  assert.equal(store.read("autosave")!.payload.golfers[0].patience, 100);
});

test("the last explicitly activated tab owns autosave, and stale or reloaded tabs cannot reclaim it", () => {
  const { memory, store, sim, summary } = fixture();
  const older = new SaveOwnership(memory, "older-document"), current = new SaveOwnership(memory, "current-document");
  assert.equal(older.owns(), false);
  older.claim();
  if (older.owns()) store.autosave(sim.exportState(), summary());
  current.claim();
  sim.cash = 91;
  if (current.owns()) store.autosave(sim.exportState(), summary());
  assert.equal(older.owns(), false);
  sim.cash = 20;
  if (older.owns()) store.autosave(sim.exportState(), summary());
  assert.equal(store.read("autosave")!.payload.cash, 91);
  // Named slots stay independent even when this tab has lost automatic ownership.
  const named = store.saveNamed("Older tab checkpoint", sim.exportState(), summary());
  assert.equal(store.read(named.id)!.payload.cash, 20);
  assert.equal(store.read("autosave")!.payload.cash, 91);
  const reloaded = new SaveOwnership(memory, "current-document-after-reload");
  assert.equal(reloaded.owns(), false);
  reloaded.claim();
  assert.equal(reloaded.owns(), true);
  assert.equal(current.owns(), false);
  older.claim();
  assert.equal(older.owns(), true);
  assert.equal(reloaded.owns(), false);
});
