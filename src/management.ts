export const HOPPER_CAPACITY = 75;
/** Cash paid on top of a delivery when the hopper arrives completely full. */
export const FULL_LOAD_BONUS = 5;
export const INITIAL_RESERVE = 50;
export const GOLFER_COUNT = 7;
export const MAX_BAYS = 12;
export const STARTING_CASH = 20;
export const STARTING_REPUTATION = 60;
export const TIP_STREAK = 10;
export const STOCK_BUNDLE = 50;
export const WALKOUT_SECONDS = 4;
/** Drive in, park, and walk to the mat before taking the first shot. */
export const ARRIVAL_READY_SECONDS = 8.25;
/** Seconds after the shift opens before the first cart of the opening lineup rolls in, as a random range. */
export const OPENING_FIRST_CART_SECONDS = [0.3, 0.8] as const;
/** Random gap between one opening cart and the next. Seven bays fill in roughly fifteen seconds. */
export const OPENING_CART_GAP_SECONDS = [0.7, 1.5] as const;
/** Share of golfers who set up on the other side of the ball. */
export const LEFT_HANDED_CHANCE = 0.1;
/** Range length per tier, in yards. */
export const RANGE_TIERS = [100, 150, 200, 250, 300];
/** Shot interval multiplier per range tier: short ranges play slow. */
export const PACE = [2, 1.65, 1.35, 1.15, 1];

export type SpillCause = "obstacle" | "ball";
export type GolferType = "casual" | "family" | "grinder" | "pro";
export type GolferStatus = "playing" | "leaving" | "empty";

export type GolferProfile = {
  name: string;
  /** Dollars earned per ball hit. */
  pay: number;
  /** Seconds between shots. */
  interval: number;
  /** Patience lost per second while waiting for balls. */
  drain: number;
  /** Patience regained per second while hitting. */
  recover: number;
  /** Dollars tipped every TIP_STREAK uninterrupted shots. */
  tip: number;
  /** Minimum star rating before this type shows up. */
  minStars: number;
  /** Minimum range length in yards before this type shows up. */
  minYards: number;
  weight: number;
  /** Polo colour in the 3D scene. */
  color: string;
};

export const GOLFER_TYPES: Record<GolferType, GolferProfile> = {
  casual: {
    name: "Casual",
    pay: 0.25,
    interval: 3.8,
    drain: 2.5,
    recover: 2.4,
    tip: 1.5,
    minStars: 0,
    minYards: 0,
    weight: 4,
    color: "#e07a2f",
  },
  family: {
    name: "Family",
    pay: 0.15,
    interval: 4.4,
    drain: 4,
    recover: 2,
    tip: 0.5,
    minStars: 0,
    minYards: 0,
    weight: 2,
    color: "#4f9e5a",
  },
  grinder: {
    name: "Grinder",
    pay: 0.35,
    interval: 2.6,
    drain: 3.5,
    recover: 2.2,
    tip: 2,
    minStars: 2.5,
    minYards: 200,
    weight: 3,
    color: "#c7473b",
  },
  pro: {
    name: "Pro",
    pay: 0.6,
    interval: 3.2,
    drain: 5,
    recover: 1.8,
    tip: 5,
    minStars: 4,
    minYards: 250,
    weight: 3,
    color: "#2f3a4f",
  },
};

export type GolferState = {
  id: number;
  type: GolferType;
  status: GolferStatus;
  /** Left-handed golfers stand on the far side of the tee and swing the other way. */
  leftHanded: boolean;
  /** An opening lineup golfer is still on the way to this bay. They keep their preset type and are already counted as served. */
  booked: boolean;
  patience: number;
  waiting: boolean;
  nextShot: number;
  shots: number;
  streak: number;
  /** Balls held in the bay's own dispenser. */
  buffer: number;
  /** Leaving: when the walkout ends. Empty: when the next golfer arrives. */
  until: number;
};
export type ShotOrder = { golfer: number; number: number; lost: boolean };
export type SimEvent =
  | { kind: "walkout" | "arrival"; golfer: number; type: GolferType }
  | { kind: "tip"; golfer: number; type: GolferType; amount: number }
  | { kind: "over" };

export type UpgradeCategory = "cart" | "range" | "supply";
export type UpgradeId =
  | "range"
  | "engine"
  | "hopper"
  | "collector"
  | "cage"
  | "bumper"
  | "bays"
  | "dispensers"
  | "depot"
  | "clearing"
  | "nets"
  | "helper"
  | "stock";
export type Upgrade = {
  id: UpgradeId;
  name: string;
  category: UpgradeCategory;
  blurb: string;
  /** One price per tier. Empty for repeatable purchases. */
  costs: number[];
  /** What each level gives you, index 0 being stock. */
  levels: string[];
  /** Fixed price for purchases that never max out. */
  repeat?: number;
};

export const ENGINE_SPEEDS = [9, 11.5, 14, 17];
export const HOPPER_CAPACITIES = [HOPPER_CAPACITY, 100, 125, 150];
export const COLLECTOR_HALF_WIDTHS = [1.6, 2.6, 3.6];
export const CAGE_RATES = [0.15, 0.08, 0];
export const BUMPER_RATES = [0.5, 0.3, 0.15];
export const BAY_COUNTS = [GOLFER_COUNT, 9, MAX_BAYS];
export const DISPENSER_BUFFERS = [0, 6, 12];
export const LOSS_RATES = [0.04, 0.02, 0.005];

export const UPGRADES: Upgrade[] = [
  {
    id: "engine",
    name: "Engine",
    category: "cart",
    blurb: "Top speed and acceleration.",
    costs: [40, 90, 160],
    levels: ["Stock, 9 m/s", "Tuned, 11.5 m/s", "Turbo, 14 m/s", "Race, 17 m/s"],
  },
  {
    id: "hopper",
    name: "Hopper",
    category: "cart",
    blurb: `Balls the cart can carry. A full load pays a $${FULL_LOAD_BONUS} delivery bonus.`,
    costs: [40, 90, 160],
    levels: ["75 balls", "100 balls", "125 balls", "150 balls"],
  },
  {
    id: "collector",
    name: "Collector",
    category: "cart",
    blurb: "Wider pickup swath on the front.",
    costs: [60, 150],
    levels: ["Single disc", "Double gang", "Triple gang"],
  },
  {
    id: "cage",
    name: "Cage",
    category: "cart",
    blurb: "Shields the hopper from flying balls.",
    costs: [45, 100],
    levels: ["Ball strike spills 15%", "Spills 8%", "Spills nothing"],
  },
  {
    id: "bumper",
    name: "Bumper",
    category: "cart",
    blurb: "Softens obstacle collisions.",
    costs: [45, 100],
    levels: ["Collision spills 50%", "Spills 30%", "Spills 15%"],
  },
  {
    id: "range",
    name: "Range length",
    category: "range",
    blurb: "A longer range brings faster hitters and better paying golfers.",
    costs: [120, 220, 360, 520],
    levels: [
      "100 yards, slow play",
      "150 yards",
      "200 yards, grinders arrive",
      "250 yards, pros arrive",
      "300 yards, full pace",
    ],
  },
  {
    id: "bays",
    name: "Hitting bays",
    category: "range",
    blurb: "More bays, more golfers, more balls on the ground.",
    costs: [150, 320],
    levels: ["7 bays", "9 bays", "12 bays"],
  },
  {
    id: "dispensers",
    name: "Bay dispensers",
    category: "range",
    blurb: "Each bay keeps its own buffer of balls.",
    costs: [120, 220],
    levels: ["No buffer", "6 balls per bay", "12 balls per bay"],
  },
  {
    id: "depot",
    name: "Second depot",
    category: "range",
    blurb: "A return point out on the range to cut travel.",
    costs: [200],
    levels: ["One depot", "Two depots"],
  },
  {
    id: "clearing",
    name: "Clear obstacles",
    category: "range",
    blurb: "Remove hazards from the field.",
    costs: [60, 120],
    levels: ["Log and boulders in place", "Log removed", "Boulders removed"],
  },
  {
    id: "nets",
    name: "Nets",
    category: "range",
    blurb: "Fewer balls sliced out of bounds.",
    costs: [90, 180],
    levels: ["4% of shots lost", "2% lost", "0.5% lost"],
  },
  {
    id: "helper",
    name: "Helper cart",
    category: "range",
    blurb: "A driverless cart that sweeps lanes and returns on its own.",
    costs: [400],
    levels: ["No helper", "Helper on duty"],
  },
  {
    id: "stock",
    name: "Buy balls",
    category: "supply",
    blurb: `${STOCK_BUNDLE} fresh balls straight into the depot.`,
    costs: [],
    levels: ["Always available"],
    repeat: 20,
  },
];

export function spillAmount(
  hopper: number,
  cause: SpillCause,
  rate = cause === "obstacle" ? BUMPER_RATES[0] : CAGE_RATES[0],
): number {
  return Math.min(hopper, Math.ceil(hopper * rate));
}

export const INITIAL_LINEUP: GolferType[] = [
  "casual",
  "family",
  "casual",
  "casual",
  "casual",
  "family",
  "casual",
];
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));

const MANAGEMENT_NUMBERS = [
  "reserve", "hopper", "collected", "returned", "spilled", "deliveries",
  "obstacleHits", "ballHits", "ballsHit", "ballsLost", "helperReturned", "time",
  "cash", "earned", "tips", "spent", "reputation", "walkouts", "arrivals",
  "served", "bonuses", "fullLoads",
] as const;
const FRACTIONAL_STATE = new Set<string>(["time", "cash", "earned", "tips", "spent", "reputation", "bonuses"]);
/** Stats added after the first saves shipped. Older saves load with these at zero. */
const OPTIONAL_STATE = new Set<string>(["bonuses", "fullLoads"]);
export type ManagementSnapshot = Record<typeof MANAGEMENT_NUMBERS[number], number> & {
  over: boolean;
  levels: Record<UpgradeId, number>;
  golfers: GolferState[];
  events: SimEvent[];
  randomState: number;
};

/** Validate and copy only the known save fields before changing a live shift. */
export function validateManagementSnapshot(input: unknown): ManagementSnapshot {
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The saved range state is invalid.");
    return value as Record<string, unknown>;
  };
  const number = (value: unknown, max = 1e12, integer = false) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isSafeInteger(value)))
      throw new Error("The saved range contains an invalid number.");
    return value;
  };
  const boolean = (value: unknown) => {
    if (typeof value !== "boolean") throw new Error("The saved range contains an invalid flag.");
    return value;
  };
  const source = record(input);
  const numbers = {} as Record<typeof MANAGEMENT_NUMBERS[number], number>;
  for (const key of MANAGEMENT_NUMBERS)
    numbers[key] = OPTIONAL_STATE.has(key) && source[key] === undefined
      ? 0
      : number(source[key], key === "reputation" ? 100 : 1e12, !FRACTIONAL_STATE.has(key));
  const savedLevels = record(source.levels);
  const levels = {} as Record<UpgradeId, number>;
  for (const upgrade of UPGRADES)
    levels[upgrade.id] = number(savedLevels[upgrade.id], upgrade.repeat ? 1e9 : upgrade.costs.length, true);
  if (numbers.hopper > HOPPER_CAPACITIES[levels.hopper]) throw new Error("The saved hopper exceeds its capacity.");
  if (!Array.isArray(source.golfers) || source.golfers.length !== BAY_COUNTS[levels.bays]) throw new Error("The saved hitting bays do not match their upgrade level.");
  const golferType = (value: unknown): GolferType => {
    if (typeof value !== "string" || !Object.hasOwn(GOLFER_TYPES, value)) throw new Error("The saved golfer type is invalid.");
    return value as GolferType;
  };
  const golfers = source.golfers.map((value, index): GolferState => {
    const saved = record(value);
    if (saved.id !== index || typeof saved.status !== "string" || !["playing", "leaving", "empty"].includes(saved.status)) throw new Error("The saved golfer status is invalid.");
    return {
      id: index, type: golferType(saved.type), status: saved.status as GolferStatus,
      // Saves written before handedness and the opening lineup existed hold seated right-handers.
      leftHanded: saved.leftHanded === undefined ? false : boolean(saved.leftHanded),
      booked: saved.booked === undefined ? false : boolean(saved.booked),
      patience: number(saved.patience, 100), waiting: boolean(saved.waiting),
      nextShot: number(saved.nextShot), shots: number(saved.shots, 1e12, true),
      streak: number(saved.streak, 1e12, true), buffer: number(saved.buffer, DISPENSER_BUFFERS[levels.dispensers], true),
      until: number(saved.until),
    };
  });
  if (!Array.isArray(source.events) || source.events.length > 1000) throw new Error("The saved event queue is invalid.");
  const events = source.events.map((value): SimEvent => {
    const saved = record(value);
    if (saved.kind === "over") return { kind: "over" };
    if (saved.kind !== "arrival" && saved.kind !== "walkout" && saved.kind !== "tip") throw new Error("The saved event type is invalid.");
    const golfer = number(saved.golfer, golfers.length - 1, true), type = golferType(saved.type);
    return saved.kind === "tip"
      ? { kind: "tip", golfer, type, amount: number(saved.amount, 1000) }
      : { kind: saved.kind, golfer, type };
  });
  return { ...numbers, levels, golfers, events, over: boolean(source.over), randomState: number(source.randomState, 4294967295, true) };
}

export class RangeManagement {
  reserve = INITIAL_RESERVE;
  hopper = 0;
  collected = 0;
  returned = 0;
  spilled = 0;
  deliveries = 0;
  obstacleHits = 0;
  ballHits = 0;
  ballsHit = 0;
  ballsLost = 0;
  helperReturned = 0;
  time = 0;
  cash = STARTING_CASH;
  earned = 0;
  tips = 0;
  /** Cash earned from full load delivery bonuses. */
  bonuses = 0;
  /** Deliveries made with the hopper completely full. */
  fullLoads = 0;
  spent = 0;
  reputation = STARTING_REPUTATION;
  walkouts = 0;
  arrivals = 0;
  served = GOLFER_COUNT;
  over = false;
  readonly levels: Record<UpgradeId, number> = {
    range: 0,
    engine: 0,
    hopper: 0,
    collector: 0,
    cage: 0,
    bumper: 0,
    bays: 0,
    dispensers: 0,
    depot: 0,
    clearing: 0,
    nets: 0,
    helper: 0,
    stock: 0,
  };
  readonly golfers: GolferState[] = INITIAL_LINEUP.map((type, id) => ({
    id,
    type,
    status: "empty",
    leftHanded: false,
    booked: true,
    patience: 100,
    waiting: false,
    nextShot: 0,
    shots: 0,
    streak: 0,
    buffer: 0,
    until: 0,
  }));
  private events: SimEvent[] = [];

  private readonly random: () => number;
  private randomState = Math.floor(Math.random() * 4294967296);

  constructor(random?: () => number) {
    this.random = random ?? (() => {
      this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
      return this.randomState / 4294967296;
    });
    // The opening lineup drives in one cart at a time. Higher numbered bays sit
    // farther from the entrance, so filling them first keeps the faster carts
    // ahead on the entry lane instead of overtaking the slower ones.
    let at = this.between(OPENING_FIRST_CART_SECONDS);
    for (const golfer of [...this.golfers].reverse()) {
      golfer.until = at;
      at += this.between(OPENING_CART_GAP_SECONDS);
    }
  }

  private between([low, high]: readonly [number, number]) {
    return low + this.random() * (high - low);
  }

  private rollHandedness() {
    return this.random() < LEFT_HANDED_CHANCE;
  }

  exportState(): ManagementSnapshot {
    const numbers = {} as Record<typeof MANAGEMENT_NUMBERS[number], number>;
    for (const key of MANAGEMENT_NUMBERS) numbers[key] = this[key];
    return {
      ...numbers, over: this.over, randomState: this.randomState,
      levels: { ...this.levels }, golfers: this.golfers.map(golfer => ({ ...golfer })),
      events: this.events.map(event => ({ ...event })),
    };
  }

  restoreState(input: unknown) {
    const snapshot = validateManagementSnapshot(input);
    for (const key of MANAGEMENT_NUMBERS) this[key] = snapshot[key];
    for (const upgrade of UPGRADES) this.levels[upgrade.id] = snapshot.levels[upgrade.id];
    this.golfers.splice(0, this.golfers.length, ...snapshot.golfers);
    this.events = snapshot.events;
    this.over = snapshot.over;
    this.randomState = snapshot.randomState;
  }

  get bays() {
    return BAY_COUNTS[this.levels.bays];
  }
  get rangeYards() {
    return RANGE_TIERS[this.levels.range];
  }
  get pace() {
    return PACE[this.levels.range];
  }
  get hopperCapacity() {
    return HOPPER_CAPACITIES[this.levels.hopper];
  }
  get maxSpeed() {
    return ENGINE_SPEEDS[this.levels.engine];
  }
  get collectorHalfWidth() {
    return COLLECTOR_HALF_WIDTHS[this.levels.collector];
  }
  get dispenserBuffer() {
    return DISPENSER_BUFFERS[this.levels.dispensers];
  }
  get lossRate() {
    return LOSS_RATES[this.levels.nets];
  }
  get stars() {
    return this.reputation / 20;
  }
  /** Survival time in seconds; longer shifts score higher. */
  get score() {
    return this.time;
  }
  get present() {
    return this.golfers.filter((g) => g.status === "playing");
  }
  get satisfaction() {
    const present = this.present;
    if (!present.length) return 0;
    return Math.round(
      present.reduce((sum, g) => sum + g.patience, 0) / present.length,
    );
  }
  get waiting() {
    return this.golfers.filter((g) => g.status === "playing" && g.waiting)
      .length;
  }
  /** Balls available to golfers, at the depot and in bay dispensers. */
  get supply() {
    return this.reserve + this.golfers.reduce((sum, g) => sum + g.buffer, 0);
  }

  /** Normal pace at the opening supply, up to twice as fast or 50% longer intervals. */
  get supplyPace() {
    return clamp(1.5 - this.supply / (INITIAL_RESERVE * 2), 0.5, 1.5);
  }

  takeEvents(): SimEvent[] {
    return this.events.splice(0);
  }

  spillRate(cause: SpillCause) {
    return cause === "obstacle"
      ? BUMPER_RATES[this.levels.bumper]
      : CAGE_RATES[this.levels.cage];
  }

  /** Seconds until a new golfer fills an empty bay at the current rating. */
  arrivalDelay() {
    const t = clamp((this.stars - 1) / 4, 0, 1);
    return 36 - 32 * t;
  }

  update(dt: number): ShotOrder[] {
    if (this.over || this.finishIfEmpty()) return [];
    // Stop the clock at the final departure, even if it falls inside this frame.
    const departing = this.golfers.filter((g) => g.status === "leaving");
    if (departing.length && !this.golfers.some((g) => g.status === "playing" || g.booked))
      dt = Math.min(dt, Math.max(0, Math.max(...departing.map((g) => g.until)) - this.time));
    this.time += dt;
    const shots: ShotOrder[] = [];
    for (const golfer of departing) {
      if (this.time >= golfer.until) {
        golfer.status = "empty";
        golfer.until = this.time + this.arrivalDelay();
      }
    }
    // Resolve departures before admitting anyone else: an empty range ends the shift.
    if (this.finishIfEmpty()) return [];
    for (const golfer of this.golfers) {
      if (golfer.status === "leaving") continue;
      if (golfer.status === "empty") {
        if (this.stars >= 1 && this.time >= golfer.until) this.arrive(golfer);
        continue;
      }
      const profile = GOLFER_TYPES[golfer.type];
      if (this.time >= golfer.nextShot) {
        if (golfer.buffer < this.dispenserBuffer && this.reserve > 0) {
          golfer.buffer++;
          this.reserve--;
        }
        if (this.reserve > 0 || golfer.buffer > 0) {
          if (this.reserve > 0) this.reserve--;
          else golfer.buffer--;
          golfer.shots++;
          golfer.streak++;
          golfer.waiting = false;
          golfer.nextShot =
            this.time + (profile.interval * this.pace + golfer.id * 0.03) * this.supplyPace;
          this.ballsHit++;
          this.earn(profile.pay);
          if (golfer.streak % TIP_STREAK === 0 && golfer.patience >= 70) {
            this.earn(profile.tip);
            this.tips += profile.tip;
            this.events.push({
              kind: "tip",
              golfer: golfer.id,
              type: golfer.type,
              amount: profile.tip,
            });
          }
          const lost = this.random() < this.lossRate;
          if (lost) this.ballsLost++;
          shots.push({ golfer: golfer.id, number: golfer.shots, lost });
        } else if (!golfer.waiting) {
          golfer.waiting = true;
          golfer.streak = 0;
        }
      }
      golfer.patience = clamp(
        golfer.patience +
          dt * (golfer.waiting ? -profile.drain : profile.recover),
        0,
        100,
      );
      if (golfer.patience <= 0) this.walkout(golfer);
    }
    const present = this.present;
    const booked = this.golfers.some((g) => g.booked);
    const target = present.length
      ? present.reduce((sum, g) => sum + g.patience, 0) / present.length
      : booked
        ? this.reputation
        : this.supply >= 20
          ? 45
          : 0;
    this.reputation += (target - this.reputation) * Math.min(1, dt * 0.05);
    this.reputation = clamp(this.reputation, 0, 100);
    return shots;
  }

  private finishIfEmpty() {
    // Booked golfers protect the staggered opening before the first cart arrives.
    if (this.golfers.some((g) => g.status !== "empty" || g.booked)) return false;
    this.over = true;
    this.events.push({ kind: "over" });
    return true;
  }

  private earn(amount: number) {
    this.cash += amount;
    this.earned += amount;
  }

  private walkout(golfer: GolferState) {
    golfer.status = "leaving";
    golfer.waiting = false;
    golfer.until = this.time + WALKOUT_SECONDS;
    this.walkouts++;
    this.reputation = Math.max(0, this.reputation - 5);
    this.events.push({ kind: "walkout", golfer: golfer.id, type: golfer.type });
  }

  private arrive(golfer: GolferState) {
    const booked = golfer.booked;
    golfer.booked = false;
    if (!booked) golfer.type = this.pickType();
    golfer.status = "playing";
    golfer.leftHanded = this.rollHandedness();
    golfer.patience = 100;
    golfer.waiting = false;
    golfer.shots = 0;
    golfer.streak = 0;
    golfer.buffer = 0;
    golfer.nextShot = this.time + ARRIVAL_READY_SECONDS;
    // The opening lineup is already counted as served and needs no announcement.
    if (booked) return;
    this.arrivals++;
    this.served++;
    this.events.push({ kind: "arrival", golfer: golfer.id, type: golfer.type });
  }

  private pickType(): GolferType {
    const stars = this.stars;
    const eligible = (Object.keys(GOLFER_TYPES) as GolferType[]).filter(
      (type) =>
        GOLFER_TYPES[type].minStars <= stars &&
        GOLFER_TYPES[type].minYards <= this.rangeYards,
    );
    const total = eligible.reduce((sum, t) => sum + GOLFER_TYPES[t].weight, 0);
    let roll = this.random() * total;
    for (const type of eligible) {
      roll -= GOLFER_TYPES[type].weight;
      if (roll <= 0) return type;
    }
    return eligible[eligible.length - 1];
  }

  /** Price of the next tier, or undefined when maxed out. */
  price(id: UpgradeId): number | undefined {
    const upgrade = UPGRADES.find((u) => u.id === id)!;
    return upgrade.repeat ?? upgrade.costs[this.levels[id]];
  }

  buy(id: UpgradeId): "ok" | "maxed" | "poor" {
    const cost = this.price(id);
    if (cost === undefined) return "maxed";
    if (this.cash < cost) return "poor";
    this.cash -= cost;
    this.spent += cost;
    if (id === "stock") {
      this.reserve += STOCK_BUNDLE;
      this.levels.stock++;
      return "ok";
    }
    this.levels[id]++;
    if (id === "bays") this.openBays();
    return "ok";
  }

  private openBays() {
    while (this.golfers.length < this.bays)
      this.golfers.push({
        id: this.golfers.length,
        type: "casual",
        status: "empty",
        leftHanded: false,
        booked: false,
        patience: 0,
        waiting: false,
        nextShot: 0,
        shots: 0,
        streak: 0,
        buffer: 0,
        until: this.time + 3,
      });
  }

  collect(count: number): number {
    const accepted = Math.max(
      0,
      Math.min(Math.floor(count), this.hopperCapacity - this.hopper),
    );
    this.hopper += accepted;
    this.collected += accepted;
    return accepted;
  }

  /** Return the load to the depot. A completely full hopper earns FULL_LOAD_BONUS on top. */
  unload(): { count: number; bonus: number } {
    const count = this.hopper;
    if (!count) return { count: 0, bonus: 0 };
    const bonus = count === this.hopperCapacity ? FULL_LOAD_BONUS : 0;
    this.reserve += count;
    this.returned += count;
    this.deliveries++;
    this.hopper = 0;
    if (bonus) {
      this.earn(bonus);
      this.bonuses += bonus;
      this.fullLoads++;
    }
    // A fresh delivery gives the waiting golfers some immediate reassurance.
    for (const golfer of this.golfers)
      if (golfer.status === "playing")
        golfer.patience = Math.min(100, golfer.patience + 8);
    this.reputation = Math.min(100, this.reputation + 6);
    return { count, bonus };
  }

  deliverHelper(count: number) {
    if (count <= 0) return;
    this.reserve += count;
    this.helperReturned += count;
  }

  spill(cause: SpillCause): number {
    const count = spillAmount(this.hopper, cause, this.spillRate(cause));
    this.hopper -= count;
    this.spilled += count;
    if (cause === "obstacle") this.obstacleHits++;
    else this.ballHits++;
    return count;
  }
}
