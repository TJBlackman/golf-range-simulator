import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

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

// Use real Three actions and quaternion tracks: paused and clamped actions still
// evaluate these tracks if the scene unnecessarily updates their mixer.
function swingClip() {
  const tracks = ["LeftHip", "RightHip", "LeftKnee", "RightKnee"].map(name => {
    const rest = name.includes("Hip") ? -0.14 : 0.25;
    const values = [rest, rest + 0.5, rest + 0.1].flatMap(angle =>
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray());
    return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1, 2], values);
  });
  return new THREE.AnimationClip("Swing", 2, tracks);
}

function harness() {
  const world = Object.create(Scene.prototype);
  Object.assign(world, {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    tractor: new THREE.Group(), tractorAngle: 0, tractorSpeed: 0,
    rangeYards: 100, rangeEnd: 120, elapsed: 10,
    cameraMode: "chase", cameraTarget: new THREE.Vector3(),
    targetCamera: new THREE.Vector3(), targetLook: new THREE.Vector3(),
    cameraShakeOffset: new THREE.Vector3(), shakeTime: 0,
    lookYaw: 0, lookPitch: 0, lookZoom: 1, looking: false, lookHoldUntil: 0,
    golfers: [], animals: [], golfCarts: [], airShots: [],
    sun: { target: new THREE.Object3D(), position: new THREE.Vector3() },
    hopperBeacon: { update() {} }, environment: { update() {} }, renderer: { render() {} },
    assets: new Map([["golfer", { animations: [swingClip()] }]]),
    asset(id, x, z, scale = 1) {
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      group.scale.setScalar(scale);
      if (id === "golfer") for (const name of ["LeftHip", "RightHip", "LeftKnee", "RightKnee"]) {
        const joint = new THREE.Object3D();
        joint.name = name;
        group.add(joint);
      }
      this.scene.add(group);
      return group;
    },
    moodIcon() { return new THREE.Sprite(new THREE.SpriteMaterial()); },
    replaceGolferLabel(npc, replacement) { npc.mood = replacement; },
    createVisitorCart(npc) {
      return { npc, park: new THREE.Vector3(0, 0.02, -4.6), phase: "parked" };
    },
    updateGolfCarts() {}, departGolfCart() {},
  });
  world.addBay(0);
  const npc = world.golfers[0];
  let evaluations = 0, resets = 0;
  const update = npc.mixer.update.bind(npc.mixer);
  npc.mixer.update = dt => { evaluations++; return update(dt); };
  const reset = npc.swing.reset.bind(npc.swing);
  npc.swing.reset = () => { resets++; return reset(); };
  return { world, npc, evaluations: () => evaluations, resets: () => resets };
}

function state(status = "playing", waiting = false) {
  return {
    id: 0, type: "casual", status, waiting, leftHanded: false,
    patience: 100, reactionRemaining: 1, cooldownUntil: 0,
  };
}

function assertAddress(npc) {
  for (const hip of npc.hips) assert.ok(Math.abs(hip.rotation.x + 0.14) < 1e-6);
  for (const knee of npc.knees) assert.ok(Math.abs(knee.rotation.x - 0.25) < 1e-6);
}

test("new, hidden, and paused golfers apply address once and skip idle mixer evaluations", () => {
  const { world, npc, evaluations } = harness();
  assertAddress(npc);
  for (let frame = 0; frame < 600; frame++) world.update(1 / 30);
  assert.equal(evaluations(), 0);
  world.syncGolfers([state()], world.elapsed);
  assert.equal(evaluations(), 1);
  assertAddress(npc);
  npc.object.visible = true;
  for (let frame = 0; frame < 600; frame++) world.update(1 / 30);
  assert.equal(evaluations(), 1);
  assertAddress(npc);
});

test("waiting resets address once, supplied golfers restart, and LoopOnce finishes once", () => {
  const { world, npc, evaluations, resets } = harness();
  world.syncGolfers([state()], world.elapsed);
  npc.object.visible = true;
  world.launchGolferShot({ golfer: 0, number: 1, lost: false }, 0);
  world.update(0.2);
  assert.ok(npc.swing.time > 0);
  world.syncGolfers([state("playing", true)], world.elapsed);
  assert.equal(npc.swing.time, 0);
  assert.equal(npc.swing.paused, true);
  assertAddress(npc);
  const idleEvaluations = evaluations(), idleResets = resets();
  for (let frame = 0; frame < 600; frame++) {
    world.syncGolfers([state("playing", true)], world.elapsed);
    world.update(1 / 30);
  }
  assert.equal(evaluations(), idleEvaluations);
  assert.equal(resets(), idleResets);
  assertAddress(npc);

  world.syncGolfers([state()], world.elapsed);
  world.launchGolferShot({ golfer: 0, number: 2, lost: false }, 0);
  assert.equal(npc.swing.paused, false);
  assert.equal(world.airShots.length, 2);
  let finished = 0;
  npc.mixer.addEventListener("finished", () => finished++);
  for (let frame = 0; frame < 120; frame++) world.update(1 / 30);
  assert.equal(finished, 1);
  assert.equal(npc.swing.time, 2);
  assert.equal(npc.swing.paused, true);
  const finishedEvaluations = evaluations();
  for (let frame = 0; frame < 600; frame++) world.update(1 / 30);
  assert.equal(evaluations(), finishedEvaluations);
  assert.equal(finished, 1);
});

test("paused frames skip active mixer work without changing the live swing", () => {
  const { world, npc, evaluations } = harness();
  world.syncGolfers([state()], world.elapsed);
  npc.object.visible = true;
  world.launchGolferShot({ golfer: 0, number: 1, lost: false }, 0);
  world.update(0.2);
  const time = npc.swing.time, pose = npc.hips[0].quaternion.toArray(), calls = evaluations();
  for (let frame = 0; frame < 600; frame++) world.update(0);
  assert.equal(evaluations(), calls);
  assert.equal(npc.swing.time, time);
  assert.deepEqual(npc.hips[0].quaternion.toArray(), pose);
  // Visibility alone must not freeze an action that still has timing to advance.
  npc.object.visible = false;
  world.update(0.2);
  assert.ok(npc.swing.time > time);
});

test("leaving preserves the authored address rest and manual gait without idle track evaluation", () => {
  const { world, npc, evaluations, resets } = harness();
  world.syncGolfers([state()], world.elapsed);
  npc.object.visible = true;
  world.launchGolferShot({ golfer: 0, number: 1, lost: false }, 0);
  world.update(0.2);
  world.syncGolfers([state("leaving")], world.elapsed);
  assertAddress(npc);
  const walk = npc.walk, calls = evaluations(), resetCalls = resets();
  for (let frame = 0; frame < 10; frame++) {
    world.syncGolfers([state("leaving")], world.elapsed);
    world.update(1 / 30);
    const seconds = world.elapsed - walk.start;
    assert.ok(Math.abs(npc.hips[0].userData.gaitRestX + 0.14) < 1e-6);
    assert.ok(Math.abs(npc.hips[0].rotation.x - (-0.14 + Math.sin(seconds * 8) * 0.27)) < 1e-6);
    assert.ok(Math.abs(npc.knees[0].rotation.x - (0.25 + Math.max(0, Math.sin(seconds * 8)) * 0.32)) < 1e-6);
  }
  assert.equal(evaluations(), calls);
  assert.equal(resets(), resetCalls);
  world.update(walk.duration);
  assert.equal(npc.walk, undefined);
  assert.equal(npc.object.visible, false);
  assertAddress(npc);
});
