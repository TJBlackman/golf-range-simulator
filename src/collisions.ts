import type { Point } from "./physics.ts";

export type Position2 = { x: number; z: number };
export type VehiclePose = Position2 & { angle: number };
/** Collector bounds in the cart's local coordinates, including its wings. */
export type CollectorBounds = {
  minX: number; maxX: number; minZ: number; maxZ: number;
};
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

/** Signed clearance and the direction that moves the collector out of an obstacle. */
function collectorContact(
  cart: VehiclePose,
  bounds: CollectorBounds,
  obstacle: Obstacle,
): { distance: number; normal: Position2 } {
  const c = Math.cos(cart.angle), s = Math.sin(cart.angle);
  const worldNormal = (x: number, z: number) => ({ x: c * x + s * z, z: -s * x + c * z });
  if (obstacle.kind === "circle") {
    const dx = obstacle.x - cart.x, dz = obstacle.z - cart.z;
    const x = c * dx - s * dz, z = s * dx + c * dz;
    const nx = clamp(x, bounds.minX, bounds.maxX) - x;
    const nz = clamp(z, bounds.minZ, bounds.maxZ) - z;
    const length = Math.hypot(nx, nz);
    if (length > 1e-8)
      return { distance: length - obstacle.radius, normal: worldNormal(nx / length, nz / length) };
    const sides = [
      { distance: x - bounds.minX, normal: worldNormal(1, 0) },
      { distance: bounds.maxX - x, normal: worldNormal(-1, 0) },
      { distance: z - bounds.minZ, normal: worldNormal(0, 1) },
      { distance: bounds.maxZ - z, normal: worldNormal(0, -1) },
    ].sort((a, b) => a.distance - b.distance);
    return { distance: -sides[0].distance - obstacle.radius, normal: sides[0].normal };
  }

  // Separating axes for the rotated collector and the world-aligned obstacle.
  const localX = { x: c, z: -s }, localZ = { x: s, z: c };
  const halfX = (bounds.maxX - bounds.minX) / 2, halfZ = (bounds.maxZ - bounds.minZ) / 2;
  const offset = worldNormal((bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2);
  const dx = cart.x + offset.x - (obstacle.minX + obstacle.maxX) / 2;
  const dz = cart.z + offset.z - (obstacle.minZ + obstacle.maxZ) / 2;
  const obstacleHalfX = (obstacle.maxX - obstacle.minX) / 2;
  const obstacleHalfZ = (obstacle.maxZ - obstacle.minZ) / 2;
  let distance = -Infinity, normal = { x: 0, z: 0 };
  for (const axis of [{ x: 1, z: 0 }, { x: 0, z: 1 }, localX, localZ]) {
    const center = dx * axis.x + dz * axis.z;
    const extent = halfX * Math.abs(localX.x * axis.x + localX.z * axis.z) +
      halfZ * Math.abs(localZ.x * axis.x + localZ.z * axis.z) +
      obstacleHalfX * Math.abs(axis.x) + obstacleHalfZ * Math.abs(axis.z);
    const separation = Math.abs(center) - extent;
    if (separation > distance) {
      distance = separation;
      const sign = center < 0 ? -1 : 1;
      normal = { x: axis.x * sign, z: axis.z * sign };
    }
  }
  return { distance, normal };
}

/** Clearance of the whole vehicle, used to keep an impact latched until it moves away. */
export function vehicleObstacleDistance(
  cart: VehiclePose,
  obstacle: Obstacle,
  collector?: CollectorBounds,
): number {
  const bodyDistance = obstacleDistance(cart, obstacle) - VEHICLE_RADIUS;
  return collector
    ? Math.min(bodyDistance, collectorContact(cart, collector, obstacle).distance)
    : bodyDistance;
}

/** Resolve both the cart body and its rotating collector, sweeping movement and steering. */
export function resolveVehicleMove(
  previous: VehiclePose,
  next: VehiclePose,
  obstacles: Obstacle[],
  collector?: CollectorBounds,
): { position: Position2; angle: number; hit?: Obstacle } {
  if (!collector) return { ...resolveMove(previous, next, obstacles), angle: next.angle };
  const dx = next.x - previous.x, dz = next.z - previous.z;
  const turn = next.angle - previous.angle;
  const reach = Math.hypot(
    Math.max(Math.abs(collector.minX), Math.abs(collector.maxX)),
    Math.max(Math.abs(collector.minZ), Math.abs(collector.maxZ)),
  );
  // Keep even a thin collector from skipping a tree or fence between frames.
  const steps = Math.max(1, Math.ceil((Math.hypot(dx, dz) + Math.abs(turn) * reach) / 0.2));
  let position: Position2 = { x: previous.x, z: previous.z };
  for (let step = 1; step <= steps; step++) {
    const angle = previous.angle + turn * step / steps;
    position = { x: position.x + dx / steps, z: position.z + dz / steps };
    let hit: Obstacle | undefined;
    for (let pass = 0; pass < 3; pass++) {
      const body = resolveMove(previous, position, obstacles);
      position = body.position;
      hit ??= body.hit;
      let collectorMoved = false;
      for (const obstacle of obstacles) {
        const contact = collectorContact({ ...position, angle }, collector, obstacle);
        if (contact.distance >= 0) continue;
        hit ??= obstacle;
        collectorMoved = true;
        position.x += contact.normal.x * (-contact.distance + 0.001);
        position.z += contact.normal.z * (-contact.distance + 0.001);
      }
      if (!collectorMoved) break;
    }
    if (hit) return { position, angle, hit };
  }
  return { position, angle: next.angle };
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
