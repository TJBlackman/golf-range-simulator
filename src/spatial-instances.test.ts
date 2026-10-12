import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";
import { createSpatialInstances, disposeSpatialInstances, INSTANCE_CELL_SIZE } from "./spatial-instances.ts";

const vite = await createServer({
  configFile: false,
  logLevel: "error",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, ws: false },
  appType: "custom",
});
let Scene, Environment, foliageBoundsPadding;
try {
  ({ RangeScene: Scene } = await vite.ssrLoadModule("/src/scene.ts"));
  ({ RangeEnvironment: Environment, foliageBoundsPadding } = await vite.ssrLoadModule("/src/environment.ts"));
} finally {
  await vite.close();
}

function matrixKey(matrix: THREE.Matrix4) {
  return matrix.elements.map(Math.fround).join(",");
}

function instanceMatrices(meshes: THREE.InstancedMesh[]) {
  const result: string[] = [];
  const matrix = new THREE.Matrix4();
  for (const mesh of meshes)
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      result.push(matrixKey(matrix));
    }
  return result.sort();
}

function sceneHarness() {
  const world = Object.create(Scene.prototype);
  const asset = (name: string) => {
    const root = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    material.name = name;
    const first = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 1), material);
    first.position.y = 4;
    const second = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
    second.position.y = 7;
    root.add(first, second);
    return { scene: root, animations: [] };
  };
  Object.assign(world, {
    scene: new THREE.Scene(),
    assets: new Map([
      ["tree-pine", asset("pine-leaves")],
      ["tree-broadleaf", asset("broadleaf-leaves")],
      ["fence-section", asset("fence")],
    ]),
    rangeEnd: 100,
    fenceMeshes: [], backTrees: [],
  });
  return world;
}

test("spatial chunks retain exact matrices/colors, share geometry, and cull distant cells", () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial();
  const placements = [
    new THREE.Matrix4().makeTranslation(0, 0, 20),
    new THREE.Matrix4().makeTranslation(5, 0, 30),
    new THREE.Matrix4().makeTranslation(-80, 0, -120),
    new THREE.Matrix4().makeTranslation(80, 0, -120),
    new THREE.Matrix4().makeTranslation(240, 0, 30),
  ];
  const colors = placements.map((_, i) => new THREE.Color().setHSL(i / 5, 0.5, 0.5));
  const chunks = createSpatialInstances(geometry, material, placements, { colors, castShadow: true });
  assert.deepEqual(instanceMatrices(chunks), placements.map(matrixKey).sort());
  assert.equal(chunks.length, 4);
  for (const chunk of chunks) {
    assert.equal(chunk.geometry, geometry);
    assert.equal(chunk.material, material);
    assert.equal(chunk.castShadow, true);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < chunk.count; i++) {
      chunk.getMatrixAt(i, matrix);
      chunk.getColorAt(i, color);
      const source = placements.findIndex((placement) => matrixKey(placement) === matrixKey(matrix));
      assert.deepEqual(color.toArray(), colors[source].toArray().map(Math.fround));
    }
  }
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  camera.lookAt(0, 0, 20);
  camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  assert.equal(chunks.filter(chunk => chunk.intersectsFrustum(frustum)).reduce((sum, chunk) => sum + chunk.count, 0), 2);
});

test("maximum foliage wind remains inside every scaled/rotated chunk bound", () => {
  const world = sceneHarness();
  const placements = [
    new THREE.Matrix4().compose(
      new THREE.Vector3(-70, 0, 30),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.3),
      new THREE.Vector3(4.3, 4.3, 4.3),
    ),
    new THREE.Matrix4().makeTranslation(-71, 0, 35),
    new THREE.Matrix4().makeTranslation(70, 0, 200),
  ];
  const chunks = world.instanceAsset("tree-pine", placements);
  assert.equal(chunks.length, 2);
  assert.deepEqual(instanceMatrices(chunks), placements.map(matrixKey).sort());
  assert.equal(new Set(chunks.map(chunk => chunk.geometry)).size, 1);
  for (const chunk of chunks) {
    const geometry = chunk.geometry;
    assert.ok(foliageBoundsPadding(geometry) > 0);
    const positions = geometry.getAttribute("position");
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < chunk.count; i++) {
      chunk.getMatrixAt(i, matrix);
      for (let j = 0; j < positions.count; j++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(positions, j);
        const height = Math.max(vertex.y - 0.5, 0);
        // Independent signs enclose all possible combinations of the two waves.
        for (const x of [-1, 1]) for (const z of [-1, 1]) {
          const deformed = vertex.clone().add(new THREE.Vector3(x * height * 0.016, 0, z * height * 0.01)).applyMatrix4(matrix);
          assert.ok(chunk.boundingSphere!.containsPoint(deformed));
        }
      }
    }
  }
});

test("all 12,000 grass blades preserve their original placements, tints, wind bounds and quality", () => {
  const environment = new Environment(new THREE.Scene(), {});
  environment.buildRough();
  const chunks: THREE.InstancedMesh[] = environment.grass;
  assert.equal(chunks.length, 14);
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.count, 0), 12000);
  assert.equal(new Set(chunks.map(chunk => chunk.geometry)).size, 1);
  assert.equal(new Set(chunks.map(chunk => chunk.material)).size, 1);
  const expected = new Map<string, number[]>();
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let seed = 719;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  for (let i = 0; i < 12000; i++) {
    const side = i % 2 ? 1 : -1;
    dummy.position.set(side * (56.5 + random() * 5), -0.06, 7 + random() * 295);
    dummy.rotation.y = random() * Math.PI;
    dummy.scale.setScalar(0.45 + random() * 0.9);
    dummy.updateMatrix();
    tint.setHSL(0.19 + random() * 0.05, 0.19 + random() * 0.14, 0.36 + random() * 0.22);
    expected.set(matrixKey(dummy.matrix), tint.toArray().map(Math.fround));
  }
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  for (const chunk of chunks) {
    assert.equal(chunk.receiveShadow, true);
    const positions = chunk.geometry.getAttribute("position");
    for (let i = 0; i < chunk.count; i++) {
      chunk.getMatrixAt(i, matrix);
      chunk.getColorAt(i, color);
      const key = matrixKey(matrix);
      assert.deepEqual(color.toArray(), expected.get(key));
      expected.delete(key);
      for (let j = 0; j < positions.count; j++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(positions, j);
        for (const sign of [-1, 1]) {
          const deformed = vertex.clone();
          deformed.x += sign * vertex.y * vertex.y * 0.17;
          deformed.applyMatrix4(matrix);
          assert.ok(chunk.boundingSphere!.containsPoint(deformed));
        }
      }
    }
  }
  assert.equal(expected.size, 0);
  environment.setQuality(false);
  assert.ok(chunks.every(chunk => !chunk.visible));
  environment.setQuality(true);
  assert.ok(chunks.every(chunk => chunk.visible));
});

test("range rebuilds release every old instance buffer and shared geometry once", () => {
  const world = sceneHarness();
  world.buildFences();
  world.buildBackTrees();
  const oldMeshes = [...world.fenceMeshes, ...world.backTrees];
  const geometries = new Set(oldMeshes.map(mesh => mesh.geometry));
  let instanceDisposals = 0, geometryDisposals = 0, materialDisposals = 0;
  oldMeshes.forEach(mesh => mesh.addEventListener("dispose", () => instanceDisposals++));
  geometries.forEach(geometry => geometry.addEventListener("dispose", () => geometryDisposals++));
  new Set(oldMeshes.map(mesh => mesh.material)).forEach(material => material.addEventListener("dispose", () => materialDisposals++));
  world.rangeEnd = 280;
  world.buildFences();
  world.buildBackTrees();
  assert.equal(instanceDisposals, oldMeshes.length);
  assert.equal(geometryDisposals, geometries.size);
  assert.equal(materialDisposals, 0);
  assert.ok(oldMeshes.every(mesh => mesh.parent === null));
  assert.equal(world.backTrees.reduce((sum, mesh) => sum + mesh.count, 0), 104);
  assert.equal(world.fenceMeshes.reduce((sum, mesh) => sum + mesh.count, 0), 2 * Math.ceil((280 - 6) / 3) + 37);
  assert.ok(world.fenceMeshes.length < 20);
  assert.ok(world.backTrees.length <= 16);
  disposeSpatialInstances(world.fenceMeshes);
  disposeSpatialInstances(world.backTrees);
});

test("both tree species keep all side and back trees without excessive chunk counts", () => {
  const world = sceneHarness();
  world.buildTrees();
  const meshes = world.scene.children.filter(child => child instanceof THREE.InstancedMesh);
  assert.equal(meshes.reduce((sum, mesh) => sum + mesh.count, 0), 340);
  assert.ok(meshes.length <= 48);
  assert.equal(INSTANCE_CELL_SIZE, 48);
});
