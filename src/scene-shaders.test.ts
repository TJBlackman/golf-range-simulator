import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";
import { HopperBeacon } from "./hopper-beacon.ts";

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

function harness(compile) {
  const world = Object.create(Scene.prototype);
  const scene = new THREE.Scene();
  const cart = new THREE.Group();
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshStandardMaterial());
  lens.name = "Beacon";
  cart.add(lens);
  scene.add(cart);
  Object.assign(world, {
    scene,
    camera: new THREE.PerspectiveCamera(),
    cart: { capacity: 75 },
    hopperBeacon: new HopperBeacon(cart),
    warmingShaders: false,
    renderer: { compileAsync: (...args) => compile(world, ...args) },
  });
  return world;
}

function spotlights(scene: THREE.Object3D) {
  const result: THREE.SpotLight[] = [];
  scene.traverseVisible(object => {
    if (object instanceof THREE.SpotLight) result.push(object);
  });
  return result;
}

test("warmup compiles the scene and an unrendered visitor under both beacon lighting variants", async () => {
  const calls = [];
  const world = harness(async (world, object, camera, target) => {
    assert.equal(world.warmingShaders, true);
    assert.equal(camera, world.camera);
    const lightingScene = target ?? object;
    calls.push({ object, target, spots: spotlights(lightingScene).length });
    if (object !== world.scene) {
      assert.equal(object.parent, null);
      assert.equal(world.scene.getObjectByName("ResortGolfCart"), undefined);
      const paint = object.getObjectByName("PaintedBody");
      assert.ok(paint instanceof THREE.Mesh);
      assert.ok(paint.material instanceof THREE.MeshPhysicalMaterial);
      assert.ok(paint.material.clearcoat > 0);
    }
    // Real compileAsync may yield for shader compilation. The guard must stay
    // active across asynchronous waits, not only during synchronous setup.
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(world.warmingShaders, true);
  });
  await world.warmShaders();
  assert.deepEqual(calls.map(call => call.spots), [0, 0, 1, 1]);
  assert.deepEqual(calls.map(call => call.target), [undefined, world.scene, undefined, world.scene]);
  assert.equal(calls[0].object, world.scene);
  assert.equal(calls[2].object, world.scene);
  assert.equal(calls[1].object, calls[3].object);
  assert.equal(world.shaderCart.object, calls[1].object);
  assert.equal(world.shaderCart.object.parent, null);
  assert.equal(world.warmingShaders, false);
  assert.equal(world.hopperBeacon.rotor.visible, false);
  assert.equal(spotlights(world.scene).length, 0);

  // Do not dispose the representative's per-cart materials after compiling:
  // Three would otherwise release their last references to warm programs.
  let disposals = 0;
  world.shaderCart.object.traverse(object => {
    if (object instanceof THREE.Mesh) object.material.addEventListener("dispose", () => disposals++);
  });
  await world.warmShaders();
  assert.equal(world.shaderCart.object, calls[1].object);
  assert.equal(disposals, 0);
});

test("a failed full-hopper compile always restores the beacon and loading-render guard", async () => {
  for (const failingCall of [3, 4]) {
    let count = 0;
    const failure = new Error("shader compile failed");
    const world = harness(async () => {
      if (++count === failingCall) throw failure;
    });
    await assert.rejects(world.warmShaders(), failure);
    assert.equal(world.warmingShaders, false);
    assert.equal(world.hopperBeacon.rotor.visible, false);
    assert.equal(spotlights(world.scene).length, 0);
    const lens = world.scene.getObjectByName("Beacon") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    assert.equal(lens.material.emissiveIntensity, 0);
  }
});
