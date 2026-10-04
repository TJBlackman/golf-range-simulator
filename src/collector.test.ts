import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RangeManagement,
  INITIAL_RESERVE,
  GOLFER_COUNT,
  STARTING_CASH,
  STOCK_BUNDLE,
  GAME_OVER_SECONDS,
  WALKOUT_SECONDS,
  spillAmount,
} from "./management.ts";
import {
  resolveMove,
  obstacleDistance,
  segmentHitsVehicle,
  VEHICLE_RADIUS,
} from "./collisions.ts";

const seeded = (seed = 7) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const advance = (sim: RangeManagement, seconds: number) => {
  const shots = [];
  for (let i = 0; i < seconds * 20; i++) shots.push(...sim.update(0.05));
  return shots;
};

test("golfers consume finite supply, stop when empty, and lose patience", () => {
  const sim = new RangeManagement(seeded());
  const shots = [];
  while (sim.reserve > 0 && sim.time < 300) shots.push(...advance(sim, 1));
  shots.push(...advance(sim, 10));
  assert.equal(shots.length, INITIAL_RESERVE);
  assert.equal(sim.reserve, 0);
  assert.equal(sim.waiting, GOLFER_COUNT);
  assert.ok(sim.satisfaction < 100);
  assert.equal(advance(sim, 5).length, 0);
});

test("collecting does not feed golfers until a delivery, which resumes play and restores morale", () => {
  const sim = new RangeManagement(seeded());
  while (sim.reserve > 0 && sim.time < 300) advance(sim, 1);
  advance(sim, 8);
  const unhappy = sim.satisfaction;
  sim.collect(30);
  assert.equal(sim.reserve, 0);
  assert.equal(sim.unload(), 30);
  assert.equal(sim.hopper, 0);
  assert.equal(sim.returned, 30);
  assert.equal(sim.deliveries, 1);
  advance(sim, 5);
  assert.equal(sim.waiting, 0);
  assert.ok(sim.satisfaction > unhappy);
});

test("golfers walk out when patience runs dry, and the rating takes the hit", () => {
  const sim = new RangeManagement(seeded());
  advance(sim, 170);
  assert.ok(sim.walkouts >= 1);
  assert.ok(sim.reputation < 60);
  assert.ok(sim.golfers.some((g) => g.status !== "playing"));
  assert.ok(sim.takeEvents().some((e) => e.kind === "walkout"));
});

test("empty bays refill from the queue while the rating holds", () => {
  const sim = new RangeManagement(seeded());
  sim.reserve = 5000;
  const golfer = sim.golfers[0];
  golfer.waiting = true;
  golfer.patience = 0.01;
  advance(sim, 1);
  assert.equal(golfer.status, "leaving");
  advance(sim, WALKOUT_SECONDS + 1);
  assert.equal(golfer.status, "empty");
  advance(sim, 40);
  assert.equal(golfer.status, "playing");
  assert.equal(sim.arrivals, 1);
  assert.equal(sim.served, GOLFER_COUNT + 1);
});

test("the shift ends when nobody is left and nobody is coming", () => {
  const sim = new RangeManagement(seeded());
  sim.reserve = 0;
  sim.reputation = 0;
  for (const golfer of sim.golfers) {
    golfer.waiting = true;
    golfer.patience = 0.01;
  }
  advance(sim, 1);
  assert.ok(sim.golfers.every((g) => g.status === "leaving"));
  advance(sim, WALKOUT_SECONDS + 1);
  assert.ok(sim.golfers.every((g) => g.status === "empty"));
  assert.equal(sim.over, false);
  advance(sim, GAME_OVER_SECONDS + 1);
  assert.equal(sim.over, true);
  assert.ok(sim.takeEvents().some((e) => e.kind === "over"));
  assert.equal(sim.update(0.05).length, 0);
});

test("shots pay, streaks tip, and upgrades cost cash and change the cart", () => {
  const sim = new RangeManagement(seeded());
  advance(sim, 85);
  assert.ok(sim.cash > STARTING_CASH);
  assert.ok(sim.tips > 0);
  assert.ok(Math.abs(sim.earned - (sim.cash - STARTING_CASH)) < 1e-6);
  assert.equal(sim.buy("helper"), "poor");
  sim.cash = 1000;
  assert.equal(sim.buy("hopper"), "ok");
  assert.equal(sim.levels.hopper, 1);
  assert.equal(sim.hopperCapacity, 150);
  sim.collect(200);
  assert.equal(sim.hopper, 150);
  assert.equal(sim.buy("hopper"), "ok");
  assert.equal(sim.buy("hopper"), "maxed");
  const before = sim.reserve;
  assert.equal(sim.buy("stock"), "ok");
  assert.equal(sim.reserve, before + STOCK_BUNDLE);
  assert.equal(sim.buy("bays"), "ok");
  assert.equal(sim.golfers.length, 9);
  assert.equal(sim.golfers[8].status, "empty");
  assert.equal(sim.buy("engine"), "ok");
  assert.equal(sim.maxSpeed, 11.5);
  assert.equal(sim.rangeYards, 100);
  assert.equal(sim.pace, 2);
  assert.equal(sim.buy("range"), "ok");
  assert.equal(sim.rangeYards, 150);
  assert.ok(sim.pace < 2);
  assert.ok(sim.spent > 0);
  assert.equal(sim.cash, 1000 - sim.spent);
});

test("obstacles spill 50% and ball strikes spill 15%, rounded up, until the bumper and cage soften them", () => {
  assert.equal(spillAmount(100, "obstacle"), 50);
  assert.equal(spillAmount(100, "ball"), 15);
  assert.equal(spillAmount(33, "obstacle"), 17);
  assert.equal(spillAmount(33, "ball"), 5);
  assert.equal(spillAmount(0, "obstacle"), 0);
  const sim = new RangeManagement(seeded());
  sim.collect(100);
  assert.equal(sim.collect(10), 0);
  assert.equal(sim.spill("obstacle"), 50);
  assert.equal(sim.spill("ball"), 8);
  assert.equal(sim.hopper + sim.spilled, 100);
  sim.unload();
  assert.equal(sim.returned + sim.spilled, 100);
  sim.cash = 1000;
  sim.buy("bumper");
  sim.buy("bumper");
  sim.buy("cage");
  sim.buy("cage");
  sim.collect(100);
  assert.equal(sim.spill("obstacle"), 15);
  assert.equal(sim.spill("ball"), 0);
});

test("solid obstacles stop the vehicle, with clear routes still drivable", () => {
  const obstacle = {
    id: "log",
    name: "Fallen log",
    kind: "box" as const,
    minX: -27,
    maxX: -21,
    minZ: 54,
    maxZ: 55,
  };
  const result = resolveMove({ x: -24, z: 52 }, { x: -24, z: 52.6 }, [
    obstacle,
  ]);
  assert.equal(result.hit?.id, "log");
  assert.ok(obstacleDistance(result.position, obstacle) >= VEHICLE_RADIUS);
  assert.equal(
    resolveMove({ x: -19, z: 52 }, { x: -19, z: 52.6 }, [obstacle]).hit,
    undefined,
  );
  const tree = {
    id: "tree",
    name: "Tree",
    kind: "circle" as const,
    x: 0,
    z: 10,
    radius: 0.5,
  };
  const treeResult = resolveMove({ x: 0, z: 7 }, { x: 0, z: 8.1 }, [tree]);
  assert.ok(obstacleDistance(treeResult.position, tree) >= VEHICLE_RADIUS);
});

test("airborne collision sweeps catch high-speed and rotated hits but ignore balls over the roof or on the ground", () => {
  const cart = { x: 0, z: 20, angle: 0 };
  assert.equal(
    segmentHitsVehicle({ x: 0, y: 1, z: 15 }, { x: 0, y: 1, z: 25 }, cart),
    true,
  );
  assert.equal(
    segmentHitsVehicle({ x: 0, y: 4, z: 15 }, { x: 0, y: 4, z: 25 }, cart),
    false,
  );
  assert.equal(
    segmentHitsVehicle(
      { x: 0, y: 0.07, z: 15 },
      { x: 0, y: 0.07, z: 25 },
      cart,
    ),
    false,
  );
  assert.equal(
    segmentHitsVehicle({ x: 4, y: 1, z: 15 }, { x: 4, y: 1, z: 25 }, cart),
    false,
  );
  assert.equal(
    segmentHitsVehicle(
      { x: -5, y: 1, z: 20 },
      { x: 5, y: 1, z: 20 },
      { ...cart, angle: Math.PI / 2 },
    ),
    true,
  );
});
