import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(base, 'manifest.json'), 'utf8'));
const reports = [];
let failed = false;
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
  };
  const errors = report.issues.numErrors;
  const warnings = report.issues.numWarnings;
  if (errors || warnings || Object.values(checks).some(v => !v)) failed = true;
  asset.bytes = bytes.length;
  asset.animation = animations[0]?.name ?? null;
  asset.triangles_exported = (gltf.meshes ?? []).reduce((sum, mesh) => sum + mesh.primitives.reduce((s, p) => s + (p.indices === undefined ? gltf.accessors[p.attributes.POSITION].count : gltf.accessors[p.indices].count) / 3, 0), 0);
  reports.push({ id: asset.id, bytes: bytes.length, triangles: asset.triangles_exported, checks, animations, errors, warnings, issues: report.issues.messages });
  console.log(`${asset.id}: ${Math.ceil(bytes.length / 1024)} KB, ${asset.triangles_exported} tris, ${errors} errors, ${warnings} warnings, ${animations.length} clips`);
}
await fs.writeFile(path.join(base, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await fs.writeFile(path.join(base, 'validation.json'), JSON.stringify({ passed: !failed, validator: 'Khronos glTF Validator', totalBytes: reports.reduce((s, r) => s + r.bytes, 0), assets: reports }, null, 2) + '\n');
if (failed) process.exitCode = 1;
