import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";
import { CLUBS, TEE, simulateShot } from "./physics.ts";
import { HOPPER_CAPACITIES } from "./management.ts";

// Load the real scene through Vite so its asset globs work in Node. The harness
// exercises scene behavior without constructing a canvas or a WebGL renderer.
const vite = await createServer({
  configFile: false,
  logLevel: "error",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, ws: false },
  appType: "custom",
});
let Scene;
try {
  ({ RangeScene: Scene } = await vite.ssrLoadModule("/src/scene.ts"));
} finally {
  await vite.close();
}

function harness() {
  const world = Object.create(Scene.prototype);
  const source = new THREE.Group();
  source.add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshStandardMaterial()));
  Object.assign(world, {
    scene: new THREE.Scene(),
    tractor: new THREE.Group(),
    assets: new Map([["golf-ball", { scene: source, animations: [] }]]),
    balls: [], airShots: [], bouncingBalls: [],
    ballDummy: new THREE.Object3D(),
    flightSample: { x: 0, y: 0, z: 0 },
    elapsed: 10, rangeEnd: TEE.z + 100, tractorAngle: 0,
    cart: { capacity: HOPPER_CAPACITIES[0] },
    hopperBeacon: { setLoad() {} },
  });
  world.tractor.position.set(500, 0, 500);
  world.buildBalls();
  world.balls.length = 0;
  world.syncBalls();
  world.fieldBalls.instanceMatrix.clearUpdateRanges();
  return world;
}

function positionAt(mesh: THREE.InstancedMesh, index: number) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

test("collection removes field instances and landings reuse collected storage", () => {
  const world = harness();
  world.addFieldBall({ x: 0, y: 0, z: 22 });
  world.addFieldBall({ x: 10, y: 0, z: 25 });
  const collectedSlot = world.balls[0];
  assert.equal(world.pickup(new THREE.Vector3(0, 0, 20), 0, 1.6, 1), 1);
  world.syncBalls();
  assert.equal(world.fieldBalls.count, 1);
  assert.equal(positionAt(world.fieldBalls, 0).x, 10);
  world.addFieldBall({ x: 3, y: 0, z: 30 });
  assert.equal(world.balls.length, 2);
  assert.equal(world.balls[0], collectedSlot);
  assert.equal(world.fieldBalls.count, 2);
  assert.equal(positionAt(world.fieldBalls, 0).x, 3);
  assert.equal(positionAt(world.fieldBalls, 1).x, 10);
});

test("cooldown, uncollectible balls, and limited hopper room retain collection rules", () => {
  const world = harness();
  world.addFieldBall({ x: 0, y: 0, z: 22 }, 0.8);
  world.addFieldBall({ x: 0.5, y: 0, z: 22 }, 0, false);
  world.addFieldBall({ x: -0.5, y: 0, z: 22 });
  world.addFieldBall({ x: 0.75, y: 0, z: 22 });
  const picker = new THREE.Vector3(0, 0, 20);
  assert.equal(world.pickup(picker, 0, 1.6, 1), 1);
  assert.equal(world.balls[0].active, true);
  assert.equal(world.balls[1].active, true);
  assert.equal(world.balls[3].active, true);
  world.elapsed += 0.81;
  assert.equal(world.pickup(picker, 0, 1.6, 10), 2);
  world.syncBalls();
  assert.equal(world.fieldBalls.count, 1);
  assert.equal(world.balls[1].pickableAt, Infinity);
});

test("unchanged field syncs upload nothing and changed spans retain pending writes", () => {
  const world = harness();
  world.addFieldBall({ x: 1 / 3, y: 0, z: 25.01 });
  world.fieldBalls.instanceMatrix.clearUpdateRanges();
  const version = world.fieldBalls.instanceMatrix.version;
  world.syncBalls();
  world.syncBalls();
  assert.equal(world.fieldBalls.instanceMatrix.version, version);
  assert.equal(world.fieldBalls.instanceMatrix.updateRanges.length, 0);
  world.addFieldBall({ x: 4, y: 0, z: 30 });
  assert.deepEqual(world.fieldBalls.instanceMatrix.updateRanges, [{ start: 16, count: 16 }]);
  world.balls[0].position.x = 2;
  world.syncBalls();
  assert.ok(world.fieldBalls.instanceMatrix.updateRanges.some(r => r.start === 0 && r.count >= 16));
  assert.ok(world.fieldBalls.instanceMatrix.updateRanges.some(r => r.start <= 16 && r.start + r.count >= 32));
  assert.equal(positionAt(world.fieldBalls, 0).x, 2);
  assert.equal(positionAt(world.fieldBalls, 1).x, 4);
});

test("hopper loads reveal a fixed stack without rewriting matrices or an empty bound", () => {
  const world = harness();
  const version = world.hopperBalls.instanceMatrix.version;
  const matrices = world.hopperBalls.instanceMatrix.array.slice();
  const loads: number[][] = [];
  world.hopperBeacon.setLoad = (count: number, capacity: number) => loads.push([count, capacity]);
  for (const count of [75, 12, 0, 75, 150, 200]) {
    world.setHopper(count);
    assert.equal(world.hopperBalls.count, Math.min(count, Math.max(...HOPPER_CAPACITIES)));
  }
  assert.equal(world.hopperBalls.instanceMatrix.version, version);
  assert.deepEqual(world.hopperBalls.instanceMatrix.array, matrices);
  assert.ok(world.hopperBalls.boundingSphere.radius > 0);
  world.cart.capacity = 150;
  world.setHopper(150);
  assert.deepEqual(loads.at(-1), [150, 150]);
});

test("large field and airborne inventories grow instance buffers without losing balls", () => {
  const world = harness();
  for (let i = 0; i < 2100; i++) world.balls.push({
    position: new THREE.Vector3(i / 100, 0.07, 40), active: true,
  });
  const oldAttribute = world.fieldBalls.instanceMatrix;
  let releases = 0;
  world.fieldBalls.addEventListener("dispose", () => releases++);
  world.syncBalls();
  assert.equal(world.balls.length, 2100);
  assert.equal(world.fieldBalls.count, 2100);
  assert.ok(world.fieldBalls.instanceMatrix.count >= 2100);
  assert.notEqual(world.fieldBalls.instanceMatrix, oldAttribute);
  assert.equal(releases, 1);
  assert.equal(positionAt(world.fieldBalls, 2099).x, Math.fround(20.99));
  for (let i = 0; i < 900; i++) world.bouncingBalls.push({
    position: new THREE.Vector3(i / 100, 1, 30), velocity: new THREE.Vector3(),
  });
  world.syncFlyingBalls();
  assert.equal(world.flyingBalls.count, 900);
  assert.ok(world.flyingBalls.instanceMatrix.count >= 900);
  assert.equal(positionAt(world.flyingBalls, 899).x, Math.fround(8.99));
});

test("simultaneous flight and bounce landings sync once and preserve every ball", () => {
  const world = harness();
  const shot = simulateShot({ club: CLUBS[0], power: 0.3, aim: 0, shape: "straight", wind: 0 });
  for (let i = 0; i < 3; i++) {
    const trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(TEE.x, TEE.y, TEE.z),
      new THREE.Vector3(shot.end.x, shot.end.y, shot.end.z),
    ]), new THREE.LineBasicMaterial());
    world.scene.add(trail);
    world.airShots.push({ shot, time: shot.duration, point: { ...shot.end }, trail });
  }
  world.bouncingBalls.push({ position: new THREE.Vector3(2, 0.06, 30), velocity: new THREE.Vector3() });
  const original = world.syncBalls.bind(world);
  let syncs = 0;
  world.syncBalls = () => { syncs++; original(); };
  assert.equal(world.updateFlights(0), 0);
  assert.equal(syncs, 1);
  assert.equal(world.airShots.length, 0);
  assert.equal(world.bouncingBalls.length, 0);
  assert.equal(world.fieldBalls.count, 4);
  assert.equal(world.balls.filter(b => b.active).length, 4);
  assert.ok(world.balls.some(b => b.pickableAt === world.elapsed + 0.8));
  const version = world.flyingBalls.instanceMatrix.version;
  world.updateFlights(1 / 30);
  assert.equal(world.flyingBalls.instanceMatrix.version, version);
  assert.equal(syncs, 1);
});

test("reused flight sample keeps swept cart collisions intact", () => {
  const world = harness();
  world.tractor.position.set(0, 0, 20);
  const shot = {
    carry: 0, total: 0, apex: 2, duration: 1, speed: 10,
    landing: { x: 0, y: 0, z: 30 }, end: { x: 0, y: 0, z: 30 },
    points: [
      { x: 0, y: 1.2, z: 18, t: 0 },
      { x: 0, y: 1.2, z: 22, t: 1 },
    ],
  };
  const point = { x: 0, y: 1.2, z: 18 };
  const trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 1.2, 18), new THREE.Vector3(0, 1.2, 22),
  ]), new THREE.LineBasicMaterial());
  world.airShots.push({ shot, time: 0, point, trail });
  assert.equal(world.updateFlights(0.5 / 1.7), 1);
  assert.equal(world.airShots.length, 0);
  assert.equal(world.bouncingBalls.length, 1);
  assert.equal(world.fieldBalls.count, 0);
});
