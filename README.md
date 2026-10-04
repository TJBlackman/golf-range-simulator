# Fairway — Golf Range Ball Collector

A playable 3D range management game built with TypeScript, Three.js, and Vite, using the original Blender assets in this project.

## Play locally

Requires Node.js 22.12+ or 24+ and a browser with WebGL 2 and hardware acceleration.

```powershell
npm install
npm run dev
```

Open **http://localhost:5178** and click **Start your shift**. Port 5178 avoids the other development server already using 5173 on this machine.

## Your shift

The range opens at 100 yards and can be bought out to 300, with a target green and flag every 50 yards up to 50 short of the back fence. Seven autonomous golfers repeatedly hit balls from a shared depot. The range starts with 84 balls in reserve and 200 scattered on the field. Drive the orange picker over loose balls, then stop at the return depot in the corner beside the bays and unload. Your hopper holds 100 balls.

The supply is finite: collecting does not resupply the golfers until you return your load. When the depot runs empty, golfers stop swinging and lose patience. Deliveries restart their swings and help restore satisfaction.

## Economy

- Golfers pay for every ball they hit. Casual, family, grinder, and pro golfers pay different rates, hit at different speeds, and run out of patience at different speeds. Ten uninterrupted shots from a happy golfer earns a tip.
- Patience at zero means the golfer walks out and a car pulls away behind the bays. How happy the remaining golfers are decides how fast empty bays refill and which types show up. Pros only come to a well run range.
- A small share of shots are sliced over the fence and lost for good. Nets cut that share.
- Range length is the pacing lever. At 100 yards golfers hit at half speed and the cart is slow, which leaves time to learn. Each 50 yard tier speeds the golfers up, reveals more hazards, and opens the door to grinders at 200 yards and pros at 250.
- Park at a depot and press **B** for the shop. Cart upgrades: engine, hopper, collector width, cage, bumper. Range upgrades: more bays (up to 12), bay dispensers, a second depot, obstacle clearing, nets, and a driverless helper cart. Fresh balls can be bought at any time.
- When every bay is empty and the range is in too poor a state for anyone to arrive, a 30 second clock runs. When it hits zero the shift is over and lifetime earnings are the score. The best shift is kept on the device.

- Colliding with an obstacle spills **50%** of your current load.
- A flying golf ball striking the cart spills **15%**.
- Losses round up to whole balls. Spilled balls visibly bounce onto the field and remain collectible.
- Trees, rocks, fallen logs, fences, signs, bay buildings, the depot, and wildlife are obstacles. Sustained contact causes one spill; moving away and hitting again causes another.
- The range map stays in the **bottom right** and shows the cart, loose balls, flying shots, obstacles, and return depot.

## Controls

| Action                         | Control                                               |
| ------------------------------ | ----------------------------------------------------- |
| Drive / steer                  | **W A S D**, arrow keys, or touch arrows              |
| Brake                          | **Space** or the square touch button                 |
| Return balls                   | Stop beside the depot, then **E** or **Return balls** |
| Open the shop                  | Stop beside a depot, then **B** or **Shop**           |
| Recover cart, keeping the load | **R** or **Recover**                                  |
| Look around / zoom             | Drag with the mouse, scroll wheel to zoom              |
| Switch chase / overhead camera | **C** or the camera option in the menu                |
| Open menu / resume             | **Esc**, **P**, or the corner menu button             |

The range fills the browser viewport. During play, a compact strip shows supply, golfer mood, and hopper count, with a small map in the bottom right. The return button appears only beside the depot with a load to return. Collision and delivery feedback appears briefly.

The corner menu pauses play and contains shift totals, camera, sound, help, settings, and cart recovery. Settings include wind, graphics quality, and sound. Preferences stay on this device. Reloading starts a fresh shift.

## Build and verify

```powershell
npm test
npm run build
npm run preview
```

The production build type-checks the code and produces `dist/`, ready to serve as a static site. Fonts, models, and the rendering engine are bundled locally. The original `.blend` source and asset inspection utilities are preserved in `assets/` and excluded from the production bundle.

Tests cover finite supply, golfer frustration and recovery, delivery accounting, hopper capacity, exact spill percentages, solid obstacle resolution, swept airborne ball collisions, and deterministic shot flight. Browser checks cover collecting, spills, returning balls, pausing, and responsive map placement.

## Project layout

- `src/main.ts` — game loop, controls, resource interface, and minimap
- `src/management.ts` — finite supply, deliveries, spills, and golfer patience
- `src/collisions.ts` — solid obstacles and airborne ball strikes
- `src/scene.ts` — Blender assets, landscape, golfers, flying and spilled balls, cart, and cameras
- `src/physics.ts` — golfer shot flight, bounce, and roll
- `src/audio.ts` — ambience and sound effects
- `src/style.css` — responsive collector interface
- `src/dialogs.css` — welcome, help, and settings dialogs
- `assets/models/` — original GLB assets
- `assets/blender/` — editable Blender source and generation scripts

The inspection utility remains available at `/assets/viewer.html` during development; see `assets/README.md` for asset conventions and validation tools.
