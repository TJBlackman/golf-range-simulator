import { readFile, writeFile } from "node:fs/promises";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { Box3, Vector3 } from "three";
import { createGolfCart } from "../code/golf-cart.ts";

// GLTFExporter needs only Blob conversion here; the model has no canvas textures.
globalThis.FileReader ??= class FileReader {
  result = null;
  onloadend = null;
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString("base64")}`;
      this.onloadend?.();
    });
  }
};

const { object } = createGolfCart("#54685b", "#8b4e40");
const result = await new GLTFExporter().parseAsync(object, { binary: true });
await writeFile(new URL("../models/golf-cart.glb", import.meta.url), Buffer.from(result));
let meshCount = 0;
let triangles = 0;
const materialSet = new Set();
object.traverse((part) => {
  if (!part.isMesh) return;
  meshCount++;
  triangles += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3;
  for (const material of Array.isArray(part.material) ? part.material : [part.material]) materialSet.add(material);
});
const bounds = new Box3().setFromObject(object);
const dimensions = bounds.getSize(new Vector3());
const manifestPath = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entry = {
  id: "golf-cart", file: "models/golf-cart.glb", source: "code/golf-cart.ts",
  description: "Two-seat resort golf cart with rounded bodywork, roof, windscreen, seats, wheel pivots, golf bags and seated driver.",
  authored_coordinates: "Y up, +Z forward, metres", mesh_count: meshCount,
  material_count: materialSet.size, triangles_source: triangles, triangles_exported: triangles,
  bounds_glb: [...bounds.min.toArray(), ...bounds.max.toArray()], animated: false, animation: null, bytes: result.byteLength,
};
const index = manifest.assets.findIndex(asset => asset.id === entry.id);
if (index < 0) manifest.assets.push(entry); else manifest.assets[index] = entry;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ asset: "golf-cart.glb", bytes: result.byteLength, meshCount, triangles, dimensions: dimensions.toArray() }, null, 2));
