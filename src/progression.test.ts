import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RangeManagement, UPGRADES, RANGE_TIERS, BAY_COUNTS, PACE,
  CART_UPGRADE_POINTS, EXPANSION_POINTS, ARRIVAL_READY_SECONDS,
} from "./management.ts";
import type { PurchasableUpgradeId } from "./management.ts";

const purchases: PurchasableUpgradeId[] = [
  "engine", "hopper", "cage", "collector", "bumper", "engine",
  "hopper", "cage", "bumper", "collector", "engine", "hopper",
];

test("every three cart purchases grows the range, opens bays, and speeds up hitters for free", () => {
  const sim = new RangeManagement(() => 0.5);
  sim.cash = 10000;
  let spent = 0;
  assert.equal(sim.cartPoints, 0);
  for (const [index, id] of purchases.entries()) {
    spent += sim.price(id)!;
    assert.equal(sim.buy(id), "ok");
    const points = (index + 1) * CART_UPGRADE_POINTS;
    const tier = Math.floor(points / EXPANSION_POINTS);
    assert.equal(sim.cartPoints, points);
    assert.equal(sim.rangeYards, RANGE_TIERS[tier]);
    assert.equal(sim.bays, BAY_COUNTS[tier]);
    assert.equal(sim.golfers.length, sim.bays);
    assert.equal(sim.pace, PACE[tier]);
    assert.equal(sim.dispenserBuffer, tier < 2 ? 0 : tier < 4 ? 6 : 12);
    assert.equal(sim.spent, spent);
    assert.equal(sim.cash, 10000 - spent);
    assert.equal(sim.nextGrowth?.points, tier < 4 ? (tier + 1) * EXPANSION_POINTS : undefined);
  }
  assert.equal(sim.rangeYards, 300);
  assert.equal(sim.bays, 16);
  assert.equal(sim.nextGrowth, undefined);
});

test("only cart parts earn points; extras and ball stock remain separate purchases", () => {
  const sim = new RangeManagement();
  sim.cash = 10000;
  assert.deepEqual(UPGRADES.filter(u => u.category === "cart").map(u => u.id),
    ["engine", "hopper", "collector", "cage", "bumper"]);
  for (const id of ["depot", "clearing", "nets", "helper", "stock"] as const) {
    assert.equal(sim.buy(id), "ok");
    assert.equal(sim.levels[id], 1);
    assert.equal(sim.cartPoints, 0);
    assert.equal(sim.rangeYards, 100);
    assert.equal(sim.bays, 7);
  }
  const before = sim.exportState();
  for (const id of ["range", "bays", "dispensers"] as const) {
    assert.equal(sim.price(id), undefined);
    assert.equal(sim.buy(id), "maxed");
    assert.deepEqual(sim.exportState(), before);
  }
});

test("unaffordable and maxed cart upgrades cannot grant points or trigger growth", () => {
  const sim = new RangeManagement();
  const before = sim.exportState();
  assert.equal(sim.buy("collector"), "poor");
  assert.deepEqual(sim.exportState(), before);
  sim.cash = 10000;
  for (let i = 0; i < 3; i++) assert.equal(sim.buy("engine"), "ok");
  const maxed = sim.exportState();
  assert.equal(sim.buy("engine"), "maxed");
  assert.deepEqual(sim.exportState(), maxed);
  assert.equal(sim.cartPoints, 6);
  assert.equal(sim.rangeYards, 150);
});

test("expansion shortens pending shot intervals and new golfers drive in before hitting", () => {
  const sim = new RangeManagement(() => 0.5);
  sim.cash = 10000;
  sim.reserve = 5000;
  while (sim.golfers.some(g => g.shots === 0)) sim.update(0.05);
  sim.takeEvents();
  const now = sim.time;
  sim.golfers[0].nextShot = now + 10;
  for (const id of ["engine", "hopper", "collector"] as const) sim.buy(id);
  assert.ok(Math.abs(sim.golfers[0].nextShot - (now + 10 * PACE[1] / PACE[0])) < 1e-9);
  const newGolfers = sim.golfers.slice(7);
  assert.ok(newGolfers.every(g => g.status === "empty"));
  assert.ok(newGolfers[1].until < newGolfers[0].until);
  for (let i = 0; i < 120; i++) sim.update(0.05);
  assert.ok(newGolfers.every(g => g.status === "playing" && g.shots === 0));
  assert.ok(newGolfers.every(g => g.nextShot >= now + 3 + ARRIVAL_READY_SECONDS));
  assert.equal(sim.served, 9);
  assert.equal(sim.arrivals, 2);
  assert.equal(sim.takeEvents().filter(event => event.kind === "arrival").length, 2);
  for (let i = 0; i < 240; i++) sim.update(0.05);
  assert.ok(newGolfers.every(g => g.shots > 0));
});

test("restoring old shifts grants earned growth while preserving paid improvements and golfers", () => {
  const legacy = new RangeManagement().exportState();
  Object.assign(legacy.levels, { engine: 3, hopper: 3, collector: 2, cage: 2, bumper: 2 });
  const sim = new RangeManagement();
  sim.restoreState(legacy);
  assert.equal(sim.cartPoints, 24);
  assert.equal(sim.rangeYards, 300);
  assert.equal(sim.bays, 16);
  assert.equal(sim.dispenserBuffer, 12);
  assert.deepEqual(sim.golfers.slice(0, 7), legacy.golfers);
  assert.equal(sim.cash, legacy.cash);
  assert.equal(sim.spent, legacy.spent);
  assert.equal(legacy.golfers.length, 7);

  const paid = new RangeManagement().exportState();
  paid.levels.range = 4;
  paid.levels.bays = 2;
  paid.levels.dispensers = 2;
  while (paid.golfers.length < 12)
    paid.golfers.push({ ...paid.golfers[0], id: paid.golfers.length });
  sim.restoreState(paid);
  assert.equal(sim.rangeYards, 300);
  assert.equal(sim.bays, 12);
  assert.equal(sim.dispenserBuffer, 12);
  assert.deepEqual(sim.golfers, paid.golfers);
  assert.equal(sim.cartPoints, 0);
  assert.deepEqual(sim.nextGrowth, { points: 18, yards: 300, bays: 14, dispenserBuffer: 12 });
  for (const id of ["engine", "hopper", "collector"] as const) {
    sim.cash = 1000;
    sim.buy(id);
  }
  assert.equal(sim.rangeYards, 300);
  assert.equal(sim.bays, 12);
  assert.equal(sim.nextGrowth?.points, 18);
});

test("expanded shifts round-trip all golfers and resume the same simulation", () => {
  const original = new RangeManagement();
  original.cash = 10000;
  for (const id of purchases) original.buy(id);
  original.reserve = 5000;
  for (let i = 0; i < 400; i++) original.update(0.05);
  const saved = original.exportState();
  const restored = new RangeManagement();
  restored.restoreState(saved);
  assert.deepEqual(restored.exportState(), saved);
  for (let i = 0; i < 200; i++) assert.deepEqual(restored.update(0.05), original.update(0.05));
  assert.deepEqual(restored.exportState(), original.exportState());
});
