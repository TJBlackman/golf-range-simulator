export const YARD = 0.9144;
export const TEE = { x: -0.46, y: 0.34, z: 4.73 };
/** The back fence sits this many yards past the tee. */
export const RANGE_YARDS = 300;
export const RANGE_END = TEE.z + RANGE_YARDS * YARD;
export type Point = { x: number; y: number; z: number };
export type Shape = "straight" | "draw" | "fade";
export type Club = {
  id: string;
  name: string;
  short: string;
  carry: number;
  loft: number;
  roll: number;
};

export const CLUBS: Club[] = [
  {
    id: "sw",
    name: "Sand wedge",
    short: "SW",
    carry: 70,
    loft: 48,
    roll: 0.12,
  },
  {
    id: "pw",
    name: "Pitching wedge",
    short: "PW",
    carry: 105,
    loft: 40,
    roll: 0.18,
  },
  { id: "7i", name: "7 iron", short: "7I", carry: 145, loft: 32, roll: 0.25 },
  { id: "5i", name: "5 iron", short: "5I", carry: 180, loft: 26, roll: 0.3 },
  { id: "dr", name: "Driver", short: "DR", carry: 225, loft: 18, roll: 0.23 },
];

export const TARGETS = [
  {
    id: "short",
    name: "The short game",
    yards: 50,
    x: -13,
    z: TEE.z + 50 * YARD,
    color: "#d9b675",
  },
  {
    id: "middle",
    name: "Find your rhythm",
    yards: 100,
    x: 12,
    z: TEE.z + 100 * YARD,
    color: "#e08b6c",
  },
  {
    id: "long",
    name: "Go the distance",
    yards: 150,
    x: -8,
    z: TEE.z + 150 * YARD,
    color: "#90b9c7",
  },
  {
    id: "far",
    name: "Big stick",
    yards: 200,
    x: 10,
    z: TEE.z + 200 * YARD,
    color: "#b48ac9",
  },
  {
    id: "back",
    name: "Back fence",
    yards: 250,
    x: -5,
    z: TEE.z + 250 * YARD,
    color: "#e6c35c",
  },
];

export type ShotOptions = {
  club: Club;
  power: number;
  aim: number;
  shape: Shape;
  wind: number;
};
export type Shot = {
  points: (Point & { t: number })[];
  landing: Point;
  end: Point;
  carry: number;
  total: number;
  apex: number;
  duration: number;
  speed: number;
};

const DT = 1 / 120;
const speedCache = new Map<string, number>();
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.z - b.z);

function flight(
  speed: number,
  loft: number,
  aim: number,
  wind: number,
  shape: Shape,
  roll: number,
  origin: Point = TEE,
): Shot {
  // Looking down the range (+Z), screen-right is world -X.
  const angle = (-aim * Math.PI) / 180;
  const elevation = (loft * Math.PI) / 180;
  const p = { ...origin };
  const v = {
    x: Math.sin(angle) * Math.cos(elevation) * speed,
    y: Math.sin(elevation) * speed,
    z: Math.cos(angle) * Math.cos(elevation) * speed,
  };
  const points = [{ ...p, t: 0 }];
  let landing = { ...origin };
  let apex = p.y;
  let grounded = false;
  let bounced = false;
  let time = 0;
  const curve = shape === "draw" ? 0.7 : shape === "fade" ? -0.7 : 0;
  for (let step = 1; step < 2400; step++) {
    time = step * DT;
    if (!grounded) {
      const relativeX = v.x + wind;
      const airSpeed = Math.hypot(relativeX, v.y, v.z);
      v.x += (-0.003 * airSpeed * relativeX + curve * Math.cos(angle)) * DT;
      v.y += (-9.81 - 0.003 * airSpeed * v.y) * DT;
      v.z += (-0.003 * airSpeed * v.z - curve * Math.sin(angle)) * DT;
      p.x += v.x * DT;
      p.y += v.y * DT;
      p.z += v.z * DT;
      apex = Math.max(apex, p.y);
      if (p.y <= 0.07) {
        p.y = 0.07;
        if (!bounced) {
          landing = { ...p };
          bounced = true;
          v.y = Math.abs(v.y) * 0.15;
          v.x *= roll;
          v.z *= roll;
        } else {
          grounded = true;
          v.y = 0;
        }
      }
    } else {
      const horizontal = Math.hypot(v.x, v.z);
      const next = Math.max(0, horizontal - 2.6 * DT);
      if (horizontal > 0) {
        v.x *= next / horizontal;
        v.z *= next / horizontal;
      }
      p.x += v.x * DT;
      p.z += v.z * DT;
      if (next < 0.05) {
        points.push({ ...p, t: time });
        break;
      }
    }
    if (step % 2 === 0) points.push({ ...p, t: time });
  }
  return {
    points,
    landing,
    end: { ...p },
    carry: distance(origin, landing) / YARD,
    total: distance(origin, p) / YARD,
    apex: apex / YARD,
    duration: time,
    speed,
  };
}

function clubSpeed(club: Club): number {
  const key = `${club.id}:${club.carry}:${club.loft}`;
  const cached = speedCache.get(key);
  if (cached) return cached;
  let low = 10,
    high = 120;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    const carry = flight(middle, club.loft, 0, 0, "straight", club.roll).carry;
    if (carry < club.carry) low = middle;
    else high = middle;
  }
  const result = (low + high) / 2;
  speedCache.set(key, result);
  return result;
}

export function simulateShot(options: ShotOptions, origin: Point = TEE): Shot {
  return flight(
    clubSpeed(options.club) * Math.sqrt(clamp(options.power, 0.05, 1)),
    options.club.loft,
    clamp(options.aim, -30, 30),
    options.wind,
    options.shape,
    options.club.roll,
    origin,
  );
}

export function sampleShot(shot: Shot, time: number): Point {
  const index = Math.min(
    Math.floor(Math.max(0, time) / (DT * 2)),
    shot.points.length - 1,
  );
  const a = shot.points[index];
  const b = shot.points[Math.min(index + 1, shot.points.length - 1)];
  const blend = b.t === a.t ? 0 : clamp((time - a.t) / (b.t - a.t), 0, 1);
  return {
    x: a.x + (b.x - a.x) * blend,
    y: a.y + (b.y - a.y) * blend,
    z: a.z + (b.z - a.z) * blend,
  };
}
