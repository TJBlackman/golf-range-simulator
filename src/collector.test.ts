import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { HopperBeacon } from "./hopper-beacon.ts";
import { cartSpeedMultiplier, SAND_TRAPS, SAND_TRAP_OUTLINE, SAND_TRAP_ROTATION } from "./terrain.ts";
import { TEE, YARD } from "./physics.ts";
import {
  RangeManagement,
  INITIAL_RESERVE,
  GOLFER_COUNT,
  STARTING_CASH,
  STOCK_BUNDLE,
  HOPPER_CAPACITY,
  FULL_LOAD_BONUS,
  WALKOUT_SECONDS,
  BAY_COOLDOWN_SECONDS,
  getGolferMood,
  ARRIVAL_READY_SECONDS,
  INITIAL_LINEUP,
  OPENING_FIRST_CART_SECONDS,
  OPENING_CART_GAP_SECONDS,
  spillAmount,
} from "./management.ts";
import {
  resolveMove,
  resolveVehicleMove,
  vehicleObstacleDistance,
  obstacleDistance,
  segmentHitsVehicle,
  VEHICLE_RADIUS,
} from "./collisions.ts";
import type { CollectorBounds, Obstacle, VehiclePose } from "./collisions.ts";

const seeded = (seed = 7) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const advance = (sim: RangeManagement, seconds: number) => {
  const shots = [];
  for (let i = 0; i < seconds * 20; i++) shots.push(...sim.update(0.05));
  return shots;
};
/** Run the opening until every booked golfer has arrived at a bay. */
const open = (sim: RangeManagement) => {
  while (sim.golfers.some((g) => g.status !== "playing")) sim.update(0.05);
};

test("new shifts start with 50 balls available", () => {
  const sim = new RangeManagement(seeded());
  assert.equal(sim.reserve, 50);
  assert.equal(sim.supply, 50);
  assert.equal(sim.supplyPace, 1);
});

test("more supply produces faster shots, and replenishment speeds the next interval", () => {
  const play = (supply: number) => {
    const sim = new RangeManagement(seeded());
    open(sim);
    sim.reserve = supply;
    for (const golfer of sim.golfers.slice(1)) {
      golfer.status = "empty";
      golfer.until = 1e9;
    }
    sim.golfers[0].nextShot = sim.time;
    return sim;
  };
  const low = play(10), normal = play(50), high = play(100);
  const lowShots = advance(low, 20).length;
  const normalShots = advance(normal, 20).length;
  const highShots = advance(high, 20).length;
  assert.ok(highShots > normalShots, `${highShots} high-supply shots vs ${normalShots} normal`);
  assert.ok(normalShots > lowShots, `${normalShots} normal shots vs ${lowShots} low-supply`);
  assert.ok(low.reserve > 0);
  assert.equal(low.waiting, 0);
  const golfer = low.golfers[0];
  golfer.nextShot = low.time;
  low.update(0);
  const slowInterval = golfer.nextShot - low.time;
  low.collect(75);
  low.unload();
  golfer.nextShot = low.time;
  low.update(0);
  assert.ok(golfer.nextShot - low.time < slowInterval);
  // Range upgrades still increase pace at the same supply level.
  low.reserve = 50;
  golfer.nextShot = low.time;
  low.update(0);
  const shortRangeInterval = golfer.nextShot - low.time;
  low.levels.range = 4;
  low.reserve = 50;
  golfer.nextShot = low.time;
  low.update(0);
  assert.ok(golfer.nextShot - low.time < shortRangeInterval);
});

test("supply pacing includes dispenser balls and remains bounded with abundant stock", () => {
  const sim = new RangeManagement(seeded());
  sim.reserve = 8;
  const depotOnlyPace = sim.supplyPace;
  sim.levels.dispensers = 1;
  sim.golfers.forEach(golfer => golfer.buffer = 6);
  assert.equal(sim.supply, 50);
  assert.equal(sim.supplyPace, 1);
  assert.ok(sim.supplyPace < depotOnlyPace);
  sim.reserve = 1e6;
  assert.equal(sim.supplyPace, 0.5);
});

test("sand slows carts by 30% only within the rotated, visible sand polygon", () => {
  const shortEnd = TEE.z + 100 * YARD, fullEnd = TEE.z + 300 * YARD;
  assert.equal(cartSpeedMultiplier({ x: -42, z: 20 }, shortEnd), 1);
  for (const trap of SAND_TRAPS) {
    assert.equal(cartSpeedMultiplier(trap, fullEnd), 0.7);
    assert.equal(cartSpeedMultiplier(trap, shortEnd), trap.targetZ < shortEnd - 18 ? 0.7 : 1);
    const cos = Math.cos(SAND_TRAP_ROTATION), sin = Math.sin(SAND_TRAP_ROTATION);
    for (const vertex of SAND_TRAP_OUTLINE) {
      const sample = (scale: number) => ({
        x: trap.x + (cos * vertex.x - sin * vertex.y) * scale,
        z: trap.z - (sin * vertex.x + cos * vertex.y) * scale,
      });
      assert.equal(cartSpeedMultiplier(sample(0.99), fullEnd), 0.7);
      assert.equal(cartSpeedMultiplier(sample(1.01), fullEnd), 1);
    }
  }
});

test("the roof beacon lights and rotates at capacity, stops below it, and follows hopper upgrades", () => {
  const cart = new THREE.Group();
  const original = new THREE.MeshStandardMaterial({ color: "#ffc530" });
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.064, 0.12), original);
  lens.name = "Beacon";
  lens.position.set(0, 2.17, -0.7);
  cart.add(lens);
  const beacon = new HopperBeacon(cart);
  assert.notEqual(lens.material, original);
  assert.equal(original.emissiveIntensity, 1);
  for (const capacity of [75, 100, 125, 150]) {
    beacon.setLoad(capacity - 1, capacity);
    assert.equal(beacon.rotor.visible, false);
    assert.equal(lens.material.emissiveIntensity, 0);
    beacon.setLoad(capacity, capacity);
    assert.equal(beacon.rotor.visible, true);
    assert.ok(lens.material.emissiveIntensity > 0);
    const angle = beacon.rotor.rotation.y;
    beacon.update(0.1);
    assert.notEqual(beacon.rotor.rotation.y, angle);
    const pausedAngle = beacon.rotor.rotation.y;
    beacon.update(0);
    assert.equal(beacon.rotor.rotation.y, pausedAngle);
    beacon.setLoad(Math.ceil(capacity / 2), capacity);
    beacon.update(0.1);
    assert.equal(beacon.rotor.visible, false);
    assert.equal(beacon.rotor.rotation.y, pausedAngle);
  }
  beacon.setLoad(75, 100);
  assert.equal(beacon.rotor.visible, false);
  beacon.setLoad(0, 75);
  assert.equal(beacon.rotor.visible, false);
});

test("golfers consume finite supply, stop when empty, and lose patience", () => {
  const sim = new RangeManagement(seeded());
  const shots = [];
  while (sim.reserve > 0 && sim.time < 300) shots.push(...advance(sim, 1));
  while (sim.waiting < GOLFER_COUNT && sim.time < 300) shots.push(...advance(sim, 1));
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
  assert.deepEqual(sim.unload(), { count: 30, bonus: 0 });
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
  open(sim);
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

test("golfer moods escalate before a walkout and recover when resupplied", () => {
  const sim = new RangeManagement(seeded());
  open(sim);
  const golfer = sim.golfers[0];
  assert.equal(getGolferMood(golfer), "happy");
  sim.reserve = 0;
  golfer.nextShot = sim.time;
  sim.update(0.05);
  assert.equal(getGolferMood(golfer), "waiting");
  golfer.patience = 34;
  assert.equal(getGolferMood(golfer), "mad");
  golfer.patience = 15;
  assert.equal(getGolferMood(golfer), "furious");
  assert.equal(golfer.status, "playing");
  golfer.patience = 0.01;
  sim.update(0.05);
  assert.equal(golfer.status, "leaving");
  assert.equal(getGolferMood(golfer), "furious");

  const waiting = sim.golfers[1];
  waiting.waiting = true;
  waiting.patience = 14;
  assert.equal(getGolferMood(waiting), "furious");
  waiting.nextShot = sim.time;
  sim.collect(75);
  sim.unload();
  assert.equal(getGolferMood(waiting), "mad");
  advance(sim, 30);
  assert.equal(getGolferMood(waiting), "happy");
});

test("vacated bays cool down for 15 seconds even at the highest rating", () => {
  const sim = new RangeManagement(seeded());
  open(sim);
  sim.reserve = 5000;
  sim.reputation = 100;
  const golfer = sim.golfers[0];
  golfer.waiting = true;
  golfer.patience = 0.01;
  sim.update(0.05);
  assert.equal(golfer.status, "leaving");
  sim.update(golfer.until - sim.time);
  assert.equal(golfer.status, "empty");
  const vacatedAt = sim.time;
  assert.equal(golfer.cooldownUntil, vacatedAt + BAY_COOLDOWN_SECONDS);
  assert.equal(golfer.until, golfer.cooldownUntil);
  assert.ok(sim.arrivalDelay() < BAY_COOLDOWN_SECONDS);
  // A shorter queue timer must never bypass the independent cooldown guard.
  golfer.until = sim.time;
  sim.update(BAY_COOLDOWN_SECONDS - 0.01);
  assert.equal(golfer.status, "empty");
  assert.equal(sim.arrivals, 0);
  sim.update(0.02);
  assert.equal(golfer.status, "playing");
  assert.equal(golfer.cooldownUntil, 0);
  assert.equal(sim.arrivals, 1);
});

test("cooldowns do not shorten a slower arrival queue or delay newly opened bays", () => {
  const sim = new RangeManagement(seeded());
  open(sim);
  sim.reserve = 5000;
  const golfer = sim.golfers[0];
  golfer.waiting = true;
  golfer.patience = 0.01;
  sim.update(0.05);
  sim.reputation = 40;
  const expectedDelay = sim.arrivalDelay();
  assert.ok(expectedDelay > BAY_COOLDOWN_SECONDS);
  sim.update(golfer.until - sim.time);
  assert.equal(golfer.until, sim.time + expectedDelay);
  sim.update(BAY_COOLDOWN_SECONDS);
  assert.equal(golfer.status, "empty");
  sim.update(golfer.until - sim.time);
  assert.equal(golfer.status, "playing");

  sim.cash = 10000;
  sim.buy("bays");
  const newBay = sim.golfers.at(-1)!;
  assert.equal(newBay.cooldownUntil, 0);
  sim.update(3.01);
  assert.equal(newBay.status, "playing");
});

test("the opening lineup drives in one bay at a time and is on the mats about fifteen seconds in", () => {
  const sim = new RangeManagement(seeded());
  assert.ok(sim.golfers.every((g) => g.status === "empty" && g.booked));
  assert.equal(sim.served, GOLFER_COUNT);
  assert.equal(sim.present.length, 0);
  // Farthest bay from the entrance first, each cart a random gap behind the last.
  const order = [...sim.golfers].sort((a, b) => a.until - b.until).map((g) => g.id);
  assert.deepEqual(order, [6, 5, 4, 3, 2, 1, 0]);
  const first = sim.golfers[6].until;
  assert.ok(first >= OPENING_FIRST_CART_SECONDS[0] && first <= OPENING_FIRST_CART_SECONDS[1]);
  for (let i = 1; i < order.length; i++) {
    const gap = sim.golfers[order[i]].until - sim.golfers[order[i - 1]].until;
    assert.ok(gap >= OPENING_CART_GAP_SECONDS[0] && gap <= OPENING_CART_GAP_SECONDS[1], `gap ${gap}`);
  }
  const ready = Math.max(...sim.golfers.map((g) => g.until)) + ARRIVAL_READY_SECONDS;
  assert.ok(ready >= 12.75 && ready <= 18.05, `last golfer ready at ${ready}s`);
  // The rating holds steady while the range waits for its lineup.
  while (sim.time + 0.05 < first) sim.update(0.05);
  assert.equal(sim.reputation, 60);
  assert.equal(sim.over, false);
  open(sim);
  assert.ok(sim.time < ready);
  assert.deepEqual(sim.golfers.map((g) => g.type), INITIAL_LINEUP);
  assert.ok(sim.golfers.every((g) => !g.booked));
  assert.equal(sim.arrivals, 0);
  assert.equal(sim.served, GOLFER_COUNT);
  assert.ok(sim.takeEvents().every((e) => e.kind !== "arrival"));
  assert.equal(sim.ballsHit, 0);
  // Exact bounds of the schedule.
  const earliest = new RangeManagement(() => 0), latest = new RangeManagement(() => 1);
  assert.ok(Math.abs(Math.max(...earliest.golfers.map((g) => g.until)) - (0.3 + 6 * 0.7)) < 1e-9);
  assert.ok(Math.abs(Math.max(...latest.golfers.map((g) => g.until)) - (0.8 + 6 * 1.5)) < 1e-9);
});

test("one golfer in ten is left-handed, rolled on arrival and kept through saves", () => {
  const lefties = new RangeManagement(() => 0.05);
  open(lefties);
  assert.ok(lefties.golfers.every((g) => g.leftHanded));
  let roll = 0.5;
  const sim = new RangeManagement(() => roll);
  open(sim);
  assert.ok(sim.golfers.every((g) => !g.leftHanded));
  let left = 0, total = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const trial = new RangeManagement(seeded(seed));
    open(trial);
    for (const g of trial.golfers) { total++; if (g.leftHanded) left++; }
  }
  const share = left / total;
  assert.ok(share > 0.07 && share < 0.13, `left-handed share ${share}`);
  // A replacement golfer rolls again on arrival.
  sim.reserve = 5000;
  const golfer = sim.golfers[0];
  golfer.waiting = true;
  golfer.patience = 0.01;
  advance(sim, WALKOUT_SECONDS + 2);
  assert.equal(golfer.status, "empty");
  roll = 0.05;
  advance(sim, 40);
  assert.equal(golfer.status, "playing");
  assert.equal(golfer.leftHanded, true);
  assert.ok(sim.golfers.slice(1).every((g) => !g.leftHanded));
  const copy = new RangeManagement();
  copy.restoreState(sim.exportState());
  assert.deepEqual(copy.golfers.map((g) => g.leftHanded), sim.golfers.map((g) => g.leftHanded));
  // Saves from before handedness existed load as seated right-handers.
  const legacy = JSON.parse(JSON.stringify(sim.exportState()));
  for (const g of legacy.golfers) { delete g.leftHanded; delete g.booked; }
  copy.restoreState(legacy);
  assert.ok(copy.golfers.every((g) => !g.leftHanded && !g.booked));
});

test("arriving golfers reach their bay before consuming supply or taking a shot", () => {
  const sim = new RangeManagement(seeded());
  sim.reserve = 5000;
  const golfer = sim.golfers[0];
  golfer.status = "empty";
  golfer.until = 0;
  sim.update(0.05);
  assert.equal(golfer.status, "playing");
  assert.equal(golfer.nextShot, sim.time + ARRIVAL_READY_SECONDS);
  const orders = advance(sim, ARRIVAL_READY_SECONDS - 0.1);
  assert.equal(orders.filter(order => order.golfer === golfer.id).length, 0);
  assert.equal(golfer.shots, 0);
  assert.equal(advance(sim, 0.2).filter(order => order.golfer === golfer.id).length, 1);
});

test("the shift ends at the final departure regardless of rating or remaining supply", () => {
  for (const reputation of [0, 100]) {
    const sim = new RangeManagement(seeded());
    open(sim);
    sim.reserve = 0;
    for (const golfer of sim.golfers) {
      golfer.waiting = true;
      golfer.nextShot = sim.time + 100;
      golfer.patience = 0.01;
    }
    sim.update(0.05);
    assert.ok(sim.golfers.every((g) => g.status === "leaving"));
    assert.equal(sim.over, false);
    sim.reserve = 5000;
    sim.reputation = reputation;
    sim.takeEvents();
    const departure = Math.max(...sim.golfers.map((g) => g.until));
    sim.update(WALKOUT_SECONDS - 0.01);
    assert.equal(sim.over, false);
    // Overshooting the departure must not add extra survival time.
    assert.deepEqual(sim.update(0.05), []);
    assert.ok(sim.golfers.every((g) => g.status === "empty"));
    assert.equal(sim.over, true);
    assert.equal(sim.score, departure);
    assert.ok(sim.golfers.every((g) => g.cooldownUntil === departure + BAY_COOLDOWN_SECONDS));
    assert.ok(sim.golfers.every((g) => g.until >= g.cooldownUntil));
    assert.deepEqual(sim.takeEvents(), [{ kind: "over" }]);
    const finished = sim.exportState();
    assert.deepEqual(sim.update(30), []);
    assert.deepEqual(sim.exportState(), finished);
    assert.deepEqual(sim.takeEvents(), []);
  }
});

test("a queued arrival cannot rescue the shift on the frame the final golfer leaves", () => {
  for (const lastBay of [0, GOLFER_COUNT - 1]) {
    const sim = new RangeManagement(seeded());
    open(sim);
    sim.reserve = 5000;
    sim.reputation = 100;
    sim.takeEvents();
    for (const golfer of sim.golfers) {
      golfer.status = "empty";
      golfer.until = sim.time + 0.025;
    }
    sim.golfers[lastBay].status = "leaving";
    const departure = sim.golfers[lastBay].until;
    sim.update(0.05);
    assert.equal(sim.over, true);
    assert.equal(sim.score, departure);
    assert.equal(sim.arrivals, 0);
    assert.deepEqual(sim.takeEvents(), [{ kind: "over" }]);
  }
});

test("one remaining golfer keeps the shift running", () => {
  const sim = new RangeManagement(seeded());
  open(sim);
  for (const golfer of sim.golfers) {
    golfer.status = "empty";
    golfer.until = sim.time + 100;
  }
  sim.golfers[0].status = "playing";
  sim.golfers[0].nextShot = sim.time + 100;
  sim.reputation = 0;
  const before = sim.score;
  sim.update(1);
  assert.equal(sim.over, false);
  assert.equal(sim.score, before + 1);
});

test("survival score rewards longer shifts independently of earnings and survives loading", () => {
  const shorter = new RangeManagement(), longer = new RangeManagement();
  shorter.time = 60;
  shorter.earned = 5000;
  longer.time = 120;
  longer.earned = 1;
  assert.equal(shorter.score, 60);
  assert.equal(longer.score, 120);
  assert.ok(longer.score > shorter.score);
  shorter.restoreState(longer.exportState());
  assert.equal(shorter.score, longer.score);
});

test("an empty legacy shift ends without advancing its clock or admitting queued golfers", () => {
  const sim = new RangeManagement(seeded());
  open(sim);
  const legacy = { ...sim.exportState(), time: 123, reputation: 100, emptyFor: 29 };
  for (const golfer of legacy.golfers) {
    golfer.status = "empty";
    golfer.until = 0;
  }
  sim.restoreState(legacy);
  sim.takeEvents();
  sim.update(0.05);
  assert.equal(sim.over, true);
  assert.equal(sim.score, 123);
  assert.equal(sim.arrivals, 0);
  assert.deepEqual(sim.takeEvents(), [{ kind: "over" }]);
});

test("shots pay, streaks tip, and upgrades cost cash and change the cart", () => {
  const sim = new RangeManagement(seeded());
  sim.reserve = 200;
  advance(sim, 100);
  assert.ok(sim.cash > STARTING_CASH);
  assert.ok(sim.tips > 0);
  assert.ok(Math.abs(sim.earned - (sim.cash - STARTING_CASH)) < 1e-6);
  assert.equal(sim.buy("helper"), "poor");
  sim.cash = 1000;
  assert.equal(sim.hopperCapacity, 75);
  assert.equal(sim.buy("hopper"), "ok");
  assert.equal(sim.levels.hopper, 1);
  assert.equal(sim.hopperCapacity, 100);
  sim.collect(200);
  assert.equal(sim.hopper, 100);
  assert.equal(sim.buy("hopper"), "ok");
  assert.equal(sim.hopperCapacity, 125);
  assert.equal(sim.buy("hopper"), "ok");
  assert.equal(sim.hopperCapacity, 150);
  assert.equal(sim.buy("hopper"), "maxed");
  assert.equal(sim.levels.hopper, 3);
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
  assert.equal(HOPPER_CAPACITY, 75);
  sim.collect(75);
  assert.equal(sim.collect(10), 0);
  assert.equal(sim.spill("obstacle"), 38);
  assert.equal(sim.spill("ball"), 6);
  assert.equal(sim.hopper + sim.spilled, 75);
  sim.unload();
  assert.equal(sim.returned + sim.spilled, 75);
  sim.cash = 1000;
  sim.buy("bumper");
  sim.buy("bumper");
  sim.buy("cage");
  sim.buy("cage");
  sim.collect(75);
  assert.equal(sim.spill("obstacle"), 12);
  assert.equal(sim.spill("ball"), 0);
});

test("delivering a completely full hopper pays a bonus, and the bar moves with each hopper tier", () => {
  const sim = new RangeManagement(seeded());
  const cash = sim.cash, earned = sim.earned;
  sim.collect(HOPPER_CAPACITY - 1);
  assert.deepEqual(sim.unload(), { count: HOPPER_CAPACITY - 1, bonus: 0 });
  assert.equal(sim.cash, cash);
  assert.equal(sim.fullLoads, 0);
  sim.collect(500);
  assert.equal(sim.hopper, HOPPER_CAPACITY);
  assert.deepEqual(sim.unload(), { count: HOPPER_CAPACITY, bonus: FULL_LOAD_BONUS });
  assert.equal(sim.cash, cash + FULL_LOAD_BONUS);
  assert.equal(sim.earned, earned + FULL_LOAD_BONUS);
  assert.equal(sim.bonuses, FULL_LOAD_BONUS);
  assert.equal(sim.fullLoads, 1);
  assert.equal(sim.deliveries, 2);
  assert.deepEqual(sim.unload(), { count: 0, bonus: 0 });
  sim.cash = 1000;
  assert.equal(sim.buy("hopper"), "ok");
  sim.collect(HOPPER_CAPACITY);
  assert.deepEqual(sim.unload(), { count: HOPPER_CAPACITY, bonus: 0 });
  sim.collect(100);
  assert.deepEqual(sim.unload(), { count: 100, bonus: FULL_LOAD_BONUS });
  assert.equal(sim.bonuses, FULL_LOAD_BONUS * 2);
  assert.equal(sim.fullLoads, 2);
  const saved = sim.exportState();
  const copy = new RangeManagement();
  copy.restoreState(saved);
  assert.equal(copy.bonuses, FULL_LOAD_BONUS * 2);
  assert.equal(copy.fullLoads, 2);
  const { bonuses: _b, fullLoads: _f, ...legacy } = saved;
  copy.restoreState(legacy);
  assert.equal(copy.bonuses, 0);
  assert.equal(copy.fullLoads, 0);
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

const collectorBounds = (halfWidth: number): CollectorBounds => ({
  minX: -halfWidth, maxX: halfWidth, minZ: 1.84, maxZ: 2.24,
});
const localToWorld = (cart: VehiclePose, x: number, z: number) => ({
  x: cart.x + Math.cos(cart.angle) * x + Math.sin(cart.angle) * z,
  z: cart.z - Math.sin(cart.angle) * x + Math.cos(cart.angle) * z,
});

test("the full collector width collides with trees at every tier and heading", () => {
  for (const halfWidth of [1.425, 3.253, 4.395]) {
    for (const angle of [0, Math.PI / 2, Math.PI, -0.65]) {
      for (const side of [-1, 1]) {
        const previous = { x: 10, z: 20, angle };
        const tree: Obstacle = {
          id: "tree", name: "Tree", kind: "circle", radius: 0.4,
          ...localToWorld(previous, side * (halfWidth - 0.05), 2.8),
        };
        const bounds = collectorBounds(halfWidth);
        const next = { ...localToWorld(previous, 0, 0.3), angle };
        // These impacts are entirely outside the original body collider.
        assert.equal(resolveMove(previous, next, [tree]).hit, undefined);
        const result = resolveVehicleMove(previous, next, [tree], bounds);
        assert.equal(result.hit?.id, tree.id);
        assert.ok(vehicleObstacleDistance({ ...result.position, angle: result.angle }, tree, bounds) >= -1e-8);
      }
    }
  }
});

test("collector upgrades change collisions without blocking clear space beside or behind the cart", () => {
  const cart = { x: 0, z: 0, angle: 0 };
  const tree: Obstacle = { id: "tree", name: "Tree", kind: "circle", x: 4.2, z: 2.04, radius: 0.2 };
  assert.equal(resolveVehicleMove(cart, cart, [tree], collectorBounds(1.425)).hit, undefined);
  assert.equal(resolveVehicleMove(cart, cart, [tree], collectorBounds(3.253)).hit, undefined);
  assert.equal(resolveVehicleMove(cart, cart, [tree], collectorBounds(4.395)).hit?.id, tree.id);
  for (const clear of [{ ...tree, x: 4.7 }, { ...tree, z: 0 }, { ...tree, z: -2.04 }])
    assert.equal(resolveVehicleMove(cart, cart, [clear], collectorBounds(4.395)).hit, undefined);
});

test("collector wings stop against box obstacles while rotated", () => {
  for (const angle of [0, Math.PI / 2, 0.65]) {
    for (const side of [-1, 1]) {
      const previous = { x: 10, z: 20, angle };
      const point = localToWorld(previous, side * 4.2, 2.6);
      const fence: Obstacle = {
        id: "fence", name: "Fence", kind: "box",
        minX: point.x - 0.15, maxX: point.x + 0.15,
        minZ: point.z - 0.15, maxZ: point.z + 0.15,
      };
      const bounds = collectorBounds(4.395);
      const result = resolveVehicleMove(previous, { ...localToWorld(previous, 0, 0.35), angle }, [fence], bounds);
      assert.equal(result.hit?.id, fence.id);
      assert.ok(vehicleObstacleDistance({ ...result.position, angle: result.angle }, fence, bounds) >= -1e-8);
    }
  }
});

test("collector sweeps catch fast travel and wings swinging through a tree", () => {
  const bounds = collectorBounds(4.395);
  const previous = { x: 0, z: 0, angle: 0 };
  const tree: Obstacle = { id: "tree", name: "Tree", kind: "circle", x: 4.2, z: 4, radius: 0.15 };
  const travel = resolveVehicleMove(previous, { x: 0, z: 5, angle: 0 }, [tree], bounds);
  assert.equal(travel.hit?.id, tree.id);
  assert.ok(travel.position.z < 2);
  assert.ok(vehicleObstacleDistance({ ...travel.position, angle: travel.angle }, tree, bounds) >= -1e-8);

  const turnTree: Obstacle = { ...tree, ...localToWorld({ ...previous, angle: Math.PI / 4 }, 4.2, 2.04) };
  const next = { ...previous, angle: Math.PI / 2 };
  assert.ok(vehicleObstacleDistance(previous, turnTree, bounds) > 0);
  assert.ok(vehicleObstacleDistance(next, turnTree, bounds) > 0);
  const turn = resolveVehicleMove(previous, next, [turnTree], bounds);
  assert.equal(turn.hit?.id, turnTree.id);
  assert.ok(turn.angle < next.angle);
  assert.ok(vehicleObstacleDistance({ ...turn.position, angle: turn.angle }, turnTree, bounds) >= -1e-8);
});

test("wing contact stays latched until the collector clears the obstacle", () => {
  const cart = { x: 0, z: 0, angle: 0 };
  const bounds = collectorBounds(4.395);
  const tree: Obstacle = { id: "tree", name: "Tree", kind: "circle", x: 4.2, z: 2.04, radius: 0.4 };
  const result = resolveVehicleMove(cart, cart, [tree], bounds);
  const resolved = { ...result.position, angle: result.angle };
  assert.ok(obstacleDistance(resolved, tree) > VEHICLE_RADIUS + 0.75);
  assert.ok(vehicleObstacleDistance(resolved, tree, bounds) < 0.75);
  assert.ok(vehicleObstacleDistance({ ...resolved, x: resolved.x - 1 }, tree, bounds) > 0.75);
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
