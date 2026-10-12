import * as THREE from "three";

/** Large enough to keep draw calls modest, small enough to cull distant verges. */
export const INSTANCE_CELL_SIZE = 48;

/** Keep world-space matrices intact: foliage wind derives its phase from them. */
export function partitionInstances(placements: readonly THREE.Matrix4[]) {
  const cells = new Map<string, number[]>();
  placements.forEach((matrix, index) => {
    const x = Math.floor(matrix.elements[12] / INSTANCE_CELL_SIZE);
    const z = Math.floor(matrix.elements[14] / INSTANCE_CELL_SIZE);
    const key = `${x}:${z}`;
    const cell = cells.get(key);
    if (cell) cell.push(index);
    else cells.set(key, [index]);
  });
  return [...cells.values()];
}

/** All chunks share geometry/material; only their instance buffers and bounds differ. */
export function createSpatialInstances(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: readonly THREE.Matrix4[],
  options: {
    colors?: readonly THREE.Color[];
    /** Maximum vertex displacement in geometry space at the strongest wind. */
    localBoundsPadding?: number;
    castShadow?: boolean;
    receiveShadow?: boolean;
  } = {},
) {
  return partitionInstances(placements).map((indices) => {
    const mesh = new THREE.InstancedMesh(geometry, material, indices.length);
    let maximumScale = 0;
    indices.forEach((sourceIndex, index) => {
      const matrix = placements[sourceIndex];
      mesh.setMatrixAt(index, matrix);
      if (options.colors) mesh.setColorAt(index, options.colors[sourceIndex]);
      maximumScale = Math.max(maximumScale, matrix.getMaxScaleOnAxis());
    });
    mesh.castShadow = options.castShadow ?? false;
    mesh.receiveShadow = options.receiveShadow ?? false;
    mesh.computeBoundingSphere();
    // Three cannot see shader-deformed vertices. Expand the static bound so wind
    // never clips a blade or canopy when a cell crosses a frustum edge.
    mesh.boundingSphere!.radius += (options.localBoundsPadding ?? 0) * maximumScale;
    return mesh;
  });
}

/** Release each instance buffer, and each shared geometry exactly once. */
export function disposeSpatialInstances(meshes: readonly THREE.InstancedMesh[]) {
  const geometries = new Set<THREE.BufferGeometry>();
  for (const mesh of meshes) {
    mesh.removeFromParent();
    mesh.dispose();
    geometries.add(mesh.geometry);
  }
  for (const geometry of geometries) geometry.dispose();
}
