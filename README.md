# Pine Valley — Golf Range Ball Collector

A playable 3D range management game built with TypeScript, Three.js, and Vite. Its naturalistic visual kit includes 16 original Blender models and a resort golf cart, textured turf and stone, organic foliage, detailed industrial equipment, and a photographic mountain backdrop.

## Play locally

Requires Node.js 22.12+ or 24+ and a browser with WebGL 2 and hardware acceleration.

```powershell
npm install
npm run dev
```

Open **http://localhost:5178** and click **Start your shift**. Port 5178 avoids the other development server already using 5173 on this machine.

## Your shift

The range opens at 100 yards and can be bought out to 300, with a target green and flag every 50 yards up to 50 short of the back fence. Seven autonomous golfers drive in one cart at a time over the first fifteen seconds or so, walk to their bays, and then repeatedly hit balls from a shared depot. Each golfer, including every new arrival, has a 10% chance of being left-handed and sets up on the far side of the tee with a mirrored swing. The range starts with 50 balls in reserve and 200 scattered on the field. Drive the orange picker over loose balls, then stop at the return depot in the corner beside the bays and unload. Your hopper holds 75 balls and can be upgraded to 100, 125, and 150. A full hopper lights the roof beacon and rotates its amber beam. Returning a completely full hopper pays a $5 bonus. Sand traps slow carts by 30% until they leave the sand.

The supply is finite: collecting does not resupply the golfers until you return your load. Golfers hit at their normal pace with 50 balls available, speed up as supply rises (up to twice as fast at 100 balls), and slow down as supply falls (up to 50% longer between shots). Available supply includes bay dispenser buffers. When the depot runs empty, golfers stop swinging and lose patience. Deliveries restart their swings and help restore satisfaction.

## Economy

- Golfers pay for every ball they hit. Casual, family, grinder, and pro golfers pay different rates, hit at different speeds, and run out of patience at different speeds. Ten uninterrupted shots from a happy golfer earns a tip.
- Mood emojis follow each golfer: 😊 happy, 😴 waiting for balls, 😠 mad, and 🤬 furious and about to leave. The furious emoji pulses when patience reaches 15% or less. Delivering balls helps them recover.
- Patience at zero means the golfer walks back to their golf cart, boards, reverses into the access lane, and drives away. Once they leave, their bay shows a **COOL DOWN** countdown and cannot accept another golfer for 15 seconds. A slower arrival queue can keep it empty longer. New golfers arrive seated in a golf cart, park behind their bay, and walk to the mat before hitting. How happy the remaining golfers are decides how fast empty bays refill and which types show up. Pros only come to a well run range.
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

The corner menu pauses play and contains shift totals, saved games, camera, sound, help, settings, and cart recovery. Settings include wind, graphics quality, and sound. Preferences stay on this device.

Pause automatically saves the current shift. Autosave also runs every 30 seconds, when the tab is hidden, and on page exit. Reloading offers **Continue saved shift**, **Start a new shift**, and **Load a named save**. In the pause menu, **Save & load games** creates named saves and provides load, overwrite, and delete controls. Loading resumes at a paused menu. Cash, upgrades, inventory, golfers, visitor carts, wildlife, obstacles, and balls in flight are preserved; time does not advance while the game is closed. Saves stay in this browser on this device.

## Build and verify

```powershell
npm test
npm run build
npm run preview
```

The production build type-checks the code and produces `dist/`, ready to serve as a static site. Fonts, models, texture maps, the landscape panorama, and the rendering engine are bundled locally. Editable Blender source and asset inspection utilities live in `assets/` and are excluded from the production bundle.

## Visual assets

The refreshed kit uses rounded manufactured surfaces, treaded tyres, a wire hopper, metal and timber architecture, adult character proportions, cutout foliage, and distinct PBR materials. The runtime preserves their roughness and metalness. World-space grass textures keep their scale as the range expands; target greens have organic outlines and sand surrounds. Wind moves flags, leaves, and verge grass. High graphics quality enables shadows and verge grass; Low reduces the rendering cost.

- `assets/models/` — the 16 replacement GLBs and exported resort golf cart, with embedded material textures and runtime animation/anchor contracts.
- `assets/blender/build_realistic_assets.py` — reproducible current model generator; `build_assets.py` retains the earlier stylized source.
- `assets/blender/golf-range-assets.blend` — current editable kit and showroom.
- `assets/textures/` — exported PNG source maps, browser WebP maps, photographic panorama, and its saved ImageGen prompt.
- `assets/tools/generate_surfaces.py` — seeded surface generator (requires Pillow).
- `assets/previews/` — rebuilt model renders and surface previews.
- `assets/VISUAL-UPGRADE.md` — visual assessment, delivered changes, and practical limits.

Regenerate the 16 Blender models with `blender --background --factory-startup --python assets/blender/build_realistic_assets.py`, then the resort cart with `node --experimental-strip-types assets/tools/export-golf-cart.mjs`. Regenerate surfaces with `python assets/tools/generate_surfaces.py`, then validate all 17 GLBs with `npm --prefix assets/tools run validate`.

Run `python assets/tools/pack.py` to export the complete visual kit to `exports/pine-valley-visual-assets.zip`, excluding dependencies and temporary Blender backups.

Tests cover finite supply, golfer frustration and recovery, delivery accounting, hopper capacity, exact spill percentages, solid obstacle resolution, swept airborne ball collisions, and deterministic shot flight. Browser checks cover collecting and returning balls, model animations, pausing, graphics and wind settings, range upgrades, both cameras, and responsive controls and map placement. The current report is `assets/game-validation.json`.

## Project layout

- `src/main.ts` — game loop, controls, resource interface, and minimap
- `src/management.ts` — finite supply, deliveries, spills, and golfer patience
- `src/collisions.ts` — solid obstacles and airborne ball strikes
- `src/scene.ts` — Blender assets, range layout, golfers, flying and spilled balls, cart, and cameras
- `src/environment.ts` — landscape, material maps, reflections, grass, foliage and flag wind
- `src/golf-cart.ts` — authored resort carts and seated drivers
- `src/saves.ts` — versioned browser save slots
- `src/world-state.ts` — validation for complete scene saves
- `src/physics.ts` — golfer shot flight, bounce, and roll
- `src/audio.ts` — ambience and sound effects
- `src/style.css` — responsive collector interface
- `src/dialogs.css` — welcome, help, and settings dialogs
- `assets/models/` — naturalistic GLB assets
- `assets/blender/` — editable Blender source and generation scripts

The inspection utility remains available at `/assets/viewer.html` during development; see `assets/README.md` for asset conventions and validation tools.
