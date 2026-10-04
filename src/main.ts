import "@fontsource-variable/dm-sans";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/fraunces/wght-italic.css";
import "./style.css";
import { RangeScene } from "./scene";
import { RangeAudio } from "./audio";
import {
  RangeManagement,
  UPGRADES,
  GOLFER_TYPES,
  STOCK_BUNDLE,
} from "./management";
import type { SpillCause, UpgradeId, UpgradeCategory } from "./management";
import { TARGETS, YARD } from "./physics";

const icons = {
  menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
  flag: '<path d="M6 21V3m0 1c5-4 7 4 13 0v9c-6 4-8-4-13 0"/>',
  tractor:
    '<circle cx="7" cy="17" r="4"/><circle cx="19" cy="18" r="3"/><path d="M3 13V5h8v8h9l1 2M7 5V2h8v10M16 12V7"/>',
  bucket:
    '<path d="m4 8 3 13h10l3-13H4m2 0a6 6 0 0 1 12 0"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>',
  happy:
    '<circle cx="12" cy="12" r="9"/><path d="M8 14s1 3 4 3 4-3 4-3M8 8h.01M16 8h.01"/>',
  sound:
    '<path d="M11 4 6 8H3v8h3l5 4V4m4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 4 6 8H3v8h3l5 4V4m4 5 6 6m0-6-6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01"/>',
  settings:
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  camera: '<path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
  warning: '<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01"/>',
};
const icon = (name: keyof typeof icons, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const storage = {
  get(key: string, fallback: string) {
    try {
      return localStorage.getItem("fairway:" + key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem("fairway:" + key, value);
    } catch {
      /* Preferences are optional. */
    }
  },
};

$("#app").innerHTML = `
<main class="game" aria-label="Golf range ball collector">
  <canvas id="range" aria-label="3D driving range with a drivable ball collector and autonomous golfers"></canvas>
  <button id="pause" class="menu-button hud-surface" aria-label="Open game menu" aria-controls="pause-overlay" aria-expanded="false" title="Menu · Esc / P">${icon("menu", 18)}</button>

  <aside class="game-hud hud-surface" aria-label="Range status">
    <div class="hud-primary">
      <div id="cash-stat" class="hud-stat primary" title="Cash from golfers, spend it at the depot"><div><span class="stat-label">CASH</span><strong id="cash">$20</strong></div></div>
      <div id="supply-stat" class="hud-stat primary" title="Balls ready for the golfers"><div><span class="stat-label">SUPPLY</span><strong id="reserve-count">84</strong></div></div>
    </div>
    <div id="mood-stat" class="hud-stat" title="Golfer satisfaction"><div><span id="mood-label" class="stat-label">MOOD</span><strong><span id="satisfaction">100</span><small>%</small></strong></div></div>
    <div id="hopper-stat" class="hud-stat" title="Balls in your cart"><div><span class="stat-label">HOPPER</span><strong><span id="hopper-count">0</span><small> / <span id="hopper-cap">100</span></small></strong><div class="hopper-track"><i id="hopper-bar"></i></div></div></div>
  </aside>

  <div id="notice" class="notice hud-surface" role="status" aria-live="polite" hidden><strong id="notice-title"></strong><span id="notice-detail" class="sr-only"></span></div>
  <div class="actions"><button id="unload" class="return-button hud-surface" hidden>Return balls <kbd>E</kbd></button><button id="shop-toggle" class="return-button shop-button hud-surface" hidden>Shop <kbd>B</kbd></button></div>
  <aside id="shop" class="shop hud-surface" aria-label="Depot shop" hidden><div class="shop-head"><span class="eyebrow">DEPOT SHOP</span><strong id="shop-cash">$0</strong><button id="shop-close" class="icon-button" aria-label="Close shop">${icon("close", 16)}</button></div><div id="shop-list"></div></aside>

  <div class="drive-pad" aria-label="Touch driving controls"><button data-drive="forward" aria-label="Drive forward">↑</button><button data-drive="left" aria-label="Steer left">←</button><button data-drive="backward" aria-label="Reverse">↓</button><button data-drive="right" aria-label="Steer right">→</button><button id="touch-brake" aria-label="Brake" title="Brake">■</button></div>

  <aside class="map-panel hud-surface" aria-label="Range map"><canvas id="minimap" width="240" height="560" aria-label="Overhead map: orange arrow is your cart, amber squares are the return depots, white dots are balls"></canvas><span class="map-north" aria-hidden="true">N ↑</span></aside>

  <dialog id="pause-overlay" class="game-menu" aria-labelledby="pause-title">
    <div class="menu-heading"><span class="eyebrow">SHIFT PAUSED</span><span id="shift-clock">00:00</span></div><h2 id="pause-title">Your shift.</h2>
    <div class="menu-stats"><div><strong id="returned-count">0</strong><span>Returned</span></div><div><strong id="delivery-count">0</strong><span>Deliveries</span></div><div><strong id="spilled-count">0</strong><span>Spilled</span></div><div><strong id="earned-count">$0</strong><span>Earned</span></div></div>
    <button id="resume" class="primary-button">Resume ${icon("play", 16)}</button>
    <div class="menu-actions"><button id="camera" class="menu-action" aria-label="Switch to overhead camera">${icon("camera", 17)}<span>Overhead camera</span></button><button id="sound" class="menu-action" aria-label="Mute sound">${icon("sound", 17)}<span>Sound on</span></button><button id="help" class="menu-action">${icon("help", 17)}<span>How to play</span></button><button id="settings" class="menu-action">${icon("settings", 17)}<span>Settings</span></button></div>
    <button id="recover" class="menu-action recover-action">${icon("reset", 16)}<span>Recover cart</span><kbd>R</kbd></button>
    <p class="menu-controls">WASD drive · Space brake · E return · B shop<br>Drag mouse to look · Scroll to zoom · C camera · Esc / P menu</p>
  </dialog>

  <div id="loading-screen" class="welcome-overlay"><section class="welcome-card"><div class="welcome-emblem">${icon("tractor", 42)}</div><span class="eyebrow">WELCOME TO PINE VALLEY</span><h2>The range runs<br>on you.</h2><p>Golfers pay for every ball they hit.<br>Start on a 100 yard range, spend the cash, and grow it to 300.</p><div class="welcome-rules"><span>${icon("bucket", 17)} Return balls to resupply the golfers.</span><span>${icon("flag", 17)} Park at the depot and press <b>B</b> to buy upgrades.</span><span>${icon("happy", 17)} Patience at zero and a golfer walks. Empty bays for <b>30s</b> ends the shift.</span><span>${icon("warning", 17)} Obstacle collision: spill <b>50%</b> of your load.</span><span>${icon("warning", 17)} Flying ball strike: spill <b>15%</b> of your load.</span></div><button id="start" class="primary-button" disabled><span id="loading-label">Preparing the range…</span>${icon("arrow", 18)}</button><div class="loading-track"><i id="loading-progress"></i></div><small id="loading-caption">Loading your Blender models</small><small id="best-score" class="best-score" hidden></small></section></div>
  <div id="gameover-screen" class="welcome-overlay" hidden><section class="welcome-card"><div class="welcome-emblem">${icon("flag", 42)}</div><span class="eyebrow">THE RANGE WENT QUIET</span><h2>Shift over.</h2><p id="gameover-summary"></p><div class="menu-stats"><div><strong id="final-earned">$0</strong><span>Earned</span></div><div><strong id="final-served">0</strong><span>Golfers served</span></div><div><strong id="final-best">$0</strong><span>Best shift</span></div></div><button id="restart" class="primary-button">Run it again ${icon("reset", 18)}</button></section></div>
  <dialog id="dialog"><button id="dialog-close" class="icon-button dialog-close" aria-label="Close dialog">${icon("close")}</button><div id="dialog-content"></div></dialog>
  <div id="error-screen" class="welcome-overlay" hidden><section class="welcome-card"><span class="eyebrow">THE RANGE COULDN’T OPEN</span><h2>Let’s try again.</h2><p id="error-message"></p><button id="reload" class="primary-button">Reload range ${icon("reset", 18)}</button></section></div>
</main>`;

const sim = new RangeManagement();
const audio = new RangeAudio();
audio.enabled = storage.get("sound", "true") !== "false";
const state = {
  ready: false,
  started: false,
  paused: false,
  wind: storage.get("wind", "breeze") === "calm" ? 0 : 1.8,
  noticeUntil: 0,
  impactUntil: 0,
  over: false,
  cashPulseUntil: 0,
};
const keys = new Set<string>(),
  touch = new Set<string>();
const dialog = $<HTMLDialogElement>("#dialog");
const incidents: {
  cause: SpillCause;
  before: number;
  lost: number;
  after: number;
  time: number;
  obstacle?: string;
}[] = [];
const errors: string[] = [];
let world: RangeScene;
let lastTime = performance.now(),
  fpsStart = lastTime,
  frames = 0,
  fps = 0,
  hudTime = 0;
window.addEventListener("error", (e) => errors.push(e.message));
window.addEventListener("unhandledrejection", (e) =>
  errors.push(String(e.reason)),
);

function showNotice(title: string, detail: string, warning = false) {
  $("#notice-title").textContent = title;
  $("#notice-detail").textContent = detail;
  $("#notice").classList.toggle("warning", warning);
  $("#notice").hidden = false;
  state.noticeUntil = performance.now() + 2400;
}

function spill(cause: SpillCause, obstacle?: string) {
  const before = sim.hopper,
    lost = sim.spill(cause);
  world.spillBalls(lost, cause);
  world.setHopper(sim.hopper);
  incidents.push({
    cause,
    before,
    lost,
    after: sim.hopper,
    time: sim.time,
    obstacle,
  });
  if (incidents.length > 20) incidents.shift();
  const percent = `${Math.round(sim.spillRate(cause) * 100)}%`;
  const reason =
    cause === "obstacle"
      ? `${obstacle ?? "Obstacle"} · −${lost} balls (${percent})`
      : `Ball strike · −${lost} balls (${percent})`;
  showNotice(
    reason,
    lost
      ? `${obstacle ? obstacle + " · " : ""}${lost} balls bounced out. Hopper ${before} → ${sim.hopper}.`
      : "Empty hopper. No balls lost.",
    true,
  );
  state.impactUntil = performance.now() + 350;
  audio.play("hit");
  updateHUD();
}

function atDepot() {
  return world.depots.some(
    (depot) =>
      Math.hypot(
        world.tractor.position.x - depot.x,
        world.tractor.position.z - (depot.z + 2),
      ) < 5,
  );
}
const money = (amount: number) => `$${Math.floor(amount)}`;
const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;

function applyUpgrades() {
  const levels = sim.levels;
  world.setRange(sim.rangeYards);
  world.applyCart({
    maxSpeed: sim.maxSpeed,
    halfWidth: sim.collectorHalfWidth,
    capacity: sim.hopperCapacity,
    collector: levels.collector,
    cage: levels.cage,
    bumper: levels.bumper,
    hopper: levels.hopper,
  });
  world.setBays(sim.bays);
  world.setNets(levels.nets);
  world.clearObstacles(levels.clearing);
  if (levels.depot) world.addSecondDepot();
  if (levels.helper) world.enableHelper();
}

function renderShop() {
  const groups: Record<UpgradeCategory, string> = {
    cart: "Cart",
    range: "Range",
    supply: "Supply",
  };
  $("#shop-list").innerHTML = (Object.keys(groups) as UpgradeCategory[])
    .map(
      (category) =>
        `<h3>${groups[category]}</h3>` +
        UPGRADES.filter((u) => u.category === category)
          .map((u) => {
            const level = sim.levels[u.id],
              price = sim.price(u.id),
              maxed = price === undefined;
            const now = u.repeat ? u.blurb : u.levels[level];
            const next = u.repeat ? "" : u.levels[level + 1];
            const tier = u.repeat ? "" : ` <em>${level}/${u.costs.length}</em>`;
            return `<div class="shop-row${maxed ? " maxed" : ""}"><div><strong>${u.name}${tier}</strong><span>${maxed ? now : next ? `${now} → ${next}` : now}</span></div><button data-buy="${u.id}" title="${u.blurb}">${maxed ? "Max" : money(price)}</button></div>`;
          })
          .join(""),
    )
    .join("");
  refreshShop();
}
function refreshShop() {
  if ($("#shop").hidden) return;
  $("#shop-cash").textContent = money(sim.cash);
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-buy]",
  )) {
    const price = sim.price(button.dataset.buy as UpgradeId);
    button.disabled = price === undefined || sim.cash < price;
  }
}
function toggleShop(open: boolean = $("#shop").hidden === true) {
  if (!state.started || state.over) return;
  if (open && !atDepot()) {
    showNotice("The shop is at the depot.", "Park beside a ball return first.");
    return;
  }
  $("#shop").hidden = !open;
  $("#shop-toggle").classList.toggle("active", open);
  if (open) renderShop();
}
function buy(id: UpgradeId) {
  const upgrade = UPGRADES.find((u) => u.id === id)!;
  const result = sim.buy(id);
  if (result === "poor") {
    showNotice("Not enough cash.", `${upgrade.name} costs ${money(sim.price(id) ?? 0)}.`);
    return;
  }
  if (result === "maxed") return;
  applyUpgrades();
  audio.play("unload");
  showNotice(
    id === "stock"
      ? `${STOCK_BUNDLE} balls added to the depot.`
      : `${upgrade.name}: ${upgrade.levels[sim.levels[id]]}.`,
    `${money(sim.cash)} left.`,
  );
  renderShop();
  updateHUD();
}
function endGame() {
  if (state.over) return;
  state.over = true;
  const best = Math.max(Number(storage.get("best", "0")), sim.earned);
  storage.set("best", String(best));
  $("#final-earned").textContent = money(sim.earned);
  $("#final-served").textContent = String(sim.served);
  $("#final-best").textContent = money(best);
  $("#gameover-summary").textContent =
    `Every bay sat empty and nobody was coming. You ran the range for ${clock(sim.time)}, served ${sim.served} golfers, and watched ${sim.walkouts} of them walk out.`;
  $("#shop").hidden = true;
  $("#gameover-screen").hidden = false;
  $(".game").classList.remove("playing");
  clearControls();
  $("#restart").focus();
}
function handleEvents(now: number) {
  for (const event of sim.takeEvents()) {
    if (event.kind === "walkout")
      showNotice(
        `${GOLFER_TYPES[event.type].name} walked out of bay ${event.golfer + 1}.`,
        "Keep the depot stocked so the rest stay.",
        true,
      );
    else if (event.kind === "arrival")
      showNotice(
        `${GOLFER_TYPES[event.type].name} took bay ${event.golfer + 1}.`,
        `${sim.present.length} golfers on the range.`,
      );
    else if (event.kind === "tip") {
      audio.play("score");
      state.cashPulseUntil = now + 600;
    } else if (event.kind === "over") endGame();
  }
}
function unload() {
  if (!state.ready || !state.started || state.paused || dialog.open) return;
  if (!atDepot()) {
    showNotice(
      "Find the ball return.",
      "Drive to the orange depot beside the hitting bays.",
    );
    return;
  }
  if (Math.abs(world.tractorSpeed) > 1) {
    showNotice(
      "Stop to unload.",
      "Hold Space or Brake, then return your balls.",
    );
    return;
  }
  if (!sim.hopper) {
    showNotice(
      "Your hopper is empty.",
      "Drive over the white balls to collect them.",
    );
    return;
  }
  const count = sim.unload();
  world.setHopper(0);
  audio.play("unload");
  showNotice(
    `${count} balls returned.`,
    `${sim.reserve} ready to hit. Your golfers are resupplied.`,
  );
  updateHUD();
}
function recover() {
  if (!state.ready || !state.started) return;
  keys.clear();
  touch.clear();
  world.recover();
  showNotice("Cart recovered", "Your load is still in the hopper.");
  if (state.paused) pause();
}

function updateHUD() {
  if (!state.ready) return;
  $("#reserve-count").textContent = String(sim.supply);
  $("#supply-stat").classList.toggle("low-supply", sim.supply <= 21);
  $("#supply-stat").setAttribute(
    "aria-label",
    `${sim.supply} balls ready to hit`,
  );
  $("#cash").textContent = money(sim.cash);
  $("#cash-stat").classList.toggle(
    "pulse",
    performance.now() < state.cashPulseUntil,
  );
  $("#satisfaction").textContent = String(sim.satisfaction);
  const mood =
    sim.satisfaction < 35
      ? "upset"
      : sim.satisfaction < 70
        ? "impatient"
        : "happy";
  $("#mood-stat").dataset.mood = mood;
  $("#mood-label").textContent = sim.waiting
    ? `${sim.waiting} WAITING`
    : "MOOD";
  $("#mood-stat").setAttribute(
    "aria-label",
    `Golfer satisfaction ${sim.satisfaction}%. ${sim.waiting} waiting for balls.`,
  );
  $("#hopper-count").textContent = String(sim.hopper);
  const capacity = sim.hopperCapacity;
  $("#hopper-cap").textContent = String(capacity);
  $("#hopper-bar").style.width = `${(sim.hopper / capacity) * 100}%`;
  $("#hopper-stat").classList.toggle("full", sim.hopper === capacity);
  $("#hopper-stat").setAttribute(
    "aria-label",
    `${sim.hopper} of ${capacity} balls in the hopper`,
  );
  const nearDepot = state.started && !state.over && atDepot();
  const canReturn = nearDepot && sim.hopper > 0;
  $("#unload").hidden = !canReturn;
  $("#shop-toggle").hidden = !nearDepot;
  if (!nearDepot && !$("#shop").hidden) toggleShop(false);
  refreshShop();
  $("#unload").innerHTML =
    Math.abs(world.tractorSpeed) > 1
      ? "Brake to return <kbd>Space</kbd>"
      : `Return ${sim.hopper} balls <kbd>E</kbd>`;
  $("#returned-count").textContent = String(sim.returned);
  $("#delivery-count").textContent = String(sim.deliveries);
  $("#spilled-count").textContent = String(sim.spilled);
  $("#earned-count").textContent = money(sim.earned);
  $("#shift-clock").textContent =
    `${String(Math.floor(sim.time / 60)).padStart(2, "0")}:${String(Math.floor(sim.time) % 60).padStart(2, "0")}`;
  drawMap();
}

function drawMap() {
  const canvas = $<HTMLCanvasElement>("#minimap"),
    w = canvas.width;
  // Same scale on both axes so the map keeps the range's real proportions,
  // and the canvas grows with the range so a short range is not mostly blank.
  const scale = (w - 28) / 114;
  const wanted = Math.round(28 + (world.rangeEnd + 6) * scale);
  if (canvas.height !== wanted) canvas.height = wanted;
  const ctx = canvas.getContext("2d")!,
    h = canvas.height;
  const map = (x: number, z: number) => ({
    x: w / 2 - x * scale,
    y: h - 14 - (z + 3) * scale,
  });
  ctx.clearRect(0, 0, w, h);
  const top = map(0, world.rangeEnd + 3).y,
    left = map(57, 0).x,
    right = map(-57, 0).x,
    bottom = map(0, -3).y;
  ctx.fillStyle = "#c3d2a9";
  ctx.beginPath();
  ctx.roundRect(left, top, right - left, bottom - top, 8);
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? "#b8c99e" : "#bfcfa5";
    ctx.fillRect(
      left + 2 + (i * (right - left - 4)) / 8,
      top + 2,
      (right - left - 4) / 8,
      bottom - top - 4,
    );
  }
  ctx.strokeStyle = "#93a784";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 5]);
  ctx.strokeRect(left + 1, top + 1, right - left - 2, bottom - top - 2);
  ctx.setLineDash([]);
  for (const target of TARGETS) {
    if (target.z >= world.rangeEnd - 18) continue;
    const p = map(target.x, target.z);
    ctx.fillStyle = "#aabf8e";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12 * YARD * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = target.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const obstacle of world.obstacles) {
    if (
      obstacle.id.includes("fence") ||
      obstacle.id === "bay-line" ||
      obstacle.id.startsWith("depot")
    )
      continue;
    ctx.fillStyle = obstacle.name === "Tree" ? "#6f8657" : "#9c8463";
    if (obstacle.kind === "circle") {
      const p = map(obstacle.x, obstacle.z);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3, obstacle.radius * scale * 1.4), 0, Math.PI * 2);
      ctx.fill();
    } else {
      const a = map(obstacle.maxX, obstacle.maxZ),
        b = map(obstacle.minX, obstacle.minZ);
      ctx.fillRect(a.x, a.y, Math.max(3, b.x - a.x), Math.max(3, b.y - a.y));
    }
  }
  // Balls: outlined white dots drawn as one path so hundreds stay cheap.
  ctx.fillStyle = "#fffef4";
  ctx.strokeStyle = "#2c4633";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const ball of world.balls)
    if (ball.active && Math.abs(ball.position.x) <= 53) {
      const p = map(ball.position.x, ball.position.z);
      ctx.moveTo(p.x + 3, p.y);
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e5b068";
  ctx.beginPath();
  for (const flight of world.airShots)
    if (flight.time >= 0) {
      const p = map(flight.point.x, flight.point.z);
      ctx.moveTo(p.x + 3.5, p.y);
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#bd7b44";
  ctx.strokeStyle = "#fbf7e6";
  ctx.lineWidth = 1.5;
  for (const depot of world.depots) {
    const p = map(depot.x, depot.z);
    ctx.fillRect(p.x - 7, p.y - 5, 14, 10);
    ctx.strokeRect(p.x - 7, p.y - 5, 14, 10);
  }
  for (const npc of world.golfers) {
    const p = map(npc.origin.x, 4);
    ctx.fillStyle = npc.status === "empty" ? "#9aa58c" : "#557749";
    ctx.fillRect(p.x - 3, p.y - 3, 6, 5);
  }
  if (world.helper) {
    const p = map(world.helper.object.position.x, world.helper.object.position.z);
    ctx.fillStyle = "#3f7f8c";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Your cart: a big outlined arrow with a soft halo so it reads at a glance.
  const cart = map(world.tractor.position.x, world.tractor.position.z);
  ctx.save();
  ctx.translate(cart.x, cart.y);
  ctx.fillStyle = "#ff9a3c40";
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(-world.tractorAngle);
  ctx.fillStyle = "#ff8f2e";
  ctx.strokeStyle = "#fffdf5";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.lineTo(-11, 11);
  ctx.lineTo(0, 5);
  ctx.lineTo(11, 11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function clearControls() {
  keys.clear();
  touch.clear();
  document.querySelectorAll(".held").forEach((e) => e.classList.remove("held"));
}
function pause() {
  if (!state.started) return;
  state.paused = !state.paused;
  clearControls();
  const menu = $<HTMLDialogElement>("#pause-overlay");
  if (state.paused) menu.showModal();
  else menu.close();
  $("#pause").setAttribute("aria-expanded", String(state.paused));
  if (state.paused) $("#resume").focus();
  else $("#pause").focus();
}

function openDialog(html: string) {
  clearControls();
  $("#dialog-content").innerHTML = html;
  dialog.showModal();
}
function closeDialog() {
  dialog.close();
  clearControls();
  lastTime = performance.now();
}
function changeCamera() {
  world.cameraMode = world.cameraMode === "chase" ? "overview" : "chase";
  $("#camera").classList.toggle("active", world.cameraMode === "overview");
  $("#camera span").textContent =
    world.cameraMode === "chase" ? "Overhead camera" : "Follow cart";
  $("#camera").setAttribute(
    "aria-label",
    world.cameraMode === "chase"
      ? "Switch to overhead camera"
      : "Switch to chase camera",
  );
}
function updateSound() {
  $("#sound").innerHTML =
    `${icon(audio.enabled ? "sound" : "mute", 17)}<span>Sound ${audio.enabled ? "on" : "off"}</span>`;
  $("#sound").setAttribute(
    "aria-label",
    audio.enabled ? "Mute sound" : "Enable sound",
  );
}
updateSound();

$("#start").addEventListener("click", () => {
  if (!state.ready) return;
  state.started = true;
  $(".game").classList.add("playing");
  $("#loading-screen").hidden = true;
  lastTime = performance.now();
  audio.unlock();
  audio.setEnabled(audio.enabled);
});
$("#unload").addEventListener("click", unload);
$("#shop-toggle").addEventListener("click", () => toggleShop());
$("#shop-close").addEventListener("click", () => toggleShop(false));
$("#shop-list").addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>("[data-buy]");
  if (button && !button.disabled) buy(button.dataset.buy as UpgradeId);
});
$("#restart").addEventListener("click", () => location.reload());
$("#recover").addEventListener("click", recover);
$("#camera").addEventListener("click", changeCamera);
$("#pause").addEventListener("click", pause);
$("#resume").addEventListener("click", pause);
$("#pause-overlay").addEventListener("cancel", (e) => {
  e.preventDefault();
  pause();
});
$("#sound").addEventListener("click", () => {
  audio.unlock();
  audio.setEnabled(!audio.enabled);
  storage.set("sound", String(audio.enabled));
  updateSound();
});
$("#help").addEventListener("click", () =>
  openDialog(
    `<span class="eyebrow">KEEP THE RANGE RUNNING</span><h2>Your shift, explained.</h2><div class="help-step"><span>01</span><div><strong>Collect and return.</strong><p><kbd>W A S D</kbd> or arrow keys drive. <kbd>Space</kbd> brakes. Drive over white balls to fill your 100-ball hopper. Stop at the orange depot and press <kbd>E</kbd> to return them.</p></div></div><div class="help-step"><span>02</span><div><strong>Keep your golfers supplied.</strong><p>Seven golfers keep hitting while the depot has balls. Empty supply stops their swings and makes them lose patience. Returning a load replenishes the supply and helps them recover.</p></div></div><div class="help-step"><span>03</span><div><strong>Protect your load.</strong><p>Hit a tree, rock, log, fence, sign, or wildlife and <b>50%</b> of your current load spills out. A flying golf ball hitting the cart spills <b>15%</b>. Losses round up to whole balls. Spilled balls bounce onto the range for you to collect again.</p></div></div><div class="help-step"><span>04</span><div><strong>Earn and upgrade.</strong><p>Every ball a golfer hits pays you, and happy golfers tip. Park at the depot and press <kbd>B</kbd> for the shop: engine, hopper, collector width, cage, bumper, range length, more bays, bay dispensers, a second depot, obstacle clearing, nets, or a driverless helper cart. The range starts at 100 yards with slow, patient hitters. Each extra 50 yards speeds the golfers up, reveals more hazards, and from 200 yards brings grinders, from 250 pros. Golfers whose patience hits zero walk out, and how happy the rest are decides who shows up next. If every bay sits empty for 30 seconds, the shift is over and your earnings are the score.</p></div></div><div class="help-step"><span>05</span><div><strong>Find your way.</strong><p>The map stays in the bottom right. Drag with the mouse to look around the cart and scroll to zoom. <kbd>C</kbd> changes camera, <kbd>Esc</kbd> or <kbd>P</kbd> opens the menu, and <kbd>R</kbd> recovers your cart. Touch arrows and the square brake button are available on smaller screens.</p></div></div><button data-action="close" class="primary-button">Back to menu ${icon("arrow", 18)}</button>`,
  ),
);
$("#settings").addEventListener("click", () =>
  openDialog(
    `<span class="eyebrow">MAKE YOURSELF AT HOME</span><h2>Range settings.</h2><div class="setting-row"><div><label for="wind-setting">Wind</label><span>Changes the golfers’ ball flight.</span></div><select id="wind-setting"><option value="breeze" ${state.wind ? "selected" : ""}>Light breeze</option><option value="calm" ${!state.wind ? "selected" : ""}>Calm</option></select></div><div class="setting-row"><div><label for="quality-setting">Graphics</label><span>Lower detail for a smoother shift.</span></div><select id="quality-setting"><option value="high" ${world.quality === "high" ? "selected" : ""}>High</option><option value="low" ${world.quality === "low" ? "selected" : ""}>Low</option></select></div><div class="setting-row"><div><strong>Sound</strong><span>Quiet ambience and collision feedback.</span></div><button data-action="sound" class="setting-toggle">${audio.enabled ? "On" : "Off"}</button></div><p class="settings-note">The simulation pauses while this window is open. Preferences are saved on this device.</p><button data-action="close" class="primary-button">Done ${icon("check", 18)}</button>`,
  ),
);
$("#dialog-close").addEventListener("click", closeDialog);
dialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDialog();
});
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeDialog();
  }
});
$("#dialog-content").addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>(
    "[data-action]",
  );
  if (button?.dataset.action === "close") closeDialog();
  if (button?.dataset.action === "sound") {
    $("#sound").click();
    button.textContent = audio.enabled ? "On" : "Off";
  }
});
$("#dialog-content").addEventListener("change", (e) => {
  const input = e.target as HTMLSelectElement;
  if (input.id === "wind-setting") {
    state.wind = input.value === "calm" ? 0 : 1.8;
    storage.set("wind", input.value);
  }
  if (input.id === "quality-setting") {
    world.setQuality(input.value as "high" | "low");
    storage.set("quality", input.value);
  }
});
$("#reload").addEventListener("click", () => location.reload());

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-drive],#touch-brake",
)) {
  const direction = button.dataset.drive ?? "brake";
  button.addEventListener("pointerdown", (e) => {
    if (!state.started || state.paused || dialog.open) return;
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    touch.add(direction);
    button.classList.add("held");
  });
  const release = () => {
    touch.delete(direction);
    button.classList.remove("held");
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
}
window.addEventListener("keydown", (e) => {
  if (!state.started || dialog.open || e.ctrlKey || e.metaKey || e.altKey)
    return;
  if (
    e.target instanceof HTMLElement &&
    e.target.matches("input,select,textarea")
  )
    return;
  const key = e.key.toLowerCase();
  if ((key === "p" || key === "escape") && !e.repeat) {
    e.preventDefault();
    pause();
    return;
  }
  if (state.paused) return;
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key))
    e.preventDefault();
  keys.add(key);
  if (key === "e" && !e.repeat) unload();
  if (key === "r" && !e.repeat) recover();
  if (key === "c" && !e.repeat) changeCamera();
  if (key === "b" && !e.repeat) toggleShop();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
// Mouse look: drag on the range to orbit the camera, scroll to zoom.
const range = $<HTMLCanvasElement>("#range");
range.addEventListener("pointerdown", (e) => {
  if (!state.started || state.paused || e.button > 2) return;
  range.setPointerCapture(e.pointerId);
  world.looking = true;
});
range.addEventListener("pointermove", (e) => {
  if (!world.looking || !state.started) return;
  world.orbit(e.movementX, e.movementY);
});
const stopLooking = () => {
  if (world) world.looking = false;
};
range.addEventListener("pointerup", stopLooking);
range.addEventListener("pointercancel", stopLooking);
range.addEventListener("lostpointercapture", stopLooking);
range.addEventListener("contextmenu", (e) => e.preventDefault());
range.addEventListener(
  "wheel",
  (e) => {
    if (!state.started) return;
    e.preventDefault();
    world.zoomBy(e.deltaY);
  },
  { passive: false },
);
window.addEventListener("blur", clearControls);
document.addEventListener("visibilitychange", () => {
  clearControls();
  lastTime = performance.now();
});
window.addEventListener("resize", () => world?.resize());

function animate(now: number) {
  if (now - lastTime < 1000 / 75) return;
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  if (!state.ready) {
    world.renderer.render(world.scene, world.camera);
    return;
  }
  const running =
    state.started &&
    !state.over &&
    !state.paused &&
    !dialog.open &&
    !document.hidden;
  if (running) {
    const forward =
      (keys.has("w") || keys.has("arrowup") || touch.has("forward") ? 1 : 0) -
      (keys.has("s") || keys.has("arrowdown") || touch.has("backward") ? 1 : 0);
    const steer =
      (keys.has("d") || keys.has("arrowright") || touch.has("right") ? 1 : 0) -
      (keys.has("a") || keys.has("arrowleft") || touch.has("left") ? 1 : 0);
    const drive = world.drive(
      dt,
      forward,
      steer,
      keys.has(" ") || touch.has("brake"),
      sim.hopper,
    );
    if (drive.collected) {
      sim.collect(drive.collected);
      world.setHopper(sim.hopper);
      audio.play("pickup");
    }
    if (drive.collision) spill("obstacle", drive.collision.name);
    for (const order of sim.update(dt))
      world.launchGolferShot(order, state.wind);
    const hits = world.updateFlights(dt);
    for (let i = 0; i < hits; i++) spill("ball");
    const helperBalls = world.updateHelper(dt);
    if (helperBalls) {
      sim.deliverHelper(helperBalls);
      showNotice(
        `Helper cart returned ${helperBalls} balls.`,
        `${sim.supply} balls ready to hit.`,
      );
    }
    world.syncGolfers(sim.golfers);
    handleEvents(now);
  }
  world.update(running ? dt : 0);
  if (now - state.noticeUntil > 0) $("#notice").hidden = true;
  $(".game").classList.toggle("impact", now < state.impactUntil);
  if (now - hudTime > 100) {
    updateHUD();
    hudTime = now;
  }
  frames++;
  if (now - fpsStart > 1000) {
    fps = Math.round((frames * 1000) / (now - fpsStart));
    frames = 0;
    fpsStart = now;
  }
}

async function init() {
  try {
    world = new RangeScene($<HTMLCanvasElement>("#range"));
    world.renderer.setAnimationLoop(animate);
    await world.load((loaded, total) => {
      $("#loading-progress").style.width = `${(loaded / total) * 100}%`;
      $("#loading-caption").textContent = `${loaded} of ${total} models ready`;
    });
    state.ready = true;
    world.setQuality(storage.get("quality", "high") === "low" ? "low" : "high");
    applyUpgrades();
    world.syncGolfers(sim.golfers);
    const best = Number(storage.get("best", "0"));
    if (best > 0) {
      $("#best-score").textContent = `Best shift so far: ${money(best)}`;
      $("#best-score").hidden = false;
    }
    updateHUD();
    $("#loading-label").textContent = "Start your shift";
    $("#loading-caption").textContent =
      "WASD to drive · Space to brake · E to return";
    $<HTMLButtonElement>("#start").disabled = false;
    Object.defineProperty(window, "rangeSimulator", {
      value: {
        sim,
        world,
        buy,
        applyUpgrades,
        snapshot: () => ({
          ready: state.ready,
          started: state.started,
          paused: state.paused,
          mode: "collector",
          time: sim.time,
          reserve: sim.reserve,
          hopper: sim.hopper,
          returned: sim.returned,
          collected: sim.collected,
          spilled: sim.spilled,
          deliveries: sim.deliveries,
          ballsHit: sim.ballsHit,
          satisfaction: sim.satisfaction,
          cash: sim.cash,
          earned: sim.earned,
          reputation: sim.reputation,
          levels: { ...sim.levels },
          walkouts: sim.walkouts,
          arrivals: sim.arrivals,
          over: sim.over,
          waiting: sim.waiting,
          golfers: sim.golfers.map((g) => ({ ...g })),
          fieldBalls: world.balls.filter((b) => b.active).length,
          airborne: world.airShots.length,
          bouncing: world.bouncingBalls.length,
          ballBalance:
            sim.reserve +
            sim.hopper +
            world.balls.filter((b) => b.active).length +
            world.airShots.length +
            world.bouncingBalls.length,
          tractor: {
            x: world.tractor.position.x,
            z: world.tractor.position.z,
            angle: world.tractorAngle,
            speed: world.tractorSpeed,
          },
          incidents: incidents.slice(),
          obstacleHits: sim.obstacleHits,
          ballHits: sim.ballHits,
          assetsLoaded: world.loaded,
          camera: world.cameraMode,
          wind: state.wind,
          fps,
          errors: errors.slice(),
          map: $(".map-panel").getBoundingClientRect().toJSON(),
        }),
      },
      configurable: true,
    });
  } catch (error) {
    console.error(error);
    $("#loading-screen").hidden = true;
    $("#error-screen").hidden = false;
    $("#error-message").textContent =
      error instanceof Error && /WebGL/i.test(error.message)
        ? "Enable WebGL 2 and hardware acceleration in your browser, then reload."
        : "A model or the renderer could not load. Reload to try again.";
  }
}
void init();
