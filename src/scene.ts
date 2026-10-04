import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
import { GOLFER_TYPES } from "./management";
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
const CAR_COLORS = ["#c9d3d8", "#5a6e8c", "#8c2f2a", "#e8e2d0", "#2f3a4f"];
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
  mixer: THREE.AnimationMixer;
  swing: THREE.AnimationAction;
  origin: Point;
  mood: THREE.Sprite;
  moodKey: string;
  type: GolferType;
  status: GolferStatus;
  polo?: THREE.MeshStandardMaterial;
  walk?: Walk;
};
type Car = { object: THREE.Group; start: number };
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

const BALL_VISUAL_SCALE = 1.5;

const modelUrls = import.meta.glob("../assets/models/*.glb", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const material = (color: string) =>
  new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
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
  readonly cars: Car[] = [];
  /** Current range length. Starts short and grows through the shop. */
  rangeYards = 100;
  rangeEnd = TEE.z + 100 * YARD;
  private helperRoute = helperRoute(this.rangeEnd);
  private ground!: THREE.Group;
  private fenceMeshes: THREE.Object3D[] = [];
  private targetGroups: THREE.Group[] = [];
  private hazards: Hazard[] = [];
  cart: CartSetup = {
    maxSpeed: 9,
    halfWidth: 1.6,
    capacity: 100,
    collector: 0,
    cage: 0,
    bumper: 0,
    hopper: 0,
  };
  helper?: Helper;
  private tractorModel!: THREE.Group;
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
    this.renderer.toneMappingExposure = 1;
    this.scene.background = new THREE.Color("#d9e8df");
    this.scene.fog = new THREE.Fog("#d9e8df", 220, 700);
    this.scene.add(new THREE.HemisphereLight("#fff6de", "#647354", 2));
    this.sun = new THREE.DirectionalLight("#fff0cf", 2.5);
    this.sun.position.set(-55, 85, -25);
    this.sun.target.position.set(0, 0, 65);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -90,
      right: 90,
      top: 215,
      bottom: -90,
      near: 0.5,
      far: 350,
    });
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.camera.position.set(-38, 8.8, 8);
    this.camera.lookAt(this.cameraTarget);
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
                mat.roughness = 0.9;
                mat.metalness = 0;
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
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1000, 64),
      material("#889d69"),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.3;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1100, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          topColor: { value: new THREE.Color("#8ab6c1") },
          bottomColor: { value: new THREE.Color("#f4efdb") },
        },
        vertexShader:
          "varying vec3 vPosition; void main(){ vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader:
          "uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vPosition; void main(){ float h=normalize(vPosition).y; gl_FragColor=vec4(mix(bottomColor,topColor,smoothstep(-0.02,0.7,h)),1.0); }",
      }),
    );
    this.scene.add(sky);
    const hillColors = ["#90a989", "#a2b29a", "#aabead"];
    for (let i = 0; i < 23; i++) {
      const hill = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        material(hillColors[i % 3]),
      );
      hill.position.set(-570 + i * 55, -6, 430 + Math.sin(i * 2.4) * 60);
      hill.scale.set(70 + (i % 4) * 18, 30 + (i % 5) * 10, 75);
      this.scene.add(hill);
    }
    const cloudMat = new THREE.MeshBasicMaterial({
      color: "#fff9ea",
      transparent: true,
      opacity: 0.6,
      fog: false,
    });
    for (let i = 0; i < 9; i++) {
      const cloud = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const puff = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1, 2),
          cloudMat,
        );
        puff.scale.set(13, 4 + (j % 2) * 2, 6);
        puff.position.set(j * 11, (j % 2) * 2, 0);
        cloud.add(puff);
      }
      cloud.position.set(-320 + i * 88, 85 + (i % 3) * 19, 310 + (i % 2) * 140);
      this.scene.add(cloud);
    }
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
        object.material = material(
          object.name.startsWith("MowingStrip") &&
            parseInt(object.name.split(".")[1] || "0") % 2 === 0
            ? "#7fa56c"
            : "#6d945d",
        );
        object.castShadow = false;
      }
    });
    for (const target of TARGETS) {
      const group = new THREE.Group();
      const disk = new THREE.Mesh(
        new THREE.CylinderGeometry(12 * YARD, 12 * YARD, 0.028, 64),
        material("#6b915f"),
      );
      disk.position.set(target.x, 0.032, target.z);
      disk.receiveShadow = true;
      group.add(disk);
      for (const [radius, color] of [
        [5, "#91aa75"],
        [2, "#b3c491"],
      ] as const) {
        const inner = new THREE.Mesh(
          new THREE.CircleGeometry(radius * YARD, 48),
          material(color),
        );
        inner.rotation.x = -Math.PI / 2;
        inner.position.set(target.x, 0.053 + (5 - radius) * 0.001, target.z);
        inner.receiveShadow = true;
        group.add(inner);
      }
      for (const radius of [2, 5, 12]) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(
            radius * YARD - 0.045,
            radius * YARD + 0.045,
            64,
          ),
          new THREE.MeshBasicMaterial({
            color: "#e9ead3",
            transparent: true,
            opacity: 0.52,
            side: THREE.DoubleSide,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(target.x, 0.065, target.z);
        group.add(ring);
      }
      const flag = this.asset("target-flag", target.x, target.z, 1.7);
      this.scene.remove(flag);
      flag.rotation.y = -0.4;
      const flagMesh = flag.getObjectByName("Flag");
      if (flagMesh instanceof THREE.Mesh)
        flagMesh.material = material(target.color);
      group.add(flag);
      group.visible = target.z < this.rangeEnd - 18;
      this.scene.add(group);
      this.targetGroups.push(group);
    }
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(116, 12),
      material("#d3c9b0"),
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
    for (let i = 0; i < 7; i++) this.addBay(i, true);
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

  private addBay(index: number, occupied: boolean) {
    const x = BAY_X[index];
    const bay = this.asset("hitting-bay", x, 4);
    const originNode = bay.getObjectByName("BallLaunchAnchor");
    bay.updateMatrixWorld(true);
    const origin = originNode
      ? originNode.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(x + TEE.x, TEE.y, TEE.z);
    origin.y = TEE.y;
    // The golfer model faces +Z and swings across its own X axis, with the
    // follow-through ending on its -X side. Turn it a quarter turn so the
    // follow-through points down the range (+Z), then stand it where the
    // club head at address rests on the tee.
    const object = this.asset("golfer", origin.x - 0.82, origin.z + 0.04, 1.15);
    object.position.y = 0.18;
    object.rotation.y = Math.PI / 2;
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
    object.visible = occupied;
    mood.visible = occupied;
    this.golfers.push({
      object,
      mixer,
      swing,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      mood,
      moodKey: "",
      type: "casual",
      status: occupied ? "playing" : "empty",
      polo,
    });
  }

  /** Open bays up to `count`. New bays start empty until the sim fills them. */
  setBays(count: number) {
    while (this.golfers.length < Math.min(count, BAY_X.length))
      this.addBay(this.golfers.length, false);
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
        new THREE.CylinderGeometry(0.5, 0.58, 6, 10),
        material("#876343"),
      );
      log.rotation.z = Math.PI / 2;
      log.position.set(logX, 0.55, logZ);
      log.castShadow = true;
      log.receiveShadow = true;
      this.scene.add(log);
      const end = new THREE.Mesh(
        new THREE.CircleGeometry(0.48, 10),
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
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        material(i % 2 ? "#939886" : "#a7a99a"),
      );
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
    for (let i = 0; i < 55; i++) {
      const scale = 2.8 + random(i + 300) * 2;
      pine.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(
            -85 + i * 3.2,
            0,
            RANGE_END + 12 + random(i + 400) * 25,
          ),
          new THREE.Quaternion(),
          new THREE.Vector3(scale, scale, scale),
        ),
      );
    }
    this.instanceAsset("tree-pine", pine);
    this.instanceAsset("tree-broadleaf", broad);
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
    const source = this.assets.get("golf-ball")!.scene;
    source.updateMatrixWorld(true);
    source.traverse((o) => {
      if (o instanceof THREE.Mesh)
        geometry = o.geometry
          .clone()
          .applyMatrix4(o.matrixWorld)
          .scale(
            3 * BALL_VISUAL_SCALE,
            3 * BALL_VISUAL_SCALE,
            3 * BALL_VISUAL_SCALE,
          );
    });
    const ballMaterial = new THREE.MeshStandardMaterial({
      color: "#fffdf3",
      roughness: 0.5,
    });
    this.fieldBalls = new THREE.InstancedMesh(geometry, ballMaterial, 1500);
    this.fieldBalls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fieldBalls.frustumCulled = false;
    this.scene.add(this.fieldBalls);
    this.hopperBalls = new THREE.InstancedMesh(geometry, ballMaterial, 220);
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
    ctx.fillStyle = "#203d30";
    ctx.beginPath();
    ctx.roundRect(4, 4, canvas.width - 8, 110, 28);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
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
    if (kind === "mood") sprite.scale.set(2.55, 0.85, 1);
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
    const shape: Shape =
      Math.random() < 0.34 ? "draw" : Math.random() < 0.5 ? "fade" : "straight";
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
    npc.swing.reset().setEffectiveTimeScale(1.8).play();
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
    // Hold the ball on the tee until the swing reaches impact (about half the
    // clip at 1.8x speed, measured in flight time that runs at 1.7x).
    this.airShots.push({
      shot,
      time: -0.9,
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
      flight.time += dt * 1.7;
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
      }
      if (state.status !== npc.status) this.transitionGolfer(npc, state);
      if (state.status === "empty") continue;
      const key =
        state.status === "leaving"
          ? "leaving"
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
        key === "waiting"
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

  private transitionGolfer(npc: NPC, state: GolferState) {
    const stance = new THREE.Vector3(
      npc.origin.x - 0.82,
      0.18,
      npc.origin.z + 0.04,
    );
    const outside = new THREE.Vector3(npc.origin.x - 0.82, 0.18, -7);
    npc.status = state.status;
    if (state.status === "playing") {
      npc.object.visible = true;
      npc.mood.visible = true;
      npc.object.position.copy(outside);
      npc.swing.reset().play();
      npc.swing.paused = true;
      npc.walk = {
        from: outside.clone(),
        to: stance,
        start: this.elapsed,
        duration: outside.distanceTo(stance) / 3,
        hide: false,
      };
    } else if (state.status === "leaving") {
      const from = npc.object.position.clone();
      npc.walk = {
        from,
        to: outside,
        start: this.elapsed,
        duration: from.distanceTo(outside) / 3,
        hide: true,
      };
      this.spawnCar(npc.origin.x);
    } else {
      npc.object.visible = false;
      npc.mood.visible = false;
      npc.walk = undefined;
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
      if (t < 1) continue;
      npc.walk = undefined;
      if (walk.hide) {
        npc.object.visible = false;
        npc.mood.visible = false;
      } else npc.object.rotation.y = Math.PI / 2;
    }
  }

  /** A boxy car waits behind the bays, then pulls away with the golfer. */
  private spawnCar(x: number) {
    const car = new THREE.Group();
    const paint = material(CAR_COLORS[this.cars.length % CAR_COLORS.length]);
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.9, 1.7), paint);
    body.position.y = 0.78;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2, 0.72, 1.5), paint);
    cabin.position.set(-0.25, 1.58, 0);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(2.04, 0.4, 1.54),
      material("#5b6f6a"),
    );
    glass.position.set(-0.25, 1.6, 0);
    car.add(body, cabin, glass);
    const tyre = material("#2a2a2a");
    for (const [wx, wz] of [
      [-1.25, 0.85],
      [1.25, 0.85],
      [-1.25, -0.85],
      [1.25, -0.85],
    ]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 0.3, 10),
        tyre,
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.34, wz);
      car.add(wheel);
    }
    car.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    car.position.set(x + 0.4, 0, -9.5);
    this.scene.add(car);
    this.cars.push({ object: car, start: this.elapsed });
  }

  private updateCars(dt: number) {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      if (this.elapsed - car.start < 3.6) continue;
      car.object.position.x += 9 * dt;
      if (car.object.position.x > 80) {
        this.scene.remove(car.object);
        this.cars.splice(i, 1);
      }
    }
  }

  /** Swap cart parts to match the purchased upgrade levels. */
  applyCart(setup: CartSetup) {
    this.cart = setup;
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
        const frame = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(1.7, 0.75, 1.05)),
          new THREE.LineBasicMaterial({ color: "#1f2a22" }),
        );
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
            new THREE.MeshBasicMaterial({
              color: "#1f2a22",
              transparent: true,
              opacity: 0.22,
              side: THREE.DoubleSide,
            }),
          );
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
          new THREE.BoxGeometry(big ? 2.1 : 1.9, big ? 0.36 : 0.26, 0.3),
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
        const height = setup.hopper === 1 ? 0.3 : 0.6;
        const wood = material("#d9c48a");
        for (const [w, d, px, pz] of [
          [0.06, 1.0, -0.78, -1.28],
          [0.06, 1.0, 0.78, -1.28],
          [1.62, 0.06, 0, -0.78],
          [1.62, 0.06, 0, -1.78],
        ]) {
          const board = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), wood);
          board.position.set(px, 1.25 + height / 2, pz);
          board.castShadow = true;
          boards.add(board);
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
    const mesh = new THREE.MeshBasicMaterial({
      color: "#24322a",
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
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
      const back = new THREE.Mesh(new THREE.PlaneGeometry(112, height), mesh);
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
    for (const hazard of this.hazards)
      if (ids.includes(hazard.id) && !hazard.cleared) {
        hazard.cleared = true;
        for (const object of hazard.objects) this.scene.remove(object);
      }
    this.syncHazards();
  }

  addSecondDepot() {
    if (this.depots.length > 1) return;
    const position = new THREE.Vector3(27, 0, Math.min(150, this.rangeEnd - 25));
    this.asset("ball-depot", position.x, position.z, 1.5);
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
    const speed = 7 * Math.max(0.3, 1 - Math.abs(delta) / Math.PI);
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
    this.hopperBalls.count = Math.min(count, 220);
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
    this.tractorSpeed +=
      (desired - this.tractorSpeed) *
      Math.min(1, dt * (brake ? 9 : 2.2 * (this.cart.maxSpeed / 9)));
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
    for (const golfer of this.golfers) golfer.mixer.update(dt);
    for (const animal of this.animals) this.wander(animal, dt);
    this.updateWalks();
    this.updateCars(dt);
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
        height = (8.8 + this.lookPitch * 9) * this.lookZoom;
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

  resize() {
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.camera.fov = width < 650 ? 64 : 48;
    this.camera.updateProjectionMatrix();
  }

  setQuality(quality: "high" | "low") {
    this.quality = quality;
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, quality === "high" ? 1.6 : 1),
    );
    this.renderer.shadowMap.enabled = quality === "high";
    this.resize();
  }
}
