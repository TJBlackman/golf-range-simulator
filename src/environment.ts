import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import panoramaUrl from "../assets/textures/alpine-panorama.png?url";

const surfaceUrls = import.meta.glob("../assets/textures/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Shared, exported material maps. World-space UVs keep grass density constant
 * when the management game extends its range from 100 to 300 yards. */
export class RangeEnvironment {
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly pending: Promise<void>[] = [];
  private readonly grassTime = { value: 0 };
  private readonly windStrength = { value: 1 };
  private grass?: THREE.InstancedMesh;

  constructor(
    readonly scene: THREE.Scene,
    readonly renderer: THREE.WebGLRenderer,
  ) {}

  private texture(name: string, srgb = false) {
    const key = `${name}:${srgb}`;
    const existing = this.textures.get(key);
    if (existing) return existing;
    const url = surfaceUrls[`../assets/textures/${name}.webp`];
    if (!url) return undefined;
    let loaded!: () => void, failed!: (reason: unknown) => void;
    this.pending.push(new Promise<void>((resolve, reject) => { loaded = resolve; failed = reject; }));
    const texture = new THREE.TextureLoader().load(url, loaded, undefined, failed);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(key, texture);
    return texture;
  }

  surface(kind: "grass" | "gravel" | "rock" | "bark" | "sand", color: string, metres = 3) {
    const map = this.texture(`${kind}-albedo`, true);
    const bumpMap = this.texture(`${kind}-bump`);
    const material = new THREE.MeshStandardMaterial({
      color,
      map,
      bumpMap,
      bumpScale: kind === "grass" ? 0.025 : kind === "bark" ? 0.075 : 0.045,
      roughness: kind === "rock" ? 0.92 : 0.98,
    });
    if (kind === "bark" || kind === "rock") {
      map?.repeat.set(1.5, 2);
      bumpMap?.repeat.set(1.5, 2);
      return material;
    }
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec3 surfaceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #ifdef USE_MAP
          vMapUv = surfaceWorld.xz / ${metres.toFixed(2)};
        #endif
        #ifdef USE_BUMPMAP
          vBumpMapUv = surfaceWorld.xz / ${metres.toFixed(2)};
        #endif`,
      );
    };
    material.customProgramCacheKey = () => `surface-${kind}-${metres}`;
    return material;
  }

  buildLandscape() {
    // A photographic cyclorama replaces polygonal hills and cloud spheres.
    let photoLoaded!: () => void, photoFailed!: (reason: unknown) => void;
    this.pending.push(new Promise<void>((resolve, reject) => { photoLoaded = resolve; photoFailed = reject; }));
    const photograph = new THREE.TextureLoader().load(panoramaUrl, photoLoaded, undefined, photoFailed);
    photograph.colorSpace = THREE.SRGBColorSpace;
    photograph.wrapS = THREE.MirroredRepeatWrapping;
    photograph.repeat.x = 2;
    const backdrop = new THREE.Mesh(
      new THREE.CylinderGeometry(660, 660, 350, 128, 1, true),
      new THREE.ShaderMaterial({
        uniforms: { photograph: { value: photograph } },
        vertexShader: `varying vec2 panoramaUv;
          void main() {
            panoramaUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `uniform sampler2D photograph; varying vec2 panoramaUv;
          void main() {
            vec3 color = texture2D(photograph, vec2(panoramaUv.x * 2.0, panoramaUv.y)).rgb;
            float edge = 1.0 - smoothstep(0.84, 1.0, panoramaUv.y);
            gl_FragColor = vec4(color, edge);
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        toneMapped: false,
      }),
    );
    backdrop.position.set(0, 95, 135);
    backdrop.rotation.y = 0.62;
    this.scene.add(backdrop);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color("#618db7") },
          horizon: { value: new THREE.Color("#79a0c0") },
        },
        vertexShader: "varying vec3 direction; void main() { direction = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 direction;
          void main() {
            float h = normalize(direction).y;
            gl_FragColor = vec4(mix(horizon, top, smoothstep(0.0, 0.8, h)), 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.scene.add(sky);

    // The same surrounding landscape lights metal, glass and painted equipment.
    let environmentLoaded!: () => void, environmentFailed!: (reason: unknown) => void;
    this.pending.push(new Promise<void>((resolve, reject) => { environmentLoaded = resolve; environmentFailed = reject; }));
    const environment = new THREE.TextureLoader().load(panoramaUrl, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const reflection = pmrem.fromEquirectangular(texture);
      this.scene.environment = reflection.texture;
      this.scene.environmentIntensity = 0.45;
      texture.dispose();
      pmrem.dispose();
      environmentLoaded();
    }, undefined, environmentFailed);
    environment.colorSpace = THREE.SRGBColorSpace;

    const ground = new THREE.Mesh(new THREE.CircleGeometry(850, 96), this.surface("grass", "#7b865c", 4));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.11;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.buildRough();
  }

  private buildRough() {
    // Real blades along the verge; the playable fairway stays flat for physics.
    const blade = new THREE.PlaneGeometry(0.11, 0.62, 1, 3);
    blade.translate(0, 0.31, 0);
    const material = new THREE.MeshStandardMaterial({ color: "#69764b", roughness: 1, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.grassTime = this.grassTime;
      shader.uniforms.windStrength = this.windStrength;
      shader.vertexShader = "uniform float grassTime; uniform float windStrength;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        float bladePhase = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.3;
        transformed.x += sin(grassTime * 1.4 + bladePhase) * position.y * position.y * 0.17 * windStrength;`);
    };
    material.customProgramCacheKey = () => "wind-verge";
    const count = 12000;
    this.grass = new THREE.InstancedMesh(blade, material, count);
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    let seed = 719;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      dummy.position.set(side * (56.5 + random() * 5), -0.06, 7 + random() * 295);
      dummy.rotation.y = random() * Math.PI;
      dummy.scale.setScalar(0.45 + random() * 0.9);
      dummy.updateMatrix();
      this.grass.setMatrixAt(i, dummy.matrix);
      tint.setHSL(0.19 + random() * 0.05, 0.19 + random() * 0.14, 0.36 + random() * 0.22);
      this.grass.setColorAt(i, tint);
    }
    this.grass.receiveShadow = true;
    this.grass.computeBoundingSphere();
    this.scene.add(this.grass);
  }

  flagMaterial(color: string) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.flagTime = this.grassTime;
      shader.uniforms.windStrength = this.windStrength;
      shader.vertexShader = "uniform float flagTime; uniform float windStrength;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        float weight = clamp(abs(position.x) / 0.8, 0.0, 1.0);
        transformed.z += sin(position.x * 10.0 - flagTime * 3.0 + position.y * 5.0) * weight * 0.05 * windStrength;`);
    };
    material.customProgramCacheKey = () => "wind-flag";
    return material;
  }

  foliage(material: THREE.MeshStandardMaterial) {
    material.side = THREE.DoubleSide;
    // Needle masks need a lower threshold to retain coverage in mipmaps.
    material.alphaTest = /pine/.test(material.name) ? 0.16 : 0.35;
    material.alphaToCoverage = true;
    material.transparent = false;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.forestTime = this.grassTime;
      shader.uniforms.windStrength = this.windStrength;
      shader.vertexShader = "uniform float forestTime; uniform float windStrength;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        float treePhase = 0.0;
        #ifdef USE_INSTANCING
          treePhase = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
        #endif
        float heightWeight = max(position.y - 0.5, 0.0);
        transformed.x += sin(forestTime * 0.8 + treePhase + position.y) * heightWeight * 0.016 * windStrength;
        transformed.z += sin(forestTime * 1.1 + treePhase + position.x * 4.0) * heightWeight * 0.01 * windStrength;`);
      // A small amount of diffuse transmission keeps thin sunlit leaves from
      // becoming solid black when their surface normal faces away from the sun.
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.05, 0.065, 0.035);`);
    };
    material.customProgramCacheKey = () => "forest-wind-transmission";
  }

  roundedBox(width: number, height: number, depth: number, radius = 0.1) {
    return new RoundedBoxGeometry(width, height, depth, 3, radius);
  }

  netMaterial() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.strokeStyle = "#343d35";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 128; i += 32) {
      ctx.moveTo(i, 0); ctx.lineTo(i, 128);
      ctx.moveTo(0, i); ctx.lineTo(128, i);
    }
    ctx.stroke();
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    // One square metre tile; each of the four cells is a 25cm net opening.
    const material = new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.28, side: THREE.DoubleSide, roughness: 1 });
    return material;
  }

  update(time: number) {
    this.grassTime.value = time;
  }

  async ready() {
    await Promise.all(this.pending);
  }

  setWind(speed: number) {
    this.windStrength.value = Math.min(1, Math.max(0, speed / 1.8));
  }

  setQuality(high: boolean) {
    if (this.grass) this.grass.visible = high;
  }
}
