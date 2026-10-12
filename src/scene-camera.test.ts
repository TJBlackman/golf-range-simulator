import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";
import { BAY_COUNTS } from "./management.ts";

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

// Run the real camera update without constructing WebGL or unrelated actors.
function harness() {
  const world = Object.create(Scene.prototype);
  Object.assign(world, {
    camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene(),
    tractor: new THREE.Group(), tractorAngle: 0, tractorSpeed: 0,
    rangeYards: 100, rangeEnd: 120, elapsed: 10,
    cameraMode: "chase", cameraTarget: new THREE.Vector3(-42, 0.8, 26),
    targetCamera: new THREE.Vector3(), targetLook: new THREE.Vector3(),
    cameraShakeOffset: new THREE.Vector3(), shakeTime: 0,
    lookYaw: 0, lookPitch: 0, lookZoom: 1, looking: false, lookHoldUntil: 0,
    golfers: [], animals: [], golfCarts: [],
    sun: { target: new THREE.Object3D(), position: new THREE.Vector3() },
    hopperBeacon: { update() {} }, environment: { update() {} }, renderer: { render() {} },
    updateWalks() {}, updateGolfCarts() {},
    latchedCollisions: new Set(),
  });
  world.tractor.position.set(-42, 0.03, 20);
  world.camera.position.set(-38, 4.4, 8);
  world.camera.lookAt(world.cameraTarget);
  return world;
}

function assertPoseClose(actual, expected, tolerance = 1e-11) {
  assert.ok(actual.camera.position.distanceTo(expected.camera.position) < tolerance);
  assert.ok(actual.cameraTarget.distanceTo(expected.cameraTarget) < tolerance);
  for (const key of ["x", "y", "z", "w"])
    assert.ok(Math.abs(actual.camera.quaternion[key] - expected.camera.quaternion[key]) < tolerance);
}

test("paused shake frames preserve position, target, and orientation exactly", () => {
  const world = harness();
  world.spillBalls(0, "obstacle");
  world.update(1 / 30);
  const position = world.camera.position.toArray();
  const target = world.cameraTarget.toArray();
  const orientation = world.camera.quaternion.toArray();
  for (let i = 0; i < 1000; i++) world.update(0);
  assert.deepEqual(world.camera.position.toArray(), position);
  assert.deepEqual(world.cameraTarget.toArray(), target);
  assert.deepEqual(world.camera.quaternion.toArray(), orientation);
});

test("shake stays bounded at low and high frame rates and leaves no follow drift", () => {
  for (const step of [1 / 30, 1 / 144, 1 / 1000]) {
    const shaken = harness(), steady = harness();
    shaken.spillBalls(0, "obstacle");
    for (let i = 0; i < Math.ceil(1 / step); i++) {
      shaken.update(step);
      steady.update(step);
      assert.ok(Math.abs(shaken.camera.position.x - steady.camera.position.x) <= 0.105 + 1e-11);
      assert.ok(Math.abs(shaken.camera.position.y - steady.camera.position.y) <= 0.07 + 1e-11);
      assert.equal(shaken.camera.position.z, steady.camera.position.z);
    }
    assertPoseClose(shaken, steady);
  }
});

test("resuming a paused shake follows the same camera path through look and recovery", () => {
  const paused = harness(), continuous = harness();
  for (const world of [paused, continuous]) {
    world.spillBalls(0, "obstacle");
    world.orbit(30, -20);
    world.zoomBy(100);
    world.update(1 / 30);
    world.tractor.position.set(-30, 0.03, 35);
  }
  const beforePause = paused.camera.position.clone();
  for (let i = 0; i < 100; i++) paused.update(0);
  assert.equal(paused.camera.position.distanceTo(beforePause), 0);
  for (let i = 0; i < 20; i++) {
    if (i === 4) {
      paused.recover();
      continuous.recover();
    }
    if (i === 12) paused.cameraMode = continuous.cameraMode = "overview";
    paused.update(1 / 30);
    continuous.update(1 / 30);
    assertPoseClose(paused, continuous);
  }
});

test("restoring an authored camera pose clears old shake and eases from the saved pose", () => {
  const world = harness();
  Object.assign(world, {
    tractorWheels: [], tractorSteering: [], balls: [], airShots: [], bouncingBalls: [], hazards: [], obstacles: [],
    depots: [new THREE.Vector3(-48, 0, 7)],
    setBays() {}, setRange() {}, syncBalls() {}, syncFlyingBalls() {}, syncHazards() {},
  });
  for (let i = 0; i < BAY_COUNTS[0]; i++) world.golfers.push({
    object: new THREE.Group(), mood: new THREE.Group(), type: "casual", status: "empty",
    mixer: { update() {} },
    swing: {
      time: 0, paused: true, enabled: false, getEffectiveTimeScale() { return 1; },
      reset() { return this; }, setEffectiveTimeScale() { return this; }, play() { return this; },
    },
  });
  const saved = world.exportState();
  saved.cameraPosition = [-18, 7, 14];
  saved.cameraTarget = [-15, 1, 40];
  saved.lookYaw = 0.25;
  saved.lookHoldUntil = saved.elapsed + 2;
  world.spillBalls(0, "obstacle");
  world.update(1 / 30);
  world.restoreState(saved);
  assert.deepEqual(world.camera.position.toArray(), saved.cameraPosition);
  assert.deepEqual(world.cameraTarget.toArray(), saved.cameraTarget);
  for (let i = 0; i < 30; i++) world.update(0);
  assert.deepEqual(world.camera.position.toArray(), saved.cameraPosition);
  const control = harness();
  control.camera.position.fromArray(saved.cameraPosition);
  control.cameraTarget.fromArray(saved.cameraTarget);
  control.lookYaw = saved.lookYaw;
  control.lookHoldUntil = saved.lookHoldUntil;
  world.update(1 / 30);
  control.update(1 / 30);
  assertPoseClose(world, control);
});
