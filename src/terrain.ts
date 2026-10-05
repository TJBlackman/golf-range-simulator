import { TARGETS } from "./physics.ts";

export const SAND_SPEED_MULTIPLIER = 0.7;
export const SAND_TRAP_ROTATION = -0.35;
/** The same polygon supplies both the rendered sand and its driving boundary. */
export const SAND_TRAP_OUTLINE = Array.from({ length: 64 }, (_, i) => {
  const angle = i / 64 * Math.PI * 2;
  const radius = 1 + Math.sin(angle * 3 + 0.7) * 0.18;
  return { x: Math.cos(angle) * 5 * radius, y: Math.sin(angle) * 2.8 * radius };
});
export const SAND_TRAPS = TARGETS.map(target => ({
  x: target.x - 9.2,
  z: target.z + 5.8,
  targetZ: target.z,
}));

export function cartSpeedMultiplier(position: { x: number; z: number }, rangeEnd: number): number {
  const cos = Math.cos(SAND_TRAP_ROTATION), sin = Math.sin(SAND_TRAP_ROTATION);
  for (const trap of SAND_TRAPS) {
    if (trap.targetZ >= rangeEnd - 18) continue;
    const dx = position.x - trap.x, dz = position.z - trap.z;
    // Undo the mesh's in-plane rotation followed by its -90° rotation about X.
    const x = cos * dx - sin * dz, y = -sin * dx - cos * dz;
    if (Math.abs(x) > 6 || Math.abs(y) > 3.4) continue;
    let inside = false;
    for (let i = 0, j = SAND_TRAP_OUTLINE.length - 1; i < SAND_TRAP_OUTLINE.length; j = i++) {
      const a = SAND_TRAP_OUTLINE[i], b = SAND_TRAP_OUTLINE[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)
        inside = !inside;
    }
    if (inside) return SAND_SPEED_MULTIPLIER;
  }
  return 1;
}
