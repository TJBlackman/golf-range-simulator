import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import {
  CLUBS,
  RANGE_END,
  TARGETS,
  TEE,
  YARD,
  clamp,
  simulateShot,
  sampleShot,
} from "./physics";
import type { Point, Shape, Shot } from "./physics";
import {
  obstacleDistance,
  resolveMove,
  segmentHitsVehicle,
  VEHICLE_RADIUS,
} from "./collisions";
import type { Obstacle } from "./collisions";
import { GOLFER_TYPES, HOPPER_CAPACITIES } from "./management";
import { createGolfCart, disposeGolfCart } from "./golf-cart";
import { validateWorldState } from "./world-state";
import { RangeEnvironment } from "./environment";
import { HopperBeacon } from "./hopper-beacon";
import { cartSpeedMultiplier, SAND_TRAP_OUTLINE, SAND_TRAP_ROTATION, SAND_TRAPS } from "./terrain";
import type {
  GolferState,
  GolferStatus,
  GolferType,
  ShotOrder,
  SpillCause,
} from "./management";

type Asset = { scene: THREE.Group; animations: THREE.AnimationClip[] };
type AnimalKind = "goose" | "fox" | "deer";
type AnimalMode = "graze" | "roam" | "dash" | "flee";
type Animal = {
  id: AnimalKind;
  object: THREE.Group;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction;
  home: THREE.Vector3;
  /** Preferred home z on a full length range. */
  homeZ: number;
  range: number;
  target: THREE.Vector3;
  heading: number;
  mode: AnimalMode;
  until: number;
  phase: number;
};
/** Metres per second in each behaviour mode. */
const WILDLIFE_SPEEDS: Record<AnimalKind, Record<AnimalMode, number>> = {
  goose: { graze: 0.7, roam: 2.0, dash: 4.5, flee: 5 },
  fox: { graze: 1.0, roam: 2.8, dash: 6.5, flee: 7 },
  deer: { graze: 0.9, roam: 2.6, dash: 8, flee: 9 },
};
const TURN_RATES: Record<AnimalMode, number> = {
  graze: 1.6,
  roam: 2.4,
  dash: 4.5,
  flee: 5,
};
const SPOOK_DISTANCE = 11;
const FIELD = { minX: -50, maxX: 50, minZ: 14, maxZ: TEE.z + 100 * YARD - 6 };
/** Bay centres along the tee line, in the order bays open. */
export const BAY_X = [-12, -8, -4, 0, 4, 8, 12, -16, 16, -20, 20, -24];
const HELPER_HOPPER = 80;
const MAX_HOPPER = Math.max(...HOPPER_CAPACITIES);
/** Zigzag sweep lanes that fit the current range, then home to the depot. */
const helperRoute = (end: number): [number, number][] => {
  const route: [number, number][] = [];
  let side = -1;
  for (let z = 50; z < end - 22; z += 35) {
    route.push([side * 44, z], [-side * 44, z]);
    side = -side;
  }
  if (!route.length) route.push([-44, 40], [44, 40]);
  route.push([-50, Math.min(200, end - 28)], [-50, 30], [-48, 11]);
  return route;
};
const HELPER_LANES = helperRoute(RANGE_END).map(([, z]) => z);
const CART_COLORS = ["#eee8d7", "#426754", "#71869c", "#8c4035", "#d0b77b"];
const GOLFER_SCALE = 1.15;
const GOLFER_ADDRESS_REACH = 0.71 * GOLFER_SCALE;
const GOLFER_STANCE_ANGLE = -Math.PI / 2;
const CART_ARRIVAL_SECONDS = 4.5;
const BAY_WALK_SECONDS = 3.5;
const SWING_SPEED = 1.8;
/** Where a golfer stands to address the ball: trail side of the tee for their handedness. */
const stanceX = (npc: { origin: Point; leftHanded: boolean }) =>
  npc.origin.x + (npc.leftHanded ? -GOLFER_ADDRESS_REACH : GOLFER_ADDRESS_REACH);
const stanceAngle = (npc: { leftHanded: boolean }) =>
  npc.leftHanded ? -GOLFER_STANCE_ANGLE : GOLFER_STANCE_ANGLE;
const SWING_IMPACT_SECONDS = 34 / 24;
const FLIGHT_SPEED = 1.7;
/** How far down the range each golfer type can send a ball, in yards. */
const REACH_YARDS: Record<GolferType, number> = {
  family: 170,
  casual: 225,
  grinder: 255,
  pro: 270,
};
type FieldBall = {
  position: THREE.Vector3;
  active: boolean;
  pickableAt?: number;
};
type Walk = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  duration: number;
  hide: boolean;
};
type NPC = {
  object: THREE.Group;
  /** The hitting bay this golfer plays from. Mirrored on X for a left hander. */
  bay: THREE.Group;
  mixer: THREE.AnimationMixer;
  swing: THREE.AnimationAction;
  /** Where the ball sits on the tee. Moves with the bay when it is mirrored. */
  origin: Point;
  mood: THREE.Sprite;
  moodKey: string;
  type: GolferType;
  status: GolferStatus;
  leftHanded: boolean;
  polo?: THREE.MeshStandardMaterial;
  walk?: Walk;
  cart?: VisitorCart;
  hips: THREE.Object3D[];
  knees: THREE.Object3D[];
};
type CartLeg = {
  path: THREE.Curve<THREE.Vector3>;
  duration: number;
  reverse?: boolean;
};
type VisitorCart = ReturnType<typeof createGolfCart> & {
  npc: NPC;
  park: THREE.Vector3;
  phase: "arriving" | "parked" | "departing";
  start: number;
  legs: CartLeg[];
};
type Hazard = {
  id: string;
  z: number;
  objects: THREE.Object3D[];
  obstacle: Obstacle;
  cleared: boolean;
};
type Helper = {
  object: THREE.Group;
  angle: number;
  hopper: number;
  index: number;
  pauseUntil: number;
  roller?: THREE.Object3D;
};
export type CartSetup = {
  maxSpeed: number;
  halfWidth: number;
  capacity: number;
  collector: number;
  cage: number;
  bumper: number;
  hopper: number;
};
type AirShot = {
  shot: Shot;
  time: number;
  point: Point;
  trail: THREE.Line;
  lost?: boolean;
};
type BouncingBall = { position: THREE.Vector3; velocity: THREE.Vector3 };
export type DriveResult = { collected: number; collision?: Obstacle };

const BALL_VISUAL_SCALE = 1;

const modelUrls = import.meta.glob("../assets/models/*.glb", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const material = (color: string) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
const vector = (point: Point) => new THREE.Vector3(point.x, point.y, point.z);

export class RangeScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1500);
  readonly assets = new Map<string, Asset>();
  readonly animals: Animal[] = [];
  readonly balls: FieldBall[] = [];
  readonly golfers: NPC[] = [];
  readonly obstacles: Obstacle[] = [];
  readonly airShots: AirShot[] = [];
  readonly bouncingBalls: BouncingBall[] = [];
  readonly latchedCollisions = new Set<string>();
  readonly tractor = new THREE.Group();
  /** Ball return in the left corner, leaving the tee line free for more bays. */
  readonly depotPosition = new THREE.Vector3(-48, 0, 7);
  readonly depots: THREE.Vector3[] = [];
  readonly golfCarts: VisitorCart[] = [];
  /** Current range length. Starts short and grows through the shop. */
  rangeYards = 100;
  rangeEnd = TEE.z + 100 * YARD;
  private helperRoute = helperRoute(this.rangeEnd);
  private ground!: THREE.Group;
  private secondDepot?: { object: THREE.Group; label: THREE.Sprite };
  private fenceMeshes: THREE.Object3D[] = [];
  private targetGroups: THREE.Group[] = [];
  private backTrees: THREE.InstancedMesh[] = [];
  private hazards: Hazard[] = [];
  cart: CartSetup = {
    maxSpeed: 9,
    halfWidth: 1.6,
    capacity: HOPPER_CAPACITIES[0],
    collector: 0,
    cage: 0,
    bumper: 0,
    hopper: 0,
  };
  helper?: Helper;
  private tractorModel!: THREE.Group;
  private hopperBeacon!: HopperBeacon;
  private tractorTerrainSpeed = 1;
  private wings: THREE.Group[] = [];
  private wingRollers: THREE.Object3D[] = [];
  private cartVisual = { collector: -1, cage: -1, bumper: -1, hopper: -1 };
  private cage?: THREE.Group;
  private bumper?: THREE.Group;
  private boards?: THREE.Group;
  private nets?: THREE.Group;
  private netLevel = 0;
  readonly ballDummy = new THREE.Object3D();
  fieldBalls!: THREE.InstancedMesh;
  hopperBalls!: THREE.InstancedMesh;
  flyingBalls!: THREE.InstancedMesh;
  tractorWheels: THREE.Object3D[] = [];
  tractorSteering: THREE.Object3D[] = [];
  collectorRoller?: THREE.Object3D;
  depotLabel?: THREE.Sprite;
  loaded = 0;
  elapsed = 0;
  tractorAngle = 0;
  tractorSpeed = 0;
  cameraMode: "chase" | "overview" = "chase";
  quality: "high" | "low" = "high";
  private cameraTarget = new THREE.Vector3(-42, 0.8, 26);
  /** Mouse look: yaw and pitch offsets around the cart, zoom factor. */
  lookYaw = 0;
  lookPitch = 0;
  lookZoom = 1;
  looking = false;
  private lookHoldUntil = 0;
  private targetCamera = new THREE.Vector3();
  private targetLook = new THREE.Vector3();
  private shakeTime = 0;
  private readonly sun: THREE.DirectionalLight;
  private readonly environment: RangeEnvironment;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.scene.background = new THREE.Color("#cedbdd");
    this.scene.fog = new THREE.Fog("#a9b9ba", 220, 1000);
    this.scene.add(new THREE.HemisphereLight("#d8e6ef", "#647047", 1.15));
    this.sun = new THREE.DirectionalLight("#ffead1", 3.1);
    this.sun.position.set(-95, 68, -28);
    this.sun.target.position.set(0, 0, 65);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    Object.assign(this.sun.shadow.camera, {
      left: -75,
      right: 75,
      top: 85,
      bottom: -65,
      near: 0.5,
      far: 350,
    });
    this.sun.shadow.bias = -0.00012;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun, this.sun.target);
    this.camera.position.set(-38, 4.4, 8);
    this.camera.lookAt(this.cameraTarget);
    this.environment = new RangeEnvironment(this.scene, this.renderer);
    this.buildLandscape();
    this.scene.add(this.tractor);
    this.resize();
  }

  async load(onProgress: (loaded: number, total: number) => void) {
    const loader = new GLTFLoader();
    const ids = [
      "range-ground",
      "golf-ball",
      "target-flag",
      "hitting-bay",
      "golfer",
      "tractor-picker",
      "ball-depot",
      "tree-pine",
      "tree-broadleaf",
      "fence-section",
      "goose",
      "fox",
      "deer",
      "distance-marker-50",
      "distance-marker-100",
      "distance-marker-150",
    ];
    await Promise.all(
      ids.map(async (id) => {
        const url = modelUrls[`../assets/models/${id}.glb`];
        const gltf = await loader.loadAsync(url);
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
            const materials = Array.isArray(object.material)
              ? object.material
              : [object.material];
            for (const mat of materials)
              if (mat instanceof THREE.MeshStandardMaterial) {
                mat.envMapIntensity = 0.8;
                if (/leaves/.test(mat.name)) this.environment.foliage(mat);
              }
          }
        });
        this.assets.set(id, { scene: gltf.scene, animations: gltf.animations });
        onProgress(++this.loaded, ids.length);
      }),
    );
    this.buildRange();
    this.buildTrees();
    this.buildBuildings();
    this.buildObstacles();
    this.buildWildlife();
    this.buildBalls();
    await this.environment.ready();
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  private asset(id: string, x = 0, z = 0, scale = 1) {
    const object = clone(this.assets.get(id)!.scene) as THREE.Group;
    object.position.set(x, 0, z);
    object.scale.setScalar(scale);
    this.scene.add(object);
    return object;
  }

  private buildLandscape() {
    this.environment.buildLandscape();
  }

  private buildRange() {
    const ground = (this.ground = this.asset("range-ground", 0, this.rangeEnd / 2));
    ground.scale.set(1.8, 1, (this.rangeEnd + 1) / 90);
    ground.traverse((object) => {
      if (object.name.startsWith("Target")) object.visible = false;
      if (
        object instanceof THREE.Mesh &&
        (object.name === "Ground" || object.name.startsWith("MowingStrip"))
      ) {
        object.material = this.environment.surface("grass",
          object.name.startsWith("MowingStrip") &&
            parseInt(object.name.split(".")[1] || "0") % 2 === 0
            ? "#c9d0b5"
            : "#a7b396", 3.5,
        );
        object.castShadow = false;
      }
    });
    for (const target of TARGETS) {
      const group = new THREE.Group();
      const greenShape = new THREE.Shape();
      for (let i = 0; i <= 80; i++) {
        const angle = i / 80 * Math.PI * 2;
        const radius = 10.8 * YARD * (1 + Math.sin(angle * 3 + target.x) * 0.12);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * 0.78;
        if (i === 0) greenShape.moveTo(x, y);
        else greenShape.lineTo(x, y);
      }
      const fringe = new THREE.Mesh(new THREE.ShapeGeometry(greenShape, 64), this.environment.surface("grass", "#c4cba7", 2.5));
      fringe.rotation.x = -Math.PI / 2;
      fringe.position.set(target.x, 0.042, target.z);
      fringe.receiveShadow = true;
      group.add(fringe);
      const green = new THREE.Mesh(new THREE.ShapeGeometry(greenShape, 64), this.environment.surface("grass", "#d0d5aa", 1.8));
      green.rotation.x = -Math.PI / 2;
      green.scale.setScalar(0.87);
      green.position.set(target.x, 0.049, target.z);
      green.receiveShadow = true;
      group.add(green);
      const bunkerShape = new THREE.Shape();
      for (const [i, { x, y }] of SAND_TRAP_OUTLINE.entries()) {
        if (i === 0) bunkerShape.moveTo(x, y);
        else bunkerShape.lineTo(x, y);
      }
      bunkerShape.closePath();
      const trap = SAND_TRAPS.find(trap => trap.targetZ === target.z)!;
      const bunker = new THREE.Mesh(new THREE.ShapeGeometry(bunkerShape, 64), this.environment.surface("sand", "#d4c9af", 2));
      bunker.rotation.x = -Math.PI / 2;
      bunker.rotation.z = SAND_TRAP_ROTATION;
      bunker.position.set(trap.x, 0.04, trap.z);
      bunker.receiveShadow = true;
      group.add(bunker);
      const flag = this.asset("target-flag", target.x, target.z, 1.2);
      this.scene.remove(flag);
      flag.rotation.y = -0.4;
      const flagMesh = flag.getObjectByName("Flag");
      if (flagMesh instanceof THREE.Mesh)
        flagMesh.material = this.environment.flagMaterial(target.color);
      group.add(flag);
      group.visible = target.z < this.rangeEnd - 18;
      this.scene.add(group);
      this.targetGroups.push(group);
      const yards = Math.round((target.z - TEE.z) / YARD);
      const markerId = `distance-marker-${yards}`;
      if (this.assets.has(markerId)) {
        const sign = this.asset(markerId, target.x + 13.5, target.z - 2.5, 1.05);
        this.scene.remove(sign);
        sign.rotation.y = Math.PI;
        group.add(sign);
      }
    }
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(164, 12),
      this.environment.surface("gravel", "#d1c8b6", 3),
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.013, -5);
    path.receiveShadow = true;
    this.scene.add(path);
    this.buildFences();
  }

  /** Side fences up to the current back fence, rebuilt when the range grows. */
  private buildFences() {
    for (const mesh of this.fenceMeshes) {
      this.scene.remove(mesh);
      if (mesh instanceof THREE.InstancedMesh) mesh.geometry.dispose();
    }
    const end = this.rangeEnd;
    const placements: THREE.Matrix4[] = [];
    for (let z = 6; z < end; z += 3) {
      for (const x of [-55, 55])
        placements.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, 0, z),
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              Math.PI / 2,
            ),
            new THREE.Vector3(1, 1, 1),
          ),
        );
    }
    for (let x = -54; x < 55; x += 3)
      placements.push(new THREE.Matrix4().makeTranslation(x, 0, end));
    this.fenceMeshes = this.instanceAsset("fence-section", placements);
  }

  /** Grow or shrink the playable range to `yards`, moving everything tied
   *  to the back fence with it. */
  setRange(yards: number) {
    if (yards === this.rangeYards) return;
    this.rangeYards = yards;
    const end = (this.rangeEnd = TEE.z + yards * YARD);
    FIELD.maxZ = end - 6;
    this.ground.position.z = end / 2;
    this.ground.scale.z = (end + 1) / 90;
    this.buildFences();
    this.buildBackTrees();
    const back = this.obstacles.find((o) => o.id === "back-fence");
    if (back && back.kind === "box") {
      back.minZ = end - 1;
      back.maxZ = end + 2;
    }
    this.targetGroups.forEach(
      (group, i) => (group.visible = TARGETS[i].z < end - 18),
    );
    this.syncHazards();
    if (this.netLevel > 0) {
      const level = this.netLevel;
      this.netLevel = -1;
      this.setNets(level);
    }
    this.helperRoute = helperRoute(end);
    if (this.helper) this.helper.index = 0;
    for (const animal of this.animals) {
      animal.home.z = Math.min(animal.homeZ, FIELD.maxZ - 10);
      if (animal.object.position.z > FIELD.maxZ)
        animal.object.position.z = FIELD.maxZ - 5;
      this.chooseMode(animal, "roam");
    }
  }

  private buildBuildings() {
    // Every bay opens empty. The sim books the opening lineup, and each golfer drives in and walks to the mat.
    for (let i = 0; i < 7; i++) this.addBay(i);
    this.depots.push(this.depotPosition.clone());
    this.asset("ball-depot", this.depotPosition.x, this.depotPosition.z, 1.5);
    this.depotLabel = this.label("BALL RETURN", "#e0b878", "wide");
    this.depotLabel.position.set(
      this.depotPosition.x,
      5.7,
      this.depotPosition.z,
    );
    this.scene.add(this.depotLabel);
    const tractorModel = clone(this.assets.get("tractor-picker")!.scene);
    this.tractorModel = tractorModel as THREE.Group;
    this.hopperBeacon = new HopperBeacon(tractorModel);
    this.tractor.add(tractorModel);
    this.tractor.position.set(-42, 0.03, 20);
    for (const name of [
      "Front_L_Wheel",
      "Front_R_Wheel",
      "Rear_L_Wheel",
      "Rear_R_Wheel",
    ]) {
      const object = tractorModel.getObjectByName(name);
      if (object) this.tractorWheels.push(object);
    }
    for (const name of ["Front_L_Steer", "Front_R_Steer"]) {
      const object = tractorModel.getObjectByName(name);
      if (object) this.tractorSteering.push(object);
    }
    this.collectorRoller = tractorModel.getObjectByName("CollectorRoller");
  }

  /** World position of the bay's tee, read from the model's anchor so it follows a mirrored bay. */
  private teeOrigin(bay: THREE.Group): Point {
    bay.updateMatrixWorld(true);
    const anchor = bay.getObjectByName("BallLaunchAnchor");
    const origin = anchor
      ? anchor.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(bay.position.x + TEE.x, TEE.y, TEE.z);
    return { x: origin.x, y: TEE.y, z: origin.z };
  }

  private addBay(index: number) {
    const x = BAY_X[index];
    // Bays open right-handed: divider and roof post on the -X side, tee beside them,
    // dispenser button on the open +X side. A left hander mirrors the whole bay.
    const bay = this.asset("hitting-bay", x, 4);
    const origin = this.teeOrigin(bay);
    // Local +X is the lead (left) shoulder. Face across the tee so that
    // shoulder and the right-handed follow-through point down range (+Z).
    const object = this.asset("golfer", origin.x + GOLFER_ADDRESS_REACH, origin.z, GOLFER_SCALE);
    object.position.y = 0.18;
    object.rotation.y = GOLFER_STANCE_ANGLE;
    // Give each golfer its own shirt material so types can be coloured.
    let polo: THREE.MeshStandardMaterial | undefined;
    object.traverse((node) => {
      if (
        node instanceof THREE.Mesh &&
        /^(Torso|LeftUpperArm|RightUpperArm)/.test(node.name) &&
        node.material instanceof THREE.MeshStandardMaterial
      ) {
        polo ??= node.material.clone();
        node.material = polo;
      }
    });
    const mixer = new THREE.AnimationMixer(object);
    const swing = mixer.clipAction(this.assets.get("golfer")!.animations[0]);
    swing.setLoop(THREE.LoopOnce, 1);
    swing.clampWhenFinished = true;
    swing.play();
    swing.paused = true;
    const mood = this.label("HAPPY", "#a7be79", "mood");
    mood.position.set(x, 3.8, 4);
    this.scene.add(mood);
    object.visible = false;
    mood.visible = false;
    const npc: NPC = {
      object,
      bay,
      mixer,
      swing,
      origin,
      mood,
      moodKey: "",
      type: "casual",
      status: "empty",
      leftHanded: false,
      polo,
      hips: ["LeftHip", "RightHip"].map(name => object.getObjectByName(name)).filter((o): o is THREE.Object3D => !!o),
      knees: ["LeftKnee", "RightKnee"].map(name => object.getObjectByName(name)).filter((o): o is THREE.Object3D => !!o),
    };
    this.golfers.push(npc);
  }

  /** Open bays up to `count`. New bays start empty until the sim fills them. */
  setBays(count: number) {
    while (this.golfers.length > count) {
      const npc = this.golfers.pop()!;
      this.scene.remove(npc.object, npc.mood, npc.bay);
      (npc.mood.material as THREE.SpriteMaterial).map?.dispose();
      npc.mood.material.dispose();
      npc.polo?.dispose();
      if (npc.cart) {
        this.scene.remove(npc.cart.object);
        disposeGolfCart(npc.cart);
        const index = this.golfCarts.indexOf(npc.cart);
        if (index >= 0) this.golfCarts.splice(index, 1);
      }
    }
    while (this.golfers.length < Math.min(count, BAY_X.length))
      this.addBay(this.golfers.length);
  }

  private buildObstacles() {
    this.obstacles.push(
      {
        id: "left-fence",
        name: "Boundary fence",
        kind: "box",
        minX: -57,
        maxX: -54,
        minZ: 0,
        maxZ: RANGE_END + 3,
      },
      {
        id: "right-fence",
        name: "Boundary fence",
        kind: "box",
        minX: 54,
        maxX: 57,
        minZ: 0,
        maxZ: RANGE_END + 3,
      },
      {
        id: "back-fence",
        name: "Boundary fence",
        kind: "box",
        minX: -57,
        maxX: 57,
        minZ: this.rangeEnd - 1,
        maxZ: this.rangeEnd + 2,
      },
      {
        id: "bay-line",
        name: "Hitting bays",
        kind: "box",
        minX: -57,
        maxX: 57,
        minZ: -5,
        maxZ: 8,
      },
      {
        id: "depot",
        name: "Ball depot",
        kind: "box",
        minX: this.depotPosition.x - 2.25,
        maxX: this.depotPosition.x + 2.25,
        minZ: this.depotPosition.z - 2.8,
        maxZ: this.depotPosition.z - 0.35,
      },
    );
    for (const [i, t] of TARGETS.entries()) {
      this.obstacles.push({
        id: "flag-" + i,
        name: "Flag pole",
        kind: "circle",
        x: t.x,
        z: t.z,
        radius: 0.12,
      });
      if (this.assets.has(`distance-marker-${t.yards}`)) {
        this.obstacles.push({
          id: "marker-" + i,
          name: "Yardage sign",
          kind: "box",
          minX: t.x + 12.75,
          maxX: t.x + 14.25,
          minZ: t.z - 2.8,
          maxZ: t.z - 2.2,
        });
      }
    }
    // Spread this game's hazards over the full 300 yards so every range
    // tier reveals a couple more: one log, four boulders, four trees.
    const taken: { x: number; z: number }[] = [];
    const strips: [number, number][] = [
      [34, 86],
      [86, 134],
      [134, 180],
      [180, 226],
      [226, 262],
    ];
    const spots: [number, number][] = [];
    for (const [i, [a, b]] of strips.entries())
      spots.push(...this.placeHazards(i === strips.length - 1 ? 1 : 2, taken, a, b));
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    const [logSpot, ...rest] = spots;
    if (logSpot) {
      const [logX, logZ] = logSpot;
      const log = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.58, 6, 32),
        this.environment.surface("bark", "#c6b594", 2),
      );
      log.rotation.z = Math.PI / 2;
      log.position.set(logX, 0.55, logZ);
      log.castShadow = true;
      log.receiveShadow = true;
      this.scene.add(log);
      const end = new THREE.Mesh(
        new THREE.CircleGeometry(0.48, 32),
        material("#b99968"),
      );
      end.rotation.y = Math.PI / 2;
      end.position.set(logX + 3.01, 0.55, logZ);
      this.scene.add(end);
      this.hazards.push({
        id: "fallen-log",
        z: logZ,
        objects: [log, end],
        cleared: false,
        obstacle: {
          id: "fallen-log",
          name: "Fallen log",
          kind: "box",
          minX: logX - 3,
          maxX: logX + 3,
          minZ: logZ - 0.58,
          maxZ: logZ + 0.58,
        },
      });
    }
    const rockScales = [1.6, 2.1, 1.8, 2.3];
    rest.slice(0, 4).forEach(([x, z], i) => {
      const scale = rockScales[i];
      const rockGeometry = new THREE.IcosahedronGeometry(1, 4);
      const points = rockGeometry.getAttribute("position");
      for (let n = 0; n < points.count; n++) {
        const px = points.getX(n), py = points.getY(n), pz = points.getZ(n);
        const irregularity = 1 + Math.sin(px * 9 + pz * 5) * 0.075 + Math.sin(py * 13 - px * 5) * 0.05;
        points.setXYZ(n, px * irregularity, py * irregularity, pz * irregularity);
      }
      // Weld the icosphere faces before recomputing normals so mineral
      // detail follows a rounded weathered surface instead of flat facets.
      rockGeometry.deleteAttribute("normal");
      const smoothRock = mergeVertices(rockGeometry);
      smoothRock.computeVertexNormals();
      rockGeometry.dispose();
      const rock = new THREE.Mesh(smoothRock, this.environment.surface("rock", i % 2 ? "#b9b8a5" : "#d0caba", 1.8));
      rock.position.set(x, scale * 0.55, z);
      rock.scale.set(scale, scale * 0.75, scale * 0.85);
      rock.rotation.y = i * 0.7;
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);
      this.hazards.push({
        id: "rock-" + i,
        z,
        objects: [rock],
        cleared: false,
        obstacle: {
          id: "rock-" + i,
          name: "Boulder",
          kind: "circle",
          x,
          z,
          radius: scale * 0.9,
        },
      });
    });
    rest.slice(4, 8).forEach(([x, z], i) => {
      const tree = this.asset(i % 2 ? "tree-pine" : "tree-broadleaf", x, z, 2.1);
      this.hazards.push({
        id: "range-tree-" + i,
        z,
        objects: [tree],
        cleared: false,
        obstacle: {
          id: "range-tree-" + i,
          name: "Tree",
          kind: "circle",
          x,
          z,
          radius: 0.4,
        },
      });
    });
    this.syncHazards();
  }

  /** Show and activate the hazards inside the current range only. */
  private syncHazards() {
    for (const hazard of this.hazards) {
      const inside = !hazard.cleared && hazard.z < this.rangeEnd - 8;
      for (const object of hazard.objects) object.visible = inside;
      const index = this.obstacles.findIndex((o) => o.id === hazard.id);
      if (inside && index < 0) this.obstacles.push(hazard.obstacle);
      if (!inside && index >= 0) this.obstacles.splice(index, 1);
    }
  }

  /** Random spots for this game's hazards, kept off the greens, the helper's
   *  lanes, the approach to the bays, and each other. */
  private placeHazards(
    count: number,
    taken: { x: number; z: number }[],
    zMin: number,
    zMax: number,
  ): [number, number][] {
    const spots: [number, number][] = [];
    for (let n = 0; n < count; n++)
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = (Math.random() * 2 - 1) * 38;
        const z = zMin + Math.random() * (zMax - zMin);
        if (TARGETS.some((t) => Math.hypot(x - t.x, z - t.z) < 12 * YARD + 4))
          continue;
        if (HELPER_LANES.some((laneZ) => Math.abs(z - laneZ) < 4)) continue;
        if (taken.some((p) => Math.hypot(x - p.x, z - p.z) < 12)) continue;
        spots.push([x, z]);
        taken.push({ x, z });
        break;
      }
    return spots;
  }

  private buildTrees() {
    const pine: THREE.Matrix4[] = [],
      broad: THREE.Matrix4[] = [];
    const random = (i: number) =>
      (((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1) + 1) % 1;
    for (let i = 0; i < 236; i++) {
      const side = i % 2 ? -1 : 1;
      const x = side * (61 + random(i) * 34);
      const z = -15 + Math.floor(i / 2) * 2.6;
      const scale = 2.2 + random(i + 5) * 2.1;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          random(i + 9) * Math.PI * 2,
        ),
        new THREE.Vector3(scale, scale, scale),
      );
      (i % 3 ? pine : broad).push(matrix);
    }
    this.instanceAsset("tree-pine", pine);
    this.instanceAsset("tree-broadleaf", broad);
    this.buildBackTrees();
  }

  /** Move the wooded backdrop beyond the new fence when the range grows. */
  private buildBackTrees() {
    for (const tree of this.backTrees) {
      this.scene.remove(tree);
      tree.geometry.dispose();
    }
    this.backTrees = [];
    const pine: THREE.Matrix4[] = [], broad: THREE.Matrix4[] = [];
    const random = (i: number) => ((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;
    for (let i = 0; i < 104; i++) {
      const scale = 2.4 + random(i + 300) * 1.9;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(-79 + (i % 52) * 3.05 + random(i + 350), -0.02, this.rangeEnd + 13 + Math.floor(i / 52) * 14 + random(i + 400) * 7),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random(i + 500) * Math.PI * 2),
        new THREE.Vector3(scale, scale, scale),
      );
      (i % 4 ? pine : broad).push(matrix);
    }
    this.backTrees.push(...this.instanceAsset("tree-pine", pine), ...this.instanceAsset("tree-broadleaf", broad));
  }

  private instanceAsset(id: string, placements: THREE.Matrix4[]) {
    const created: THREE.InstancedMesh[] = [];
    const root = this.assets.get(id)!.scene;
    root.updateMatrixWorld(true);
    const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material))
        return;
      const geometries = groups.get(object.material) || [];
      geometries.push(object.geometry.clone().applyMatrix4(object.matrixWorld));
      groups.set(object.material, geometries);
    });
    for (const [mat, geometries] of groups) {
      const merged = mergeGeometries(geometries);
      if (!merged) throw new Error(`Could not prepare ${id} geometry`);
      const instance = new THREE.InstancedMesh(merged, mat, placements.length);
      placements.forEach((matrix, i) => instance.setMatrixAt(i, matrix));
      instance.castShadow = true;
      instance.receiveShadow = true;
      instance.computeBoundingSphere();
      this.scene.add(instance);
      created.push(instance);
      geometries.forEach((g) => g.dispose());
    }
    return created;
  }

  private buildWildlife() {
    // Animals switch between grazing, roaming, sudden dashes, and fleeing
    // from the carts, so their paths stay hard to predict.
    for (const [id, x, z, range, offset] of [
      ["goose", 30, 42, 26, 0],
      ["goose", 34, 48, 26, 2],
      ["goose", 28, 46, 26, 4],
      ["fox", -40, 90, 40, 1],
      ["deer", 44, 120, 45, 3],
      ["deer", 40, 136, 45, 6],
    ] as const) {
      const homeZ = Math.min(z, FIELD.maxZ - 10);
      const object = this.asset(id, x, homeZ, 1.35);
      object.position.y = 0.03;
      const mixer = new THREE.AnimationMixer(object);
      const walk = mixer.clipAction(this.assets.get(id)!.animations[0]);
      walk.play().time = offset;
      const animal: Animal = {
        id,
        object,
        mixer,
        walk,
        home: new THREE.Vector3(x, 0, homeZ),
        homeZ: z,
        range,
        target: new THREE.Vector3(x, 0, z),
        heading: offset,
        mode: "roam",
        until: 0,
        phase: offset,
      };
      object.rotation.y = animal.heading;
      this.chooseMode(animal, "roam");
      this.animals.push(animal);
    }
  }

  private chooseMode(animal: Animal, mode?: AnimalMode) {
    const roll = Math.random();
    mode ??= roll < 0.3 ? "graze" : roll < 0.75 ? "roam" : "dash";
    animal.mode = mode;
    const from = animal.object.position;
    if (mode === "graze") {
      animal.until = this.elapsed + 1.5 + Math.random() * 2.5;
      this.pickWanderTarget(animal, 3, 8);
    } else if (mode === "roam") {
      animal.until = this.elapsed + 5 + Math.random() * 6;
      if (from.distanceTo(animal.home) > animal.range)
        this.pickWanderTarget(
          animal,
          10,
          40,
          Math.atan2(animal.home.x - from.x, animal.home.z - from.z),
          0.6,
        );
      else this.pickWanderTarget(animal, 15, 50);
    } else {
      animal.until = this.elapsed + 1.2 + Math.random() * 1.8;
      this.pickWanderTarget(
        animal,
        12,
        30,
        animal.heading + (Math.random() - 0.5) * 2.4,
        0.8,
      );
    }
  }

  private flee(animal: Animal, threat: THREE.Vector3) {
    animal.mode = "flee";
    animal.until = this.elapsed + 2.5 + Math.random() * 1.5;
    const from = animal.object.position;
    this.pickWanderTarget(
      animal,
      18,
      32,
      Math.atan2(from.x - threat.x, from.z - threat.z),
      0.7,
    );
  }

  /** Pick a reachable target between min and max metres away, optionally
   *  near a preferred direction. Widens the search if early picks are blocked. */
  private pickWanderTarget(
    animal: Animal,
    minDist: number,
    maxDist: number,
    direction?: number,
    spread = Math.PI,
  ) {
    const from = animal.object.position;
    for (let attempt = 0; attempt < 14; attempt++) {
      const widen = Math.min(Math.PI, spread * (1 + attempt * 0.35));
      const angle =
        direction === undefined
          ? Math.random() * Math.PI * 2
          : direction + (Math.random() - 0.5) * 2 * widen;
      const distance = minDist + Math.random() * (maxDist - minDist);
      const x = clamp(
        from.x + Math.sin(angle) * distance,
        FIELD.minX,
        FIELD.maxX,
      );
      const z = clamp(
        from.z + Math.cos(angle) * distance,
        FIELD.minZ,
        FIELD.maxZ,
      );
      if (Math.hypot(x - from.x, z - from.z) < 2) continue;
      const steps = Math.ceil(Math.hypot(x - from.x, z - from.z) / 1.5);
      let blocked = false;
      for (let i = 1; i <= steps && !blocked; i++) {
        const point = {
          x: from.x + ((x - from.x) * i) / steps,
          z: from.z + ((z - from.z) * i) / steps,
        };
        for (const obstacle of this.obstacles)
          if (obstacleDistance(point, obstacle) < 1.6) {
            blocked = true;
            break;
          }
      }
      if (blocked) continue;
      animal.target.set(x, 0, z);
      return;
    }
    animal.target.copy(animal.home);
  }

  private buildBalls() {
    let geometry = new THREE.SphereGeometry(0.065 * BALL_VISUAL_SCALE, 8, 6);
    let ballMaterial: THREE.Material = new THREE.MeshStandardMaterial({ color: "#fffdf3", roughness: 0.38 });
    const source = this.assets.get("golf-ball")!.scene;
    source.updateMatrixWorld(true);
    source.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geometry = o.geometry
          .clone()
          .applyMatrix4(o.matrixWorld)
          .center()
          .scale(
            2.2 * BALL_VISUAL_SCALE,
            2.2 * BALL_VISUAL_SCALE,
            2.2 * BALL_VISUAL_SCALE,
          );
        if (!Array.isArray(o.material)) ballMaterial = o.material;
      }
    });
    this.fieldBalls = new THREE.InstancedMesh(geometry, ballMaterial, 1500);
    this.fieldBalls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fieldBalls.frustumCulled = false;
    this.scene.add(this.fieldBalls);
    this.hopperBalls = new THREE.InstancedMesh(geometry, ballMaterial, MAX_HOPPER);
    this.hopperBalls.count = 0;
    this.tractor.add(this.hopperBalls);
    this.flyingBalls = new THREE.InstancedMesh(geometry, ballMaterial, 400);
    this.flyingBalls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flyingBalls.frustumCulled = false;
    this.flyingBalls.count = 0;
    this.scene.add(this.flyingBalls);

    for (let i = 0; i < 180; i++) {
      const x = (Math.random() * 2 - 1) * 40;
      const z = 20 + Math.random() * (this.rangeEnd - 45);
      this.balls.push({
        position: new THREE.Vector3(x, 0.07, z),
        active: true,
      });
    }
    // A visible collection trail starts directly in front of the parked picker.
    for (let i = 0; i < 20; i++)
      this.balls.push({
        position: new THREE.Vector3(
          -42 + Math.sin(i) * 0.9,
          0.07,
          24 + i * 1.7,
        ),
        active: true,
      });
    this.syncBalls();
  }

  private label(
    text: string,
    color: string,
    kind: "yards" | "mood" | "wide" = "yards",
    subtitle = "",
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = kind === "wide" ? 512 : kind === "mood" ? 384 : 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#18241ee8";
    ctx.beginPath();
    ctx.roundRect(4, 4, canvas.width - 8, 110, 10);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#f5f3df";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size =
      kind === "wide" ? 38 : kind === "mood" ? (subtitle ? 46 : 54) : 57;
    ctx.font = `600 ${size}px system-ui`;
    const maxWidth = canvas.width - 44;
    const measured = ctx.measureText(text).width;
    if (measured > maxWidth) {
      size = Math.floor((size * maxWidth) / measured);
      ctx.font = `600 ${size}px system-ui`;
    }
    ctx.fillText(text, canvas.width / 2, subtitle ? 76 : 61);
    if (subtitle) {
      ctx.fillStyle = color;
      ctx.font = "700 22px system-ui";
      ctx.fillText(subtitle, canvas.width / 2, 33);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
      }),
    );
    if (kind === "mood") sprite.scale.set(1.8, 0.6, 1);
    else sprite.scale.set(kind === "wide" ? 6.5 : 3.6, 1.8, 1);
    return sprite;
  }

  addFieldBall(point: Point, delay = 0, collectible = true) {
    if (this.balls.length > 1000) {
      const active = this.balls.filter((b) => b.active);
      this.balls.length = 0;
      this.balls.push(...active);
    }
    this.balls.push({
      position: new THREE.Vector3(
        collectible ? clamp(point.x, -52, 52) : point.x,
        0.07,
        clamp(point.z, 10, this.rangeEnd - 3),
      ),
      active: true,
      pickableAt: collectible ? this.elapsed + delay : Infinity,
    });
    this.syncBalls();
  }

  launchGolferShot(order: ShotOrder, wind: number) {
    const npc = this.golfers[order.golfer];
    if (!npc || !npc.object.visible) return;
    // Golfers mostly aim at a pin they can reach and miss by a bit, and the
    // rest of the time just let one fly somewhere down the range.
    const reach = Math.min(REACH_YARDS[npc.type], this.rangeYards - 12);
    const maxZ = TEE.z + reach * YARD;
    const scatter = (k: number) =>
      (Math.random() + Math.random() + Math.random() - 1.5) * k;
    let x: number, z: number;
    const pins = TARGETS.filter(
      (t) => t.z <= maxZ + 4 && t.z < this.rangeEnd - 18,
    );
    if (Math.random() < 0.55 && pins.length) {
      const pin = pins[Math.floor(Math.random() * pins.length)];
      x = pin.x + scatter(19);
      z = pin.z + scatter(17);
    } else {
      x = (Math.random() * 2 - 1) * 42;
      z = TEE.z + (30 + Math.random() * (reach - 30)) * YARD;
    }
    x = clamp(x, -46, 46);
    z = clamp(z, 25, this.rangeEnd - 10);
    let shape: Shape =
      Math.random() < 0.34 ? "draw" : Math.random() < 0.5 ? "fade" : "straight";
    // A left-hander's draw and fade curve the opposite way.
    if (npc.leftHanded && shape !== "straight") shape = shape === "draw" ? "fade" : "draw";
    if (order.lost) {
      // A slice that clears the boundary fence and is gone for good.
      x = (order.golfer % 2 ? -1 : 1) * (61 + Math.random() * 5);
      z = 30 + Math.random() * Math.max(20, this.rangeEnd - 60);
    }
    const aim =
      (-Math.atan2(x - npc.origin.x, z - npc.origin.z) * 180) / Math.PI;
    const distance = Math.hypot(x - npc.origin.x, z - npc.origin.z) / YARD;
    const club =
      CLUBS.find((c) => c.carry >= distance) || CLUBS[CLUBS.length - 1];
    let low = 0.1,
      high = 1;
    for (let i = 0; i < 10; i++) {
      const power = (low + high) / 2;
      const shot = simulateShot(
        { club, power, aim, wind, shape },
        npc.origin,
      );
      if (shot.total < distance) low = power;
      else high = power;
    }
    const shot = simulateShot(
      { club, power: (low + high) / 2, aim, wind, shape },
      npc.origin,
    );
    npc.swing.reset().setEffectiveTimeScale(SWING_SPEED).play();
    npc.swing.paused = false;
    const trail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        shot.points.filter((_, i) => i % 6 === 0).map(vector),
      ),
      new THREE.LineBasicMaterial({
        color: "#fff8d8",
        transparent: true,
        opacity: 0.42,
      }),
    );
    trail.geometry.setDrawRange(0, 0);
    this.scene.add(trail);
    // Keep the ball on the tee through the backswing, releasing exactly at
    // the exported clip's impact pose rather than halfway through the clip.
    this.airShots.push({
      shot,
      time: -(SWING_IMPACT_SECONDS / SWING_SPEED) * FLIGHT_SPEED,
      point: { ...npc.origin },
      trail,
      lost: order.lost,
    });
  }

  updateFlights(dt: number): number {
    let hits = 0;
    for (let i = this.airShots.length - 1; i >= 0; i--) {
      const flight = this.airShots[i],
        previous = flight.point;
      flight.time += dt * FLIGHT_SPEED;
      flight.point = sampleShot(flight.shot, Math.max(0, flight.time));
      const hit =
        flight.time > 0 &&
        segmentHitsVehicle(previous, flight.point, {
          x: this.tractor.position.x,
          z: this.tractor.position.z,
          angle: this.tractorAngle,
        });
      if (hit || flight.time >= flight.shot.duration) {
        if (hit) {
          hits++;
          this.bouncingBalls.push({
            position: vector(flight.point),
            velocity: new THREE.Vector3(
              Math.sin(this.elapsed * 9) * 2,
              3,
              -1.5,
            ),
          });
        } else this.addFieldBall(flight.shot.end, 0, !flight.lost);
        this.scene.remove(flight.trail);
        flight.trail.geometry.dispose();
        (flight.trail.material as THREE.Material).dispose();
        this.airShots.splice(i, 1);
      } else {
        const index = Math.min(
          Math.floor(Math.max(0, flight.time) * 10),
          flight.trail.geometry.getAttribute("position").count,
        );
        flight.trail.geometry.setDrawRange(
          Math.max(0, index - 22),
          Math.min(index, 22),
        );
      }
    }
    for (let i = this.bouncingBalls.length - 1; i >= 0; i--) {
      const ball = this.bouncingBalls[i];
      ball.velocity.y -= 9.81 * dt;
      ball.position.addScaledVector(ball.velocity, dt);
      if (Math.abs(ball.position.x) > 52) {
        ball.position.x = clamp(ball.position.x, -52, 52);
        ball.velocity.x *= -0.4;
      }
      if (ball.position.z < 10 || ball.position.z > this.rangeEnd - 3) {
        ball.position.z = clamp(ball.position.z, 10, this.rangeEnd - 3);
        ball.velocity.z *= -0.4;
      }
      if (ball.position.y < 0.07) {
        ball.position.y = 0.07;
        ball.velocity.y = Math.abs(ball.velocity.y) * 0.34;
        ball.velocity.x *= 0.65;
        ball.velocity.z *= 0.65;
        if (ball.velocity.y < 0.65) {
          this.addFieldBall(ball.position, 0.8);
          this.bouncingBalls.splice(i, 1);
        }
      }
    }
    const positions = [
      ...this.airShots.filter((f) => f.time >= 0).map((f) => vector(f.point)),
      ...this.bouncingBalls.map((b) => b.position),
    ];
    this.flyingBalls.count = positions.length;
    positions.forEach((point, i) => {
      this.ballDummy.position.copy(point);
      this.ballDummy.scale.setScalar(1.7);
      this.ballDummy.updateMatrix();
      this.flyingBalls.setMatrixAt(i, this.ballDummy.matrix);
    });
    this.flyingBalls.instanceMatrix.needsUpdate = true;
    return hits;
  }

  spillBalls(count: number, cause: SpillCause) {
    this.shakeTime = 0.35;
    const origin = new THREE.Vector3(0, 1.25, -1.27)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.tractorAngle)
      .add(this.tractor.position);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996 + this.elapsed * 3,
        speed = 2.8 + (i % 7) * 0.45;
      this.bouncingBalls.push({
        position: origin.clone(),
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          3.5 + (i % 5) * 0.6,
          Math.sin(angle) * speed,
        ),
      });
    }
  }

  syncGolfers(states: GolferState[]) {
    for (const state of states) {
      const npc = this.golfers[state.id];
      if (!npc) continue;
      if (state.type !== npc.type) {
        npc.type = state.type;
        npc.polo?.color.set(GOLFER_TYPES[state.type].color);
        const driverPolo = npc.cart?.driver.getObjectByName("DriverPolo") as THREE.Mesh | undefined;
        if (driverPolo?.material instanceof THREE.MeshStandardMaterial)
          driverPolo.material.color.set(GOLFER_TYPES[state.type].color);
      }
      if (state.leftHanded !== npc.leftHanded) this.setHandedness(npc, state.leftHanded);
      if (state.status !== npc.status) this.transitionGolfer(npc, state);
      if (state.status === "empty") continue;
      const key =
        state.status === "leaving"
          ? "leaving"
          : npc.cart?.phase === "arriving" || (npc.walk && !npc.walk.hide)
            ? "arriving"
          : state.waiting
            ? state.patience < 35
              ? "upset"
              : "waiting"
            : state.patience < 70
              ? "impatient"
              : "happy";
      const moodKey = `${state.type}:${key}`;
      if (npc.moodKey === moodKey) continue;
      npc.moodKey = moodKey;
      const text =
        key === "arriving"
          ? "ARRIVING"
          : key === "waiting"
          ? "NO BALLS"
          : key === "upset"
            ? "UPSET"
            : key === "impatient"
              ? "IMPATIENT"
              : key === "leaving"
                ? "LEAVING"
                : "HAPPY";
      const color =
        key === "happy"
          ? "#a7be79"
          : key === "upset" || key === "leaving"
            ? "#df8366"
            : "#e4ba72";
      const replacement = this.label(
        text,
        color,
        "mood",
        GOLFER_TYPES[state.type].name.toUpperCase(),
      );
      (npc.mood.material as THREE.SpriteMaterial).map?.dispose();
      npc.mood.material.dispose();
      npc.mood.material = replacement.material;
      if (state.waiting || state.status === "leaving") {
        npc.swing.reset().play();
        npc.swing.paused = true;
      }
    }
  }

  /** Turn the bay into a left-handed bay (or back): mirror the whole bay on X so the
   *  divider, roof post, tee, and dispenser swap sides, then mirror the right-handed
   *  rig so the swing plays the other way and stand it on the far side of the moved tee. */
  private setHandedness(npc: NPC, leftHanded: boolean) {
    npc.leftHanded = leftHanded;
    npc.bay.scale.x = leftHanded ? -1 : 1;
    npc.origin = this.teeOrigin(npc.bay);
    npc.object.scale.x = (leftHanded ? -1 : 1) * GOLFER_SCALE;
    if (npc.status === "playing" && !npc.walk && npc.object.visible) {
      npc.object.position.x = stanceX(npc);
      npc.object.rotation.y = stanceAngle(npc);
    }
  }

  private transitionGolfer(npc: NPC, state: GolferState) {
    npc.status = state.status;
    if (state.status === "playing") {
      npc.object.visible = false;
      npc.mood.visible = false;
      npc.swing.reset().play();
      npc.swing.paused = true;
      npc.walk = undefined;
      npc.cart = this.createVisitorCart(npc, state.id, true);
    } else if (state.status === "leaving") {
      const from = npc.object.position.clone();
      npc.swing.reset().play();
      npc.swing.paused = true;
      npc.mixer.update(0);
      npc.cart ??= this.createVisitorCart(npc, state.id, false);
      npc.walk = {
        from,
        to: this.boardingPoint(npc.cart),
        start: this.elapsed,
        duration: BAY_WALK_SECONDS,
        hide: true,
      };
    } else {
      npc.object.visible = false;
      npc.mood.visible = false;
      npc.walk = undefined;
      if (npc.cart?.phase === "parked") this.departGolfCart(npc.cart);
      npc.cart = undefined;
    }
  }

  private updateWalks() {
    for (const npc of this.golfers) {
      const walk = npc.walk;
      if (!walk) continue;
      const t = Math.min(1, (this.elapsed - walk.start) / walk.duration);
      npc.object.position.lerpVectors(walk.from, walk.to, t);
      npc.object.rotation.y = Math.atan2(
        walk.to.x - walk.from.x,
        walk.to.z - walk.from.z,
      );
      // Hip and knee pivots give the short boarding walk a real stepping gait.
      for (const [i, hip] of npc.hips.entries()) {
        hip.userData.gaitRestX ??= hip.rotation.x;
        hip.rotation.x = hip.userData.gaitRestX + Math.sin(t * walk.duration * 8 + i * Math.PI) * 0.27;
      }
      for (const [i, knee] of npc.knees.entries()) {
        knee.userData.gaitRestX ??= knee.rotation.x;
        knee.rotation.x = knee.userData.gaitRestX + Math.max(0, Math.sin(t * walk.duration * 8 + i * Math.PI)) * 0.32;
      }
      npc.object.position.y += Math.sin(t * walk.duration * 16) * 0.016;
      if (t < 1) continue;
      npc.walk = undefined;
      for (const joint of [...npc.hips, ...npc.knees]) joint.rotation.x = joint.userData.gaitRestX;
      npc.object.position.copy(walk.to);
      if (walk.hide) {
        npc.object.visible = false;
        npc.mood.visible = false;
        if (npc.cart) this.departGolfCart(npc.cart);
        npc.cart = undefined;
      } else npc.object.rotation.y = stanceAngle(npc);
    }
  }

  /** Each occupied bay keeps its visitor's resort cart parked behind it. */
  private createVisitorCart(npc: NPC, index: number, arriving: boolean): VisitorCart {
    const model = createGolfCart(CART_COLORS[index % CART_COLORS.length], GOLFER_TYPES[npc.type].color);
    const park = new THREE.Vector3(stanceX(npc), 0.02, -4.6);
    const cart: VisitorCart = {
      ...model, npc, park, phase: arriving ? "arriving" : "parked",
      start: this.elapsed, legs: [],
    };
    model.object.name = `VisitorGolfCart_${index}_${this.elapsed}`;
    model.object.userData.golferId = index;
    model.driver.visible = arriving;
    if (arriving) {
      const lane = -8.5;
      const entry = new THREE.Vector3(-80, 0.02, lane);
      const turn = new THREE.Vector3(park.x - 8, 0.02, lane);
      const path = new THREE.CurvePath<THREE.Vector3>();
      path.add(new THREE.LineCurve3(entry, turn));
      path.add(new THREE.CubicBezierCurve3(turn,
        new THREE.Vector3(park.x, 0.02, lane),
        new THREE.Vector3(park.x, 0.02, park.z - 2), park.clone()));
      cart.legs.push({ path, duration: CART_ARRIVAL_SECONDS });
      model.object.position.copy(entry);
      model.object.rotation.y = Math.PI / 2;
    } else model.object.position.copy(park);
    this.scene.add(model.object);
    this.golfCarts.push(cart);
    return cart;
  }

  private boardingPoint(cart: VisitorCart) {
    return new THREE.Vector3(cart.park.x - 0.78, 0.18, cart.park.z + 0.3);
  }

  private departGolfCart(cart: VisitorCart) {
    if (cart.phase === "departing") return;
    cart.driver.visible = true;
    cart.phase = "departing";
    cart.start = this.elapsed;
    const lane = -8.5;
    const merge = new THREE.Vector3(cart.park.x - 6, 0.02, lane);
    const reverse = new THREE.CubicBezierCurve3(cart.park.clone(),
      new THREE.Vector3(cart.park.x, 0.02, cart.park.z - 2.8),
      new THREE.Vector3(cart.park.x - 2.5, 0.02, lane), merge);
    const exit = new THREE.LineCurve3(merge, new THREE.Vector3(85, 0.02, lane));
    cart.legs = [
      { path: reverse, duration: 1.5, reverse: true },
      { path: exit, duration: exit.getLength() / 10 },
    ];
  }

  private updateGolfCarts() {
    for (let i = this.golfCarts.length - 1; i >= 0; i--) {
      const cart = this.golfCarts[i];
      if (cart.phase === "parked") continue;
      let time = this.elapsed - cart.start;
      let active: CartLeg | undefined;
      for (const leg of cart.legs) {
        if (time < leg.duration) { active = leg; break; }
        time -= leg.duration;
      }
      if (active) {
        const t = clamp(time / active.duration, 0, 1);
        const point = active.path.getPointAt(t);
        const tangent = active.path.getTangentAt(t);
        const distance = cart.object.position.distanceTo(point);
        cart.object.position.copy(point);
        cart.object.rotation.y = Math.atan2(tangent.x, tangent.z) + (active.reverse ? Math.PI : 0);
        for (const wheel of cart.wheels) wheel.rotation.x += distance / 0.25 * (active.reverse ? -1 : 1);
        continue;
      }
      if (cart.phase === "arriving") {
        cart.phase = "parked";
        cart.object.position.copy(cart.park);
        cart.object.rotation.y = 0;
        cart.driver.visible = false;
        const npc = cart.npc;
        const outside = this.boardingPoint(cart);
        npc.object.position.copy(outside);
        npc.object.visible = npc.status === "playing";
        npc.mood.visible = npc.object.visible;
        npc.swing.reset().play();
        npc.swing.paused = true;
        npc.mixer.update(0);
        npc.walk = {
          from: outside, to: new THREE.Vector3(stanceX(npc), 0.18, npc.origin.z),
          start: cart.start + CART_ARRIVAL_SECONDS, duration: BAY_WALK_SECONDS, hide: false,
        };
      } else {
        this.scene.remove(cart.object);
        disposeGolfCart(cart);
        this.golfCarts.splice(i, 1);
      }
    }
  }

  /** Swap cart parts to match the purchased upgrade levels. */
  applyCart(setup: CartSetup) {
    this.cart = setup;
    this.hopperBeacon.setLoad(this.hopperBalls.count, setup.capacity);
    const visual = this.cartVisual;
    if (visual.collector !== setup.collector) {
      visual.collector = setup.collector;
      for (const wing of this.wings) this.tractor.remove(wing);
      this.wings = [];
      this.wingRollers = [];
      if (setup.collector > 0) {
        const scale = setup.collector === 1 ? 0.6 : 1;
        const offset = 1.42 + 0.12 + 1.43 * scale;
        for (const side of [-1, 1]) this.buildWing(side * offset, scale);
      }
    }
    if (visual.cage !== setup.cage) {
      visual.cage = setup.cage;
      if (this.cage) this.tractor.remove(this.cage);
      this.cage = undefined;
      if (setup.cage > 0) {
        const cage = new THREE.Group();
        const frameParts: THREE.BufferGeometry[] = [];
        for (const x of [-0.85, 0.85])
          for (const z of [-0.525, 0.525])
            frameParts.push(new THREE.BoxGeometry(0.035, 0.75, 0.035).translate(x, 0, z));
        for (const y of [-0.375, 0.375]) {
          for (const z of [-0.525, 0.525])
            frameParts.push(new THREE.BoxGeometry(1.7, 0.035, 0.035).translate(0, y, z));
          for (const x of [-0.85, 0.85])
            frameParts.push(new THREE.BoxGeometry(0.035, 0.035, 1.05).translate(x, y, 0));
        }
        const frame = new THREE.Mesh(mergeGeometries(frameParts)!, new THREE.MeshStandardMaterial({color: "#38433b", roughness: 0.5, metalness: 0.75}));
        frameParts.forEach((part) => part.dispose());
        frame.castShadow = true;
        cage.add(frame);
        for (const dx of [-0.42, 0, 0.42]) {
          const bar = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.75, 0.03),
            material("#1f2a22"),
          );
          bar.position.set(dx, 0, 0.52);
          cage.add(bar);
          const back = bar.clone();
          back.position.z = -0.52;
          cage.add(back);
        }
        if (setup.cage > 1) {
          const panels = new THREE.Mesh(
            new THREE.BoxGeometry(1.7, 0.75, 1.05),
            this.environment.netMaterial(),
          );
          (panels.material as THREE.MeshStandardMaterial).map!.repeat.set(3, 2);
          cage.add(panels);
        }
        cage.position.set(0, 1.25 + 0.375, -1.28);
        this.tractor.add(cage);
        this.cage = cage;
      }
    }
    if (visual.bumper !== setup.bumper) {
      visual.bumper = setup.bumper;
      if (this.bumper) this.tractor.remove(this.bumper);
      this.bumper = undefined;
      if (setup.bumper > 0) {
        const bumper = new THREE.Group();
        const big = setup.bumper > 1;
        const bar = new THREE.Mesh(
          this.environment.roundedBox(big ? 2.1 : 1.9, big ? 0.36 : 0.26, 0.3, 0.05),
          material("#2b2b2b"),
        );
        bar.position.set(0, 0.62, big ? 1.78 : 1.7);
        bar.castShadow = true;
        bumper.add(bar);
        if (big)
          for (const dx of [-0.7, 0.7]) {
            const post = new THREE.Mesh(
              new THREE.BoxGeometry(0.12, 0.7, 0.12),
              material("#2b2b2b"),
            );
            post.position.set(dx, 0.95, 1.78);
            bumper.add(post);
          }
        this.tractor.add(bumper);
        this.bumper = bumper;
      }
    }
    if (visual.hopper !== setup.hopper) {
      visual.hopper = setup.hopper;
      if (this.boards) this.tractor.remove(this.boards);
      this.boards = undefined;
      if (setup.hopper > 0) {
        const boards = new THREE.Group();
        // Side boards grow with each hopper tier.
        const height = 0.2 * setup.hopper;
        const mesh = this.environment.netMaterial();
        mesh.map!.repeat.set(5, 2);
        const rim = new THREE.MeshStandardMaterial({color: "#b76832", roughness: 0.42, metalness: 0.35});
        for (const [w, d, px, pz] of [
          [0.06, 1.0, -0.78, -1.28],
          [0.06, 1.0, 0.78, -1.28],
          [1.62, 0.06, 0, -0.78],
          [1.62, 0.06, 0, -1.78],
        ]) {
          const board = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), mesh);
          board.position.set(px, 1.25 + height / 2, pz);
          board.castShadow = true;
          boards.add(board);
          const rail = new THREE.Mesh(this.environment.roundedBox(w, 0.045, d, 0.01), rim);
          rail.position.set(px, 1.25 + height, pz);
          rail.castShadow = true;
          boards.add(rail);
        }
        this.tractor.add(boards);
        this.boards = boards;
      }
    }
  }

  private buildWing(offsetX: number, scale: number) {
    const roller = this.tractorModel.getObjectByName("CollectorRoller");
    if (!roller) return;
    const wing = new THREE.Group();
    const copy = roller.clone(true);
    copy.position.set(0, 0.22, 2.04);
    wing.add(copy);
    for (const side of [-1.5, 1.5]) {
      const wheel = this.tractorModel.getObjectByName("CollectorGuideWheel");
      if (!wheel) continue;
      const w = wheel.clone(true);
      w.position.set(side, 0.2, 2.04);
      wing.add(w);
    }
    wing.position.x = offsetX;
    wing.scale.x = scale;
    this.tractor.add(wing);
    this.wings.push(wing);
    this.wingRollers.push(copy);
  }

  /** Tall netting along the boundary, taller and all around at level 2. */
  setNets(level: number) {
    if (level === this.netLevel) return;
    this.netLevel = level;
    if (this.nets) this.scene.remove(this.nets);
    this.nets = undefined;
    if (level <= 0) return;
    const nets = new THREE.Group();
    const height = level === 1 ? 7 : 11;
    const end = this.rangeEnd;
    const mesh = this.environment.netMaterial();
    mesh.map!.repeat.set(end, height);
    const post = material("#6e6a5c");
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(end, height),
        mesh,
      );
      panel.rotation.y = Math.PI / 2;
      panel.position.set(side * 55.5, height / 2, end / 2);
      nets.add(panel);
      for (let z = 0; z <= end; z += 16) {
        const pole = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, height, 0.22),
          post,
        );
        pole.position.set(side * 55.5, height / 2, z);
        nets.add(pole);
      }
    }
    if (level > 1) {
      const backMaterial = this.environment.netMaterial();
      backMaterial.map!.repeat.set(112, height);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(112, height), backMaterial);
      back.position.set(0, height / 2, end + 0.5);
      nets.add(back);
    }
    this.scene.add(nets);
    this.nets = nets;
  }

  /** Remove bought-out hazards: the log at level 1, boulders at level 2. */
  clearObstacles(level: number) {
    const ids =
      level >= 2
        ? ["fallen-log", "rock-0", "rock-1", "rock-2", "rock-3"]
        : level >= 1
          ? ["fallen-log"]
          : [];
    for (const hazard of this.hazards) {
      hazard.cleared = ids.includes(hazard.id);
      for (const object of hazard.objects)
        if (hazard.cleared) this.scene.remove(object);
        else this.scene.add(object);
    }
    this.syncHazards();
  }

  addSecondDepot() {
    if (this.depots.length > 1) return;
    const position = new THREE.Vector3(27, 0, Math.min(150, this.rangeEnd - 25));
    const object = this.asset("ball-depot", position.x, position.z, 1.5);
    this.obstacles.push({
      id: "depot-2",
      name: "Ball depot",
      kind: "box",
      minX: position.x - 2.25,
      maxX: position.x + 2.25,
      minZ: position.z - 2.8,
      maxZ: position.z - 0.35,
    });
    const label = this.label("BALL RETURN", "#e0b878", "wide");
    label.position.set(position.x, 5.7, position.z);
    this.scene.add(label);
    this.secondDepot = { object, label };
    this.depots.push(position);
  }

  enableHelper() {
    if (this.helper) return;
    const object = clone(this.assets.get("tractor-picker")!.scene) as THREE.Group;
    object.traverse((node) => {
      if (
        node instanceof THREE.Mesh &&
        node.material instanceof THREE.MeshStandardMaterial
      ) {
        const c = node.material.color;
        if (c.r > 0.5 && c.g < 0.35) {
          node.material = node.material.clone();
          node.material.color.set("#3f7f8c");
        }
      }
    });
    object.position.set(-40, 0.03, 14);
    this.scene.add(object);
    this.helper = {
      object,
      angle: 0,
      hopper: 0,
      index: 0,
      pauseUntil: 0,
      roller: object.getObjectByName("CollectorRoller") ?? undefined,
    };
  }

  /** Drive the helper along its route. Returns balls it just unloaded. */
  updateHelper(dt: number): number {
    const h = this.helper;
    if (!h || this.elapsed < h.pauseUntil) return 0;
    const route = this.helperRoute;
    const target = route[h.index];
    const dx = target[0] - h.object.position.x,
      dz = target[1] - h.object.position.z,
      distance = Math.hypot(dx, dz);
    if (distance < 1.5) {
      if (h.index === route.length - 1) {
        const delivered = h.hopper;
        h.hopper = 0;
        h.index = 0;
        h.pauseUntil = this.elapsed + 2;
        return delivered;
      }
      h.index++;
      return 0;
    }
    const desired = Math.atan2(dx, dz);
    let delta = desired - h.angle;
    delta -= Math.round(delta / (Math.PI * 2)) * Math.PI * 2;
    h.angle += clamp(delta, -dt * 1.6, dt * 1.6);
    const speed = 7 * Math.max(0.3, 1 - Math.abs(delta) / Math.PI) * cartSpeedMultiplier(h.object.position, this.rangeEnd);
    h.object.position.x += Math.sin(h.angle) * speed * dt;
    h.object.position.z += Math.cos(h.angle) * speed * dt;
    h.object.rotation.y = h.angle;
    if (h.roller) h.roller.rotation.x += speed * dt * 2;
    const collected = this.pickup(
      h.object.position,
      h.angle,
      1.6,
      HELPER_HOPPER - h.hopper,
    );
    if (collected) {
      h.hopper += collected;
      this.syncBalls();
    }
    if (h.hopper >= HELPER_HOPPER) h.index = route.length - 1;
    return 0;
  }

  /** Collect balls inside the pickup swath ahead of a cart. */
  private pickup(
    position: THREE.Vector3,
    angle: number,
    halfWidth: number,
    room: number,
  ): number {
    let collected = 0;
    const sin = Math.sin(angle),
      cos = Math.cos(angle);
    for (const ball of this.balls) {
      if (collected >= room) break;
      if (!ball.active || (ball.pickableAt ?? 0) > this.elapsed) continue;
      const dx = ball.position.x - position.x,
        dz = ball.position.z - position.z;
      const forward = dx * sin + dz * cos,
        lateral = dx * cos - dz * sin;
      if (forward > 0.9 && forward < 3.2 && Math.abs(lateral) < halfWidth) {
        ball.active = false;
        collected++;
      }
    }
    return collected;
  }

  /** Rotate the chase camera around the cart by a mouse movement. */
  orbit(dx: number, dy: number) {
    this.lookYaw -= dx * 0.006;
    this.lookYaw -= Math.round(this.lookYaw / (Math.PI * 2)) * Math.PI * 2;
    this.lookPitch = clamp(this.lookPitch + dy * 0.004, -0.5, 0.9);
    this.lookHoldUntil = this.elapsed + 1.8;
  }

  zoomBy(delta: number) {
    this.lookZoom = clamp(this.lookZoom * (1 + delta * 0.0012), 0.55, 2);
  }

  recover() {
    this.tractor.position.set(-42, 0.03, 20);
    this.tractorAngle = 0;
    this.tractorSpeed = 0;
    this.tractorTerrainSpeed = 1;
    this.latchedCollisions.clear();
  }

  syncBalls() {
    this.fieldBalls.count = this.balls.length;
    this.balls.forEach((ball, i) => {
      this.ballDummy.position.copy(ball.position);
      this.ballDummy.scale.setScalar(ball.active ? 1 : 0);
      this.ballDummy.updateMatrix();
      this.fieldBalls.setMatrixAt(i, this.ballDummy.matrix);
    });
    this.fieldBalls.instanceMatrix.needsUpdate = true;
  }

  setHopper(count: number) {
    this.hopperBeacon.setLoad(count, this.cart.capacity);
    this.hopperBalls.count = Math.min(count, MAX_HOPPER);
    for (let i = 0; i < this.hopperBalls.count; i++) {
      this.ballDummy.position.set(
        -0.55 + (i % 8) * 0.15,
        0.8 + Math.floor(i / 40) * 0.12,
        -1.03 - Math.floor((i % 40) / 8) * 0.13,
      );
      this.ballDummy.scale.setScalar(1);
      this.ballDummy.updateMatrix();
      this.hopperBalls.setMatrixAt(i, this.ballDummy.matrix);
    }
    this.hopperBalls.instanceMatrix.needsUpdate = true;
  }

  drive(
    dt: number,
    forward: number,
    steer: number,
    brake: boolean,
    hopper: number,
  ): DriveResult {
    const max = forward < 0 ? this.cart.maxSpeed * 0.45 : this.cart.maxSpeed,
      desired = forward * max;
    // Preserve the engine response while terrain scales actual speed exactly once.
    const engineSpeed = this.tractorSpeed / this.tractorTerrainSpeed;
    this.tractorTerrainSpeed = cartSpeedMultiplier(this.tractor.position, this.rangeEnd);
    this.tractorSpeed = (engineSpeed + (desired - engineSpeed) *
      Math.min(1, dt * (brake ? 9 : 2.2 * (this.cart.maxSpeed / 9)))) * this.tractorTerrainSpeed;
    if (brake) this.tractorSpeed *= Math.max(0, 1 - dt * 7);
    this.tractorAngle -= steer * this.tractorSpeed * 0.12 * dt;
    this.tractor.rotation.y = this.tractorAngle;
    const previous = this.tractor.position.clone();
    const obstacles = [
      ...this.obstacles,
      ...this.animals.map((a, i) => ({
        id: "animal-" + i,
        name: a.id === "goose" ? "Goose" : a.id === "fox" ? "Fox" : "Deer",
        kind: "circle" as const,
        x: a.object.position.x,
        z: a.object.position.z,
        radius: a.id === "deer" ? 0.65 : 0.42,
      })),
    ];
    for (const id of this.latchedCollisions) {
      const obstacle = obstacles.find((o) => o.id === id);
      if (
        !obstacle ||
        obstacleDistance(previous, obstacle) > VEHICLE_RADIUS + 0.75
      )
        this.latchedCollisions.delete(id);
    }
    const result = resolveMove(
      previous,
      {
        x: previous.x + Math.sin(this.tractorAngle) * this.tractorSpeed * dt,
        z: previous.z + Math.cos(this.tractorAngle) * this.tractorSpeed * dt,
      },
      obstacles,
    );
    this.tractor.position.x = result.position.x;
    this.tractor.position.z = result.position.z;
    let collision: Obstacle | undefined;
    if (result.hit) {
      if (
        !this.latchedCollisions.has(result.hit.id) &&
        Math.abs(this.tractorSpeed) > 0.5
      ) {
        collision = result.hit;
        this.latchedCollisions.add(result.hit.id);
      }
      this.tractorSpeed *= -0.18;
    }
    this.tractorWheels.forEach((w) => {
      w.rotation.x += (this.tractorSpeed * dt) / 0.4;
    });
    this.tractorSteering.forEach((w) => {
      w.rotation.y = -steer * 0.4;
    });
    if (this.collectorRoller) {
      this.collectorRoller.rotation.x += this.tractorSpeed * dt * 2;
      for (const roller of this.wingRollers)
        roller.rotation.x = this.collectorRoller.rotation.x;
    }
    const collected = this.pickup(
      this.tractor.position,
      this.tractorAngle,
      this.cart.halfWidth,
      this.cart.capacity - hopper,
    );
    if (collected) this.syncBalls();
    return { collected, collision };
  }

  private wander(animal: Animal, dt: number) {
    const position = animal.object.position;
    if (animal.mode !== "flee")
      for (const cart of [this.tractor.position, this.helper?.object.position])
        if (cart && cart.distanceTo(position) < SPOOK_DISTANCE) {
          this.flee(animal, cart);
          break;
        }
    let dx = animal.target.x - position.x,
      dz = animal.target.z - position.z,
      distance = Math.hypot(dx, dz);
    if (this.elapsed >= animal.until || distance < 0.8) {
      this.chooseMode(animal, animal.mode === "flee" ? "roam" : undefined);
      dx = animal.target.x - position.x;
      dz = animal.target.z - position.z;
      distance = Math.hypot(dx, dz);
    }
    const speed = WILDLIFE_SPEEDS[animal.id][animal.mode];
    const desired = Math.atan2(dx, dz);
    let delta = desired - animal.heading;
    delta -= Math.round(delta / (Math.PI * 2)) * Math.PI * 2;
    const turn = TURN_RATES[animal.mode];
    animal.heading += clamp(delta, -dt * turn, dt * turn);
    // Running animals zig-zag instead of holding a straight line.
    if (animal.mode === "dash" || animal.mode === "flee")
      animal.heading += Math.sin(this.elapsed * 6 + animal.phase) * dt * 1.6;
    let step =
      Math.min(distance, speed * dt) *
      Math.max(0.35, 1 - Math.abs(delta) / Math.PI);
    // Veer off anything solid directly ahead.
    const ahead = {
      x: position.x + Math.sin(animal.heading) * 1.5,
      z: position.z + Math.cos(animal.heading) * 1.5,
    };
    for (const obstacle of this.obstacles)
      if (obstacleDistance(ahead, obstacle) < 1) {
        animal.heading += dt * 4;
        step *= 0.5;
        break;
      }
    position.x = clamp(
      position.x + Math.sin(animal.heading) * step,
      FIELD.minX,
      FIELD.maxX,
    );
    position.z = clamp(
      position.z + Math.cos(animal.heading) * step,
      FIELD.minZ,
      FIELD.maxZ,
    );
    animal.object.rotation.y = animal.heading;
    animal.walk.setEffectiveTimeScale(0.5 + speed * 0.55);
    animal.mixer.update(dt);
  }

  update(dt: number) {
    this.elapsed += dt;
    this.hopperBeacon.update(dt);
    this.environment.update(this.elapsed);
    // Keep the shadow texels concentrated around the player instead of
    // stretching one map over the full 300-yard range.
    this.sun.target.position.set(this.tractor.position.x, 0, this.tractor.position.z + 20);
    this.sun.position.set(this.tractor.position.x - 62, 68, this.tractor.position.z - 53);
    for (const golfer of this.golfers) golfer.mixer.update(dt);
    for (const animal of this.animals) this.wander(animal, dt);
    this.updateWalks();
    this.updateGolfCarts();
    if (this.cameraMode === "overview") {
      const end = this.rangeEnd;
      this.targetCamera.set(end * 0.36, end * 0.6 + 20, -end * 0.2);
      this.targetLook.set(0, 0, end * 0.47);
    } else {
      // Ease the look offset back behind the cart once the mouse is released.
      if (!this.looking && this.elapsed > this.lookHoldUntil) {
        const ease = Math.min(1, dt * 2.5);
        this.lookYaw += (0 - this.lookYaw) * ease;
        this.lookPitch += (0 - this.lookPitch) * ease;
      }
      const a = this.tractorAngle + this.lookYaw,
        back = 12 * this.lookZoom,
        height = (4.4 + this.lookPitch * 6.5) * this.lookZoom;
      this.targetCamera.set(
        this.tractor.position.x + Math.cos(a) * 4 - Math.sin(a) * back,
        height,
        this.tractor.position.z - Math.sin(a) * 4 - Math.cos(a) * back,
      );
      this.targetLook.set(
        this.tractor.position.x + Math.sin(a) * 6,
        0.8,
        this.tractor.position.z + Math.cos(a) * 6,
      );
    }
    const blend = 1 - Math.exp(-dt * 3);
    this.camera.position.lerp(this.targetCamera, blend);
    this.cameraTarget.lerp(this.targetLook, blend);
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    if (this.shakeTime) {
      this.camera.position.x +=
        Math.sin(this.elapsed * 70) * this.shakeTime * 0.3;
      this.camera.position.y +=
        Math.cos(this.elapsed * 60) * this.shakeTime * 0.2;
    }
    if (this.depotLabel)
      this.depotLabel.visible =
        this.tractor.position.distanceTo(this.depotPosition) > 14;
    this.camera.lookAt(this.cameraTarget);
    this.renderer.render(this.scene, this.camera);
  }

  /** JSON-safe simulation and visual state for named browser saves. */
  exportState() {
    const transform = (o: THREE.Object3D) => ({
      position: o.position.toArray(), rotation: [o.rotation.x, o.rotation.y, o.rotation.z], scale: o.scale.toArray(),
    });
    return {
      version: 1 as const, elapsed: this.elapsed, rangeYards: this.rangeYards, bayCount: this.golfers.length,
      tractorPosition: this.tractor.position.toArray(), tractorAngle: this.tractorAngle, tractorSpeed: this.tractorSpeed,
      wheelRotations: this.tractorWheels.map(w => w.rotation.x),
      steeringRotations: this.tractorSteering.map(w => w.rotation.y),
      collectorRotation: this.collectorRoller?.rotation.x ?? 0,
      cameraMode: this.cameraMode, cameraPosition: this.camera.position.toArray(), cameraTarget: this.cameraTarget.toArray(),
      lookYaw: this.lookYaw, lookPitch: this.lookPitch, lookZoom: this.lookZoom,
      looking: this.looking, lookHoldUntil: this.lookHoldUntil,
      latchedCollisions: [...this.latchedCollisions],
      balls: this.balls.map(b => ({
        position: b.position.toArray(), active: b.active,
        pickableAt: b.pickableAt === Infinity ? null : b.pickableAt,
      })),
      airShots: this.airShots.map(a => ({
        shot: structuredClone(a.shot), time: a.time, point: { ...a.point }, lost: a.lost,
      })),
      bouncingBalls: this.bouncingBalls.map(b => ({ position: b.position.toArray(), velocity: b.velocity.toArray() })),
      golfers: this.golfers.map(g => ({
        position: g.object.position.toArray(), rotation: g.object.rotation.y, visible: g.object.visible,
        type: g.type, status: g.status,
        swingTime: g.swing.time, swingSpeed: g.swing.getEffectiveTimeScale(), swingPaused: g.swing.paused, swingEnabled: g.swing.enabled,
        walk: g.walk ? { ...g.walk, from: g.walk.from.toArray(), to: g.walk.to.toArray() } : null,
      })),
      golfCarts: this.golfCarts.map(c => ({
        golfer: c.object.userData.golferId as number, park: c.park.toArray(), phase: c.phase, start: c.start,
        position: c.object.position.toArray(), rotation: c.object.rotation.y, driverVisible: c.driver.visible,
        wheels: c.wheels.map(w => w.rotation.x),
        polo: ((c.driver.getObjectByName("DriverPolo") as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString(),
      })),
      animals: this.animals.map(a => ({
        id: a.id, position: a.object.position.toArray(), home: a.home.toArray(), target: a.target.toArray(),
        heading: a.heading, mode: a.mode, until: a.until, phase: a.phase, walkTime: a.walk.time, walkSpeed: a.walk.getEffectiveTimeScale(),
      })),
      hazards: this.hazards.map(h => ({
        id: h.id, z: h.z, cleared: h.cleared, obstacle: { ...h.obstacle }, objects: h.objects.map(transform),
      })),
      depots: this.depots.map(p => p.toArray()),
      helper: this.helper ? {
        position: this.helper.object.position.toArray(), angle: this.helper.angle, hopper: this.helper.hopper,
        index: this.helper.index, pauseUntil: this.helper.pauseUntil, roller: this.helper.roller?.rotation.x ?? 0,
      } : null,
    };
  }

  /** Validate completely, then rebuild scene-only objects around saved economy. */
  restoreState(value: unknown) {
    validateWorldState(value);
    const saved = value as ReturnType<RangeScene["exportState"]>;
    if (saved.animals.length !== this.animals.length ||
        saved.animals.some((a,i) => a.id !== this.animals[i].id) ||
        saved.hazards.length !== this.hazards.length ||
        saved.hazards.some(h => !this.hazards.some(current => current.id === h.id && current.objects.length === h.objects.length)))
      throw new Error("This save uses an incompatible scene layout.");
    if (saved.helper && saved.helper.index >= helperRoute(TEE.z + saved.rangeYards * YARD).length)
      throw new Error("This save contains an invalid helper route.");
    const cloneState = structuredClone(saved);
    this.elapsed = cloneState.elapsed;
    for (const cart of this.golfCarts) { this.scene.remove(cart.object); disposeGolfCart(cart); }
    this.golfCarts.length = 0;
    for (const npc of this.golfers) npc.cart = undefined;
    this.setBays(cloneState.bayCount);
    this.setRange(cloneState.rangeYards);
    this.tractor.position.fromArray(cloneState.tractorPosition);
    this.tractorAngle = cloneState.tractorAngle;
    this.tractorSpeed = cloneState.tractorSpeed;
    this.tractorTerrainSpeed = cartSpeedMultiplier(this.tractor.position, this.rangeEnd);
    this.tractor.rotation.y = this.tractorAngle;
    this.tractorWheels.forEach((w,i) => w.rotation.x = cloneState.wheelRotations[i] ?? 0);
    this.tractorSteering.forEach((w,i) => w.rotation.y = cloneState.steeringRotations[i] ?? 0);
    if (this.collectorRoller) this.collectorRoller.rotation.x = cloneState.collectorRotation;
    this.latchedCollisions.clear();
    for (const id of cloneState.latchedCollisions) this.latchedCollisions.add(id);
    this.cameraMode = cloneState.cameraMode;
    this.camera.position.fromArray(cloneState.cameraPosition);
    this.cameraTarget.fromArray(cloneState.cameraTarget);
    this.lookYaw = cloneState.lookYaw; this.lookPitch = cloneState.lookPitch; this.lookZoom = cloneState.lookZoom;
    this.looking = false; this.lookHoldUntil = cloneState.lookHoldUntil;
    this.shakeTime = 0;
    this.balls.length = 0;
    for (const b of cloneState.balls) this.balls.push({
      position: new THREE.Vector3().fromArray(b.position), active: b.active,
      pickableAt: b.pickableAt === null ? Infinity : b.pickableAt,
    });
    this.syncBalls();
    for (const flight of this.airShots) {
      this.scene.remove(flight.trail); flight.trail.geometry.dispose(); (flight.trail.material as THREE.Material).dispose();
    }
    this.airShots.length = 0;
    for (const a of cloneState.airShots) {
      const trail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(a.shot.points.filter((_,i) => i % 6 === 0).map(vector)),
        new THREE.LineBasicMaterial({ color: "#fff8d8", transparent: true, opacity: 0.42 }),
      );
      const index = Math.min(Math.floor(Math.max(0,a.time)*10), trail.geometry.getAttribute("position").count);
      trail.geometry.setDrawRange(Math.max(0,index-22), Math.min(index,22));
      this.scene.add(trail);
      this.airShots.push({ ...a, trail });
    }
    this.bouncingBalls.length = 0;
    for (const b of cloneState.bouncingBalls) this.bouncingBalls.push({
      position: new THREE.Vector3().fromArray(b.position), velocity: new THREE.Vector3().fromArray(b.velocity),
    });
    const airborne = [...this.airShots.filter(a => a.time >= 0).map(a => vector(a.point)), ...this.bouncingBalls.map(b => b.position)];
    this.flyingBalls.count = airborne.length;
    airborne.forEach((position,i) => {
      this.ballDummy.position.copy(position); this.ballDummy.scale.setScalar(1.7); this.ballDummy.updateMatrix();
      this.flyingBalls.setMatrixAt(i,this.ballDummy.matrix);
    });
    this.flyingBalls.instanceMatrix.needsUpdate = true;
    cloneState.golfers.forEach((g,i) => {
      const npc = this.golfers[i];
      npc.type = g.type; npc.status = g.status; npc.moodKey = "";
      npc.polo?.color.set(GOLFER_TYPES[g.type].color);
      npc.object.position.fromArray(g.position); npc.object.rotation.y = g.rotation; npc.object.visible = g.visible;
      npc.mood.visible = g.visible;
      npc.walk = g.walk ? { ...g.walk, from: new THREE.Vector3().fromArray(g.walk.from), to: new THREE.Vector3().fromArray(g.walk.to) } : undefined;
      npc.swing.reset().setEffectiveTimeScale(g.swingSpeed).play();
      npc.swing.time = g.swingTime; npc.swing.paused = g.swingPaused; npc.swing.enabled = g.swingEnabled;
      npc.mixer.update(0);
    });
    for (const c of cloneState.golfCarts) {
      const npc = this.golfers[c.golfer];
      const cart = this.createVisitorCart(npc,c.golfer,c.phase === "arriving");
      cart.park.fromArray(c.park);
      if(c.phase === "departing") this.departGolfCart(cart);
      cart.start = c.start; cart.phase = c.phase;
      cart.object.position.fromArray(c.position); cart.object.rotation.y = c.rotation; cart.driver.visible = c.driverVisible;
      cart.wheels.forEach((w,i) => w.rotation.x = c.wheels[i]);
      const polo = cart.driver.getObjectByName("DriverPolo") as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
      polo.material.color.set("#"+c.polo);
      if(c.phase !== "departing") npc.cart = cart;
    }
    cloneState.animals.forEach((a,i) => {
      const animal = this.animals[i];
      animal.object.position.fromArray(a.position); animal.home.fromArray(a.home); animal.target.fromArray(a.target);
      animal.heading = a.heading; animal.object.rotation.y = a.heading;
      animal.mode = a.mode; animal.until = a.until; animal.phase = a.phase;
      animal.walk.time = a.walkTime; animal.walk.setEffectiveTimeScale(a.walkSpeed); animal.mixer.update(0);
    });
    for (const h of cloneState.hazards) {
      const hazard = this.hazards.find(current => current.id === h.id)!;
      hazard.z = h.z; hazard.cleared = h.cleared; hazard.obstacle = h.obstacle;
      h.objects.forEach((transform,i) => {
        const o = hazard.objects[i]; o.position.fromArray(transform.position);
        o.rotation.set(transform.rotation[0],transform.rotation[1],transform.rotation[2]); o.scale.fromArray(transform.scale);
        if(h.cleared) this.scene.remove(o); else this.scene.add(o);
      });
      const index = this.obstacles.findIndex(o => o.id === hazard.id);
      if(index >= 0) this.obstacles.splice(index,1);
    }
    this.syncHazards();
    if(cloneState.depots.length === 1) {
      if(this.secondDepot){
        this.scene.remove(this.secondDepot.object,this.secondDepot.label);
        this.secondDepot.label.material.map?.dispose();
        this.secondDepot.label.material.dispose(); this.secondDepot = undefined;
      }
      this.depots.splice(1);
      const index=this.obstacles.findIndex(o=>o.id==="depot-2"); if(index>=0)this.obstacles.splice(index,1);
    } else {
      this.addSecondDepot();
      const p = this.depots[1].fromArray(cloneState.depots[1]);
      this.secondDepot!.object.position.copy(p); this.secondDepot!.label.position.set(p.x,5.7,p.z);
      const depot=this.obstacles.find(o=>o.id==="depot-2");
      if(depot?.kind==="box"){depot.minX=p.x-2.25;depot.maxX=p.x+2.25;depot.minZ=p.z-2.8;depot.maxZ=p.z-.35;}
    }
    if(cloneState.helper) {
      this.enableHelper(); const h=this.helper!, savedHelper=cloneState.helper;
      h.object.position.fromArray(savedHelper.position); h.angle=savedHelper.angle; h.object.rotation.y=h.angle;
      h.hopper=savedHelper.hopper;h.index=Math.min(savedHelper.index,this.helperRoute.length-1);h.pauseUntil=savedHelper.pauseUntil;
      if(h.roller)h.roller.rotation.x=savedHelper.roller;
    } else if(this.helper){this.scene.remove(this.helper.object);this.helper=undefined;}
    this.camera.lookAt(this.cameraTarget);
    this.environment.update(this.elapsed);
    this.renderer.render(this.scene,this.camera);
  }

  resize() {
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.camera.fov = width < 650 ? 64 : 54;
    this.camera.updateProjectionMatrix();
  }

  setQuality(quality: "high" | "low") {
    this.quality = quality;
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, quality === "high" ? 1.6 : 1),
    );
    this.renderer.shadowMap.enabled = quality === "high";
    this.environment.setQuality(quality === "high");
    this.resize();
  }

  setWind(speed: number) {
    this.environment.setWind(speed);
  }
}
