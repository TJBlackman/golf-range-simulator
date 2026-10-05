import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export type GolfCartModel = {
  object: THREE.Group;
  /** Axles run along local X. Rotate each group around X as the cart moves. */
  wheels: THREE.Object3D[];
  /** Hide while its golfer is outside; DriverPolo is the recolorable shirt. */
  driver: THREE.Group;
};

const geometryCache = new Map<string, THREE.BufferGeometry>();
const ownedResources = new WeakMap<THREE.Group, {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}>();
function geometry(key: string, make: () => THREE.BufferGeometry) {
  let result = geometryCache.get(key);
  if (!result) {
    result = make();
    geometryCache.set(key, result);
  }
  return result;
}
function rounded(w: number, h: number, d: number, radius = .035) {
  return geometry(`box:${w}:${h}:${d}:${radius}`, () =>
    new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2)),
  );
}
function cylinder(top: number, bottom: number, height: number, segments = 16) {
  return geometry(`cylinder:${top}:${bottom}:${height}:${segments}`, () =>
    new THREE.CylinderGeometry(top, bottom, height, segments),
  );
}
function sphere(radius: number) {
  return geometry(`sphere:${radius}`, () => new THREE.SphereGeometry(radius, 16, 10));
}
function ring(radius: number, tube: number) {
  return geometry(`ring:${radius}:${tube}`, () => new THREE.TorusGeometry(radius, tube, 6, 20));
}
const materials = {
  chassis: new THREE.MeshStandardMaterial({ color: "#182322", roughness: .76 }),
  rubber: new THREE.MeshStandardMaterial({ color: "#161918", roughness: .95 }),
  tyreEdge: new THREE.MeshStandardMaterial({ color: "#232927", roughness: .87 }),
  alloy: new THREE.MeshStandardMaterial({ color: "#b4bfbe", roughness: .3, metalness: .78 }),
  chrome: new THREE.MeshStandardMaterial({ color: "#dce2de", roughness: .18, metalness: .9 }),
  vinyl: new THREE.MeshStandardMaterial({ color: "#c8bd9b", roughness: .84 }),
  piping: new THREE.MeshStandardMaterial({ color: "#9c8f73", roughness: .85 }),
  roof: new THREE.MeshStandardMaterial({ color: "#eeede0", roughness: .55 }),
  glass: new THREE.MeshPhysicalMaterial({ color: "#aec7c9", transparent: true, opacity: .18, roughness: .1, metalness: 0, side: THREE.DoubleSide, depthWrite: false }),
  headlights: new THREE.MeshStandardMaterial({ color: "#ede8cd", roughness: .23, emissive: "#b1a882", emissiveIntensity: .16 }),
  tailLights: new THREE.MeshStandardMaterial({ color: "#822d26", roughness: .3 }),
  bag: new THREE.MeshStandardMaterial({ color: "#253e36", roughness: .9 }),
  bagTrim: new THREE.MeshStandardMaterial({ color: "#b5b69d", roughness: .8 }),
  skin: new THREE.MeshStandardMaterial({ color: "#b48664", roughness: .9 }),
  trousers: new THREE.MeshStandardMaterial({ color: "#b4ae91", roughness: .94 }),
  shoes: new THREE.MeshStandardMaterial({ color: "#363d37", roughness: .85 }),
  cap: new THREE.MeshStandardMaterial({ color: "#e1ddca", roughness: .92 }),
};

function part(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale?: [number, number, number],
) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = material !== materials.glass;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function tube(
  parent: THREE.Object3D,
  a: [number, number, number],
  b: [number, number, number],
  radius: number,
  material: THREE.Material,
  upperRadius = radius,
) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const distance = start.distanceTo(end);
  const mesh = part(parent, cylinder(upperRadius, radius, 1), material, [0, 0, 0]);
  mesh.position.copy(start).add(end).multiplyScalar(.5);
  mesh.scale.y = distance;
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  return mesh;
}

/** Keep the many small authored details to one draw call per surface material. */
function mergeParts(group: THREE.Group, names?: Map<THREE.Material, string>) {
  group.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
    const geo = child.geometry.index
      ? child.geometry.toNonIndexed()
      : child.geometry.clone();
    geo.applyMatrix4(child.matrix);
    const bucket = buckets.get(child.material) ?? [];
    bucket.push(geo);
    buckets.set(child.material, bucket);
  }
  group.clear();
  for (const [material, pieces] of buckets) {
    const combined = mergeGeometries(pieces, false);
    for (const piece of pieces) piece.dispose();
    if (!combined) continue;
    // These solid PBR surfaces have no textures. Removing UV seams also lets
    // coincident round-box vertices share their normal and position buffers.
    combined.deleteAttribute("uv");
    const indexed = mergeVertices(combined);
    combined.dispose();
    const positions = indexed.getAttribute("position");
    const originalIndices = indexed.getIndex()!;
    const indices: number[] = [];
    for (let i = 0; i < originalIndices.count; i += 3) {
      const a = originalIndices.getX(i), b = originalIndices.getX(i + 1), c = originalIndices.getX(i + 2);
      const ux = positions.getX(b) - positions.getX(a), uy = positions.getY(b) - positions.getY(a), uz = positions.getZ(b) - positions.getZ(a);
      const vx = positions.getX(c) - positions.getX(a), vy = positions.getY(c) - positions.getY(a), vz = positions.getZ(c) - positions.getZ(a);
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * cx + cy * cy + cz * cz > 1e-16) indices.push(a, b, c);
    }
    indexed.setIndex(indices);
    const mesh = new THREE.Mesh(indexed, material);
    mesh.name = names?.get(material) ?? "CartDetail";
    mesh.castShadow = material !== materials.glass;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function createWheel() {
  const wheel = new THREE.Group();
  const axleRotation: [number, number, number] = [0, 0, Math.PI / 2];
  const ringRotation: [number, number, number] = [0, Math.PI / 2, 0];
  part(wheel, cylinder(.272, .272, .17, 24), materials.rubber, [0, 0, 0], axleRotation);
  part(wheel, ring(.234, .066), materials.rubber, [0, 0, 0], ringRotation);
  for (const side of [-1, 1]) {
    const x = side * .09;
    part(wheel, ring(.232, .008), materials.rubber, [side * .074, 0, 0], ringRotation);
    part(wheel, cylinder(.168, .168, .012), materials.alloy, [x, 0, 0], axleRotation);
    part(wheel, ring(.159, .008), materials.alloy, [x + side * .008, 0, 0], ringRotation);
    part(wheel, cylinder(.063, .063, .022), materials.alloy, [x + side * .013, 0, 0], axleRotation);
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5;
      part(wheel, cylinder(.009, .009, .012, 8), materials.rubber,
        [x + side * .009, Math.cos(angle) * .102, Math.sin(angle) * .102], axleRotation);
    }
  }
  mergeParts(wheel);
  return wheel;
}
// Geometry and immutable surface materials are shared between every golf cart.
const wheelTemplate = createWheel();

function createDriver(poloColor: string) {
  const driver = new THREE.Group();
  driver.name = "SeatedDriver";
  const shirt = new THREE.MeshStandardMaterial({ color: poloColor, roughness: .93 });
  const x = -.29;
  part(driver, rounded(.32, .4, .225, .07), shirt, [x, 1.13, -.17], [.06, 0, 0]);
  part(driver, rounded(.29, .105, .24, .03), materials.trousers, [x, .893, -.18]);
  // Shoulders, sleeves and naturally bent arms reaching the steering rim.
  for (const side of [-1, 1]) {
    const shoulder: [number, number, number] = [x + side * .155, 1.26, -.17];
    const elbow: [number, number, number] = [x + side * .175, 1.05, .075];
    const wrist: [number, number, number] = [x + side * .125, 1.08, .37];
    tube(driver, shoulder, [x + side * .165, 1.16, -.05], .055, shirt, .068);
    tube(driver, [x + side * .165, 1.16, -.05], elbow, .04, materials.skin, .045);
    part(driver, sphere(.044), materials.skin, elbow);
    tube(driver, elbow, wrist, .034, materials.skin, .029);
    part(driver, sphere(.037), materials.skin, wrist, [0, 0, 0], [1, .7, 1.25]);
    const hip: [number, number, number] = [x + side * .095, .88, -.13];
    const knee: [number, number, number] = [x + side * .095, .77, .27];
    const ankle: [number, number, number] = [x + side * .095, .485, .51];
    tube(driver, hip, knee, .073, materials.trousers, .067);
    part(driver, sphere(.07), materials.trousers, knee);
    tube(driver, knee, ankle, .058, materials.trousers, .045);
    part(driver, rounded(.115, .08, .235, .035), materials.shoes, [x + side * .095, .435, .58]);
    part(driver, rounded(.12, .018, .24, .007), materials.rubber, [x + side * .095, .399, .58]);
  }
  tube(driver, [x, 1.31, -.16], [x, 1.41, -.15], .046, materials.skin);
  part(driver, sphere(.118), materials.skin, [x, 1.5, -.143], [0, 0, 0], [.86, 1.22, .9]);
  for (const side of [-1, 1]) {
    part(driver, sphere(.026), materials.skin, [x + side * .102, 1.497, -.139], [0, 0, 0], [.6, 1, .7]);
    part(driver, sphere(.007), materials.chassis, [x + side * .037, 1.528, -.04]);
  }
  part(driver, sphere(.019), materials.skin, [x, 1.495, -.03], [0, 0, 0], [.65, 1, 1.2]);
  const capDome = geometry("driver-cap", () => new THREE.SphereGeometry(.122, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  part(driver, capDome, materials.cap, [x, 1.56, -.145], [0, 0, 0], [.94, .75, 1]);
  part(driver, rounded(.218, .018, .135, .008), materials.cap, [x, 1.56, -.026], [-.1, 0, 0]);
  // A pale polo collar and button placket make the driver read as golf attire.
  for (const side of [-1, 1])
    part(driver, rounded(.075, .065, .012, .008), materials.cap, [x + side * .043, 1.304, -.043], [0, 0, side * -.35]);
  part(driver, rounded(.014, .07, .006, .002), materials.cap, [x, 1.248, -.055]);
  mergeParts(driver, new Map([[shirt, "DriverPolo"]]));
  return driver;
}

/** A full-size, two-seat resort cart. Metres, ground at Y=0, forward local +Z. */
export function createGolfCart(color: string, poloColor: string): GolfCartModel {
  const object = new THREE.Group();
  object.name = "ResortGolfCart";
  const frame = new THREE.Group();
  frame.name = "CartBody";
  object.add(frame);
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: .3, metalness: .16, clearcoat: .65, clearcoatRoughness: .22 });

  part(frame, rounded(1.06, .16, 1.89, .065), materials.chassis, [0, .36, -.03]);
  part(frame, rounded(1.08, .065, 1.04, .025), materials.rubber, [0, .457, .12]);
  for (const z of [-.76, .79]) tube(frame, [-.65, .31, z], [.65, .31, z], .055, materials.chassis);
  // The bonnet and rear tub use overlapping curved shells instead of faceted boxes.
  part(frame, rounded(1.13, .36, .43, .095), paint, [0, .65, .91], [-.09, 0, 0]);
  part(frame, rounded(1.15, .095, .46, .045), paint, [0, .843, .862], [-.13, 0, 0]);
  part(frame, rounded(1.1, .39, .43, .075), paint, [0, .637, -.795]);
  part(frame, rounded(1.13, .035, .45, .015), materials.chassis, [0, .833, -.8]);
  for (const side of [-1, 1]) {
    part(frame, rounded(.105, .28, .93, .046), paint, [side * .535, .57, -.16]);
    part(frame, rounded(.17, .075, 1.16, .026), materials.chassis, [side * .564, .4, -.01]);
    part(frame, rounded(.31, .085, .63, .035), paint, [side * .48, .63, -.76]);
    part(frame, rounded(.31, .07, .64, .035), paint, [side * .48, .628, .79]);
    // Tubular canopy uprights, rear grab rail and a slanted front windscreen.
    tube(frame, [side * .49, .87, .72], [side * .49, 1.847, .56], .021, materials.chassis);
    tube(frame, [side * .5, .76, -.63], [side * .5, 1.853, -.66], .024, materials.chassis);
    tube(frame, [side * .43, .93, -.47], [side * .43, 1.35, -.47], .017, materials.chassis);
    tube(frame, [side * .43, 1.35, -.47], [side * .34, 1.35, -.47], .017, materials.chassis);
    part(frame, rounded(.265, .105, .045, .027), materials.headlights, [side * .356, .713, 1.128]);
    part(frame, rounded(.15, .062, .02, .012), materials.tailLights, [side * .37, .676, -1.016]);
  }
  part(frame, rounded(1.26, .09, 2.03, .044), materials.roof, [0, 1.87, -.04]);
  part(frame, rounded(1.13, .014, 1.83, .006), materials.piping, [0, 1.821, -.04]);
  part(frame, rounded(.957, .705, .015, .007), materials.glass, [0, 1.338, .643], [-.16, 0, 0]);
  part(frame, rounded(.994, .016, .026, .006), materials.chassis, [0, 1.35, .641]);
  part(frame, rounded(.957, .028, .026, .009), materials.chassis, [0, .991, .7]);
  part(frame, rounded(1.01, .158, .215, .047), materials.chassis, [0, .906, .597], [-.09, 0, 0]);
  part(frame, rounded(.23, .09, .015, .022), materials.alloy, [-.29, .954, .478], [-.1, 0, 0]);
  for (const x of [-.34, -.24])
    part(frame, cylinder(.027, .027, .005), materials.chassis, [x, .95, .463], [Math.PI / 2, 0, 0]);
  for (const x of [.25, .405]) {
    part(frame, cylinder(.057, .057, .016), materials.chassis, [x, .987, .584]);
    part(frame, ring(.049, .006), materials.alloy, [x, .997, .584], [Math.PI / 2, 0, 0]);
  }
  tube(frame, [-.29, .804, .681], [-.29, 1.075, .427], .019, materials.chassis);
  const steering = new THREE.Group();
  steering.position.set(-.29, 1.077, .423);
  steering.rotation.x = -.53;
  part(steering, ring(.145, .014), materials.chassis, [0, 0, 0]);
  part(steering, cylinder(.043, .043, .026), materials.chassis, [0, 0, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + Math.PI / 2;
    tube(steering, [0, 0, 0], [Math.cos(a) * .132, Math.sin(a) * .132, 0], .009, materials.alloy);
  }
  steering.updateMatrix();
  // Flatten this transformed subassembly into frame-local coordinates before batching.
  for (const child of [...steering.children]) {
    child.updateMatrix();
    child.applyMatrix4(steering.matrix);
    frame.add(child);
  }
  for (const side of [-1, 1]) {
    part(frame, rounded(.475, .105, .51, .048), materials.vinyl, [side * .265, .765, -.16]);
    part(frame, rounded(.475, .055, .51, .025), materials.piping, [side * .265, .725, -.16]);
    part(frame, rounded(.465, .335, .115, .05), materials.vinyl, [side * .265, 1.011, -.421], [-.11, 0, 0]);
    part(frame, rounded(.455, .025, .018, .007), materials.piping, [side * .265, 1.069, -.353]);
    tube(frame, [side * .518, .705, -.34], [side * .518, .932, -.34], .017, materials.chassis);
    part(frame, rounded(.065, .047, .28, .018), materials.chassis, [side * .518, .951, -.196]);
  }
  part(frame, rounded(1.13, .094, .13, .045), materials.chassis, [0, .456, 1.139]);
  part(frame, rounded(.81, .044, .023, .011), materials.alloy, [0, .444, 1.207]);
  part(frame, rounded(1.14, .083, .137, .035), materials.chassis, [0, .399, -1.075]);
  part(frame, rounded(.945, .06, .33, .025), materials.chassis, [0, .493, -1.058]);
  tube(frame, [-.5, .92, -1.061], [.5, .92, -1.061], .018, materials.chassis);

  // Two fabric bags with zip pockets, securing straps and separate steel clubs.
  for (const side of [-1, 1]) {
    const bag = new THREE.Group();
    bag.position.set(side * .282, .79, -1.092);
    bag.rotation.x = -.14;
    part(bag, cylinder(.123, .109, .62), materials.bag, [0, 0, 0]);
    part(bag, cylinder(.128, .128, .064), materials.bagTrim, [0, .276, 0]);
    part(bag, rounded(.177, .255, .075, .025), materials.bag, [0, -.04, -.114]);
    part(bag, rounded(.008, .2, .007, .003), materials.bagTrim, [.031, -.035, -.156]);
    part(bag, ring(.12, .008), materials.chassis, [0, .135, 0], [Math.PI / 2, 0, 0]);
    part(bag, rounded(.056, .31, .023, .011), materials.bagTrim, [.083, -.015, .092], [0, 0, -.1]);
    for (let i = 0; i < 4; i++) {
      const cx = (i % 2 ? 1 : -1) * .05;
      const cz = i < 2 ? -.039 : .037;
      const top = .71 - i * .037;
      tube(bag, [cx, .23, cz], [cx, top, cz], .006, materials.chrome);
      part(bag, rounded(.087, .045, .035, .015), materials.alloy, [cx + .026, top, cz]);
      tube(bag, [cx, top - .095, cz], [cx, top - .017, cz], .01, materials.rubber);
    }
    bag.updateMatrix();
    for (const child of [...bag.children]) {
      child.updateMatrix();
      child.applyMatrix4(bag.matrix);
      frame.add(child);
    }
  }
  mergeParts(frame, new Map([[paint, "PaintedBody"]]));
  const wheels: THREE.Object3D[] = [];
  for (const z of [-.76, .79]) for (const side of [-1, 1]) {
    const wheel = wheelTemplate.clone();
    wheel.name = `${z > 0 ? "Front" : "Rear"}${side < 0 ? "Left" : "Right"}Wheel`;
    wheel.position.set(side * .606, .31, z);
    object.add(wheel);
    wheels.push(wheel);
  }
  const driver = createDriver(poloColor);
  object.add(driver);
  object.userData = { asset: "golf-cart", authoredUnits: "metres", forwardAxis: "+Z", seating: 2 };
  const geometries = [...frame.children, ...driver.children]
    .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
    .map((mesh) => mesh.geometry);
  const polo = driver.getObjectByName("DriverPolo") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ownedResources.set(object, { geometries, materials: [paint, polo.material] });
  return { object, wheels, driver };
}

/** Release one departed visitor's owned buffers without touching shared wheels. */
export function disposeGolfCart(model: GolfCartModel) {
  const owned = ownedResources.get(model.object);
  if (!owned) return;
  for (const geo of owned.geometries) geo.dispose();
  for (const material of owned.materials) material.dispose();
  ownedResources.delete(model.object);
}
