import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(base, 'manifest.json'), 'utf8'));
const reports = [];
let failed = false;
const contracts = {
  'tractor-picker': ['Front_L_Steer', 'Front_R_Steer', 'Rear_L_Steer', 'Rear_R_Steer', 'Front_L_Wheel', 'Front_R_Wheel', 'Rear_L_Wheel', 'Rear_R_Wheel', 'CollectorRoller', 'HopperFillAnchor', 'CollectionZone'],
  'target-flag': ['Flag'],
  'range-ground': ['Ground', 'MowingStrip'],
  'ball-depot': ['UnloadZone', 'BallReturnAnchor'],
  'hitting-bay': ['BallLaunchAnchor'],
  golfer: ['Torso', 'LeftUpperArm', 'RightUpperArm', 'LeftHip', 'RightHip', 'LeftKnee', 'RightKnee', 'ClubRig', 'ClubHead'],
  'golf-cart': ['FrontLeftWheel', 'FrontRightWheel', 'RearLeftWheel', 'RearRightWheel', 'DriverPolo'],
};
for (const asset of manifest.assets) {
  const bytes = await fs.readFile(path.join(base, asset.file));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const report = await validator.validateBytes(new Uint8Array(bytes), { uri: asset.file, maxIssues: 100 });
  const ownRoot = (gltf.nodes ?? []).filter(n => n.extras?.asset === asset.id);
  const foreignRoots = (gltf.nodes ?? []).filter(n => n.extras?.asset && n.extras.asset !== asset.id);
  const animations = (gltf.animations ?? []).map(a => ({ name: a.name, channels: a.channels.length }));
  const checks = {
    singleScene: gltf.scenes?.length === 1,
    singleAssetRoot: ownRoot.length === 1 && foreignRoots.length === 0,
    embeddedBuffers: gltf.buffers?.every(b => !b.uri),
    noCamerasOrLights: !gltf.cameras?.length && !gltf.extensions?.KHR_lights_punctual,
    animationMatchesManifest: asset.animated ? animations.length === 1 && animations[0].channels > 0 : animations.length === 0,
    meshCountMatches: (gltf.nodes ?? []).filter(n => n.mesh !== undefined).length === asset.mesh_count,
    runtimeNodesPresent: (contracts[asset.id] ?? []).every(name => gltf.nodes?.some(node => node.name === name)),
    embeddedImages: (gltf.images ?? []).every(image => image.bufferView !== undefined && !image.uri),
    foliageUsesMask: !asset.id.startsWith('tree-') || gltf.materials?.some(material => material.alphaMode === 'MASK' && material.doubleSided === true),
    singleBallMesh: asset.id !== 'golf-ball' || gltf.meshes?.length === 1,
    fullSwingTiming: asset.id !== 'golfer' || gltf.animations?.[0]?.samplers.every(sampler => {
      const input = gltf.accessors[sampler.input];
      return Math.abs(input.min?.[0] ?? Infinity) < 0.00001 && Math.abs((input.max?.[0] ?? Infinity) - 3) < 0.00001;
    }),
  };
  const errors = report.issues.numErrors;
  const warnings = report.issues.numWarnings;
  if (errors || warnings || Object.values(checks).some(v => !v)) failed = true;
  asset.bytes = bytes.length;
  asset.animation = animations[0]?.name ?? null;
  asset.triangles_exported = (gltf.meshes ?? []).reduce((sum, mesh) => sum + mesh.primitives.reduce((s, p) => s + (p.indices === undefined ? gltf.accessors[p.attributes.POSITION].count : gltf.accessors[p.indices].count) / 3, 0), 0);
  reports.push({ id: asset.id, bytes: bytes.length, triangles: asset.triangles_exported, materials: gltf.materials?.length ?? 0, embeddedImages: gltf.images?.length ?? 0, checks, animations, errors, warnings, issues: report.issues.messages });
  console.log(`${asset.id}: ${Math.ceil(bytes.length / 1024)} KB, ${asset.triangles_exported} tris, ${errors} errors, ${warnings} warnings, ${animations.length} clips`);
}
await fs.writeFile(path.join(base, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await fs.writeFile(path.join(base, 'validation.json'), JSON.stringify({ passed: !failed, validator: 'Khronos glTF Validator', totalBytes: reports.reduce((s, r) => s + r.bytes, 0), assets: reports }, null, 2) + '\n');
if (failed) process.exitCode = 1;
