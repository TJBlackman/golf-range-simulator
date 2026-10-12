import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createGolfCart, disposeGolfCart } from "./golf-cart.ts";

function meshes(object: THREE.Object3D) {
  const result: THREE.Mesh[] = [];
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) result.push(child);
  });
  return result;
}

function coloredMesh(object: THREE.Object3D, name: string) {
  const mesh = object.getObjectByName(name);
  assert.ok(mesh instanceof THREE.Mesh);
  assert.ok(mesh.material instanceof THREE.MeshStandardMaterial);
  return mesh as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
}

test("cart clones share detail geometry and keep independent colors, wheels and driver visibility", () => {
  const first = createGolfCart("#ff0000", "#00ff00");
  const second = createGolfCart("#0000ff", "#ffff00");
  const firstMeshes = meshes(first.object);
  const secondMeshes = meshes(second.object);
  assert.equal(firstMeshes.length, secondMeshes.length);
  for (let i = 0; i < firstMeshes.length; i++) {
    assert.notEqual(firstMeshes[i], secondMeshes[i]);
    assert.equal(firstMeshes[i].geometry, secondMeshes[i].geometry);
    assert.equal(firstMeshes[i].name, secondMeshes[i].name);
    assert.equal(firstMeshes[i].castShadow, secondMeshes[i].castShadow);
    assert.equal(firstMeshes[i].receiveShadow, secondMeshes[i].receiveShadow);
  }

  const firstPaint = coloredMesh(first.object, "PaintedBody");
  const secondPaint = coloredMesh(second.object, "PaintedBody");
  const firstPolo = coloredMesh(first.driver, "DriverPolo");
  const secondPolo = coloredMesh(second.driver, "DriverPolo");
  assert.notEqual(firstPaint.material, secondPaint.material);
  assert.notEqual(firstPolo.material, secondPolo.material);
  assert.equal(firstPaint.material.color.getHexString(), "ff0000");
  assert.equal(secondPaint.material.color.getHexString(), "0000ff");
  assert.equal(firstPolo.material.color.getHexString(), "00ff00");
  assert.equal(secondPolo.material.color.getHexString(), "ffff00");
  firstPolo.material.color.set("#ffffff");
  assert.equal(secondPolo.material.color.getHexString(), "ffff00");

  first.driver.visible = false;
  assert.equal(second.driver.visible, true);
  assert.equal(first.object.getObjectByName("SeatedDriver"), first.driver);
  assert.deepEqual(first.wheels.map((wheel) => wheel.name), [
    "RearLeftWheel", "RearRightWheel", "FrontLeftWheel", "FrontRightWheel",
  ]);
  first.wheels[0].rotation.x = 1.25;
  assert.ok(second.wheels[0].rotation.x === 0);
  assert.ok(first.wheels[1].rotation.x === 0);
  assert.deepEqual(first.object.userData, {
    asset: "golf-cart", authoredUnits: "metres", forwardAxis: "+Z", seating: 2,
  });
  disposeGolfCart(first);
  disposeGolfCart(second);
});

test("departing carts dispose only their two owned colors and leave shared details reusable", () => {
  const first = createGolfCart("#54685b", "#8b4e40");
  const firstMeshes = meshes(first.object);
  const geometries = new Set(firstMeshes.map((mesh) => mesh.geometry));
  const owned = new Set([
    coloredMesh(first.object, "PaintedBody").material,
    coloredMesh(first.driver, "DriverPolo").material,
  ]);
  const surfaces = new Set(firstMeshes.flatMap((mesh) =>
    Array.isArray(mesh.material) ? mesh.material : [mesh.material],
  ));
  let geometryDisposals = 0;
  let sharedMaterialDisposals = 0;
  let ownedMaterialDisposals = 0;
  const onGeometryDisposed = () => geometryDisposals++;
  const onSharedMaterialDisposed = () => sharedMaterialDisposals++;
  const onOwnedMaterialDisposed = () => ownedMaterialDisposals++;
  for (const geo of geometries) geo.addEventListener("dispose", onGeometryDisposed);
  for (const material of surfaces) {
    material.addEventListener("dispose", owned.has(material) ? onOwnedMaterialDisposed : onSharedMaterialDisposed);
  }

  disposeGolfCart(first);
  disposeGolfCart(first);
  assert.equal(ownedMaterialDisposals, 2);
  assert.equal(geometryDisposals, 0);
  assert.equal(sharedMaterialDisposals, 0);

  // Repeated arrival/departure cycles must neither rebuild nor release cached buffers.
  for (let i = 0; i < 50; i++) {
    const cart = createGolfCart("#ffffff", "#000000");
    const cartMeshes = meshes(cart.object);
    assert.equal(cartMeshes.length, firstMeshes.length);
    for (let j = 0; j < cartMeshes.length; j++) {
      assert.equal(cartMeshes[j].geometry, firstMeshes[j].geometry);
      if (!owned.has(firstMeshes[j].material as THREE.Material)) {
        assert.equal(cartMeshes[j].material, firstMeshes[j].material);
      }
    }
    assert.equal(cart.driver.visible, true);
    assert.ok(cart.wheels.every((wheel) => wheel.rotation.x === 0));
    disposeGolfCart(cart);
  }
  assert.equal(geometryDisposals, 0);
  assert.equal(sharedMaterialDisposals, 0);
  for (const geo of geometries) geo.removeEventListener("dispose", onGeometryDisposed);
  for (const material of surfaces) {
    material.removeEventListener("dispose", owned.has(material) ? onOwnedMaterialDisposed : onSharedMaterialDisposed);
  }
});
