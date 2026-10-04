import type { Point } from "./physics.ts";

export type Position2 = { x: number; z: number };
type BaseObstacle = { id: string; name: string };
export type Obstacle = BaseObstacle &
  (
    | { kind: "circle"; x: number; z: number; radius: number }
    | { kind: "box"; minX: number; maxX: number; minZ: number; maxZ: number }
  );
export const VEHICLE_RADIUS = 1.55;
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));

export function obstacleDistance(
  position: Position2,
  obstacle: Obstacle,
): number {
  if (obstacle.kind === "circle")
    return (
      Math.hypot(position.x - obstacle.x, position.z - obstacle.z) -
      obstacle.radius
    );
  const x = clamp(position.x, obstacle.minX, obstacle.maxX),
    z = clamp(position.z, obstacle.minZ, obstacle.maxZ);
  return Math.hypot(position.x - x, position.z - z);
}

export function resolveMove(
  previous: Position2,
  next: Position2,
  obstacles: Obstacle[],
  radius = VEHICLE_RADIUS,
): { position: Position2; hit?: Obstacle } {
  const position = { ...next };
  let hit: Obstacle | undefined;
  for (let pass = 0; pass < 3; pass++) {
    for (const obstacle of obstacles) {
      if (obstacleDistance(position, obstacle) >= radius) continue;
      hit ??= obstacle;
      if (obstacle.kind === "circle") {
        let dx = position.x - obstacle.x,
          dz = position.z - obstacle.z;
        const length = Math.hypot(dx, dz);
        if (length < 1e-8) {
          dx = previous.x - obstacle.x;
          dz = previous.z - obstacle.z;
        }
        const divisor = Math.hypot(dx, dz) || 1;
        position.x =
          obstacle.x +
          ((dx || (!dz ? 1 : 0)) / divisor) *
            (radius + obstacle.radius + 0.001);
        position.z =
          obstacle.z + (dz / divisor) * (radius + obstacle.radius + 0.001);
      } else {
        const nearestX = clamp(position.x, obstacle.minX, obstacle.maxX),
          nearestZ = clamp(position.z, obstacle.minZ, obstacle.maxZ);
        const dx = position.x - nearestX,
          dz = position.z - nearestZ,
          length = Math.hypot(dx, dz);
        if (length > 1e-8) {
          position.x = nearestX + (dx / length) * (radius + 0.001);
          position.z = nearestZ + (dz / length) * (radius + 0.001);
        } else {
          const sides = [
            {
              d: position.x - obstacle.minX,
              axis: "x" as const,
              value: obstacle.minX - radius - 0.001,
            },
            {
              d: obstacle.maxX - position.x,
              axis: "x" as const,
              value: obstacle.maxX + radius + 0.001,
            },
            {
              d: position.z - obstacle.minZ,
              axis: "z" as const,
              value: obstacle.minZ - radius - 0.001,
            },
            {
              d: obstacle.maxZ - position.z,
              axis: "z" as const,
              value: obstacle.maxZ + radius + 0.001,
            },
          ].sort((a, b) => a.d - b.d);
          position[sides[0].axis] = sides[0].value;
        }
      }
    }
  }
  return { position, hit };
}

// Sweep the entire ball movement through the rotated cart, so fast shots cannot tunnel through it.
export function segmentHitsVehicle(
  a: Point,
  b: Point,
  cart: Position2 & { angle: number },
): boolean {
  const c = Math.cos(cart.angle),
    s = Math.sin(cart.angle);
  const local = (p: Point) => ({
    x: c * (p.x - cart.x) - s * (p.z - cart.z),
    y: p.y,
    z: s * (p.x - cart.x) + c * (p.z - cart.z),
  });
  const from = local(a),
    to = local(b);
  const bounds = { x: [-1.15, 1.15], y: [0.25, 2.4], z: [-1.8, 2.3] };
  let enter = 0,
    exit = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const delta = to[axis] - from[axis];
    const [low, high] = bounds[axis];
    if (Math.abs(delta) < 1e-9) {
      if (from[axis] < low || from[axis] > high) return false;
    } else {
      const t1 = (low - from[axis]) / delta,
        t2 = (high - from[axis]) / delta;
      enter = Math.max(enter, Math.min(t1, t2));
      exit = Math.min(exit, Math.max(t1, t2));
      if (enter > exit) return false;
    }
  }
  return true;
}
