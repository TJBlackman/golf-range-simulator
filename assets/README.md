# Golf Range Simulator asset kit

16 original stylized low-poly assets created in the open Blender 5.2.2 LTS application through Windows computer use. Editable source, standalone GLB files, and rendered previews are included. This is the asset milestone; game logic comes next.

## Files

- `blender/golf-range-assets.blend`: editable models, a scene per asset, original default scene, and an asset showroom. Opens in the showroom.
- `blender/build_assets.py`: reproducible Blender generator. Open in Blender's Text Editor and click Run Script. Run in a fresh document to avoid duplicate asset scenes. It preserves pre-existing scenes.
- `blender/finalize_exports.py`: re-export the named asset scenes after editing the saved kit. Open and run in Blender's Text Editor with the kit loaded.
- `models/*.glb`: one asset per file, embedded geometry and solid-color PBR materials. No external textures.
- `manifest.json`: descriptions, dimensions, mesh counts, triangle counts, byte sizes, and animation names.
- `previews/`: Blender renders of the collection, tractor, and wildlife.
- `viewer.html`: Babylon.js asset inspection utility with orbit, zoom, animation playback, and wireframe controls. Loads Babylon.js from its official CDN, requiring internet access.
- `validation.json`: Khronos glTF Validator results and export isolation checks.
- `browser-validation.json`: Babylon.js WebGL 2 loading and animation checks.

## Assets

| Asset | Purpose | Animation |
| --- | --- | --- |
| tractor-picker | Orange tractor, canopy, open hopper, wide disk collector | Separate pivots for runtime wheel/steering/collector movement |
| golf-ball | Regulation-size ball for instancing | None |
| target-flag | Red target flag, pole, cup | None |
| distance-marker-50 / 100 / 150 | Three freestanding yardage signs | None |
| ball-depot | Ball storage, receiving chute, canopy, unloading pad | None |
| hitting-bay | Modular covered bay, mat, dispenser, tray | None |
| golfer | Cap, polo, trousers, golf club | PracticeSwing |
| goose | Canada goose, cheek patches, webbed feet | Walk |
| fox | Red fox, pointed ears, white-tipped tail | Walk |
| deer | Antlered deer, chest patch, hooves | Walk |
| tree-pine / tree-broadleaf | Two repeatable background trees | None |
| fence-section | Three-metre boundary fence module | None |
| range-ground | 60 × 90 metre flat range, mowing strips, target greens | None |

## Integration conventions

- Units: metres. Blender uses Z up and -Y forward. GLB uses Y up and +Z forward. This forward convention was checked against the loaded tractor's front bumper in Babylon.js.
- Each file has one named asset root at the origin and an `asset` property in glTF extras.
- Tractor pivots: `Front_L_Steer`, `Front_R_Steer`, `Rear_L_Steer`, `Rear_R_Steer`; child `*_Wheel` nodes rotate about their local X axis. Steering pivots rotate about local Blender Z / exported Y. `CollectorRoller` also rotates about local X.
- `HopperFillAnchor` marks the interior basket floor. Basket is empty; add instanced balls according to game load.
- `CollectionZone` marks the pickup swath and carries a 2.85 metre width hint.
- Depot anchors: `UnloadZone` with a 3.7 × 2.8 metre size hint, and `BallReturnAnchor` at the chute.
- `BallLaunchAnchor` in each hitting bay marks the tee.
- Wildlife and golfer animations are simple transform hierarchies, not skeletal skinning. Loops last two seconds at 24 FPS in Blender and are baked to GLB animation channels. Additional idle/landing/startle clips can be added later.
- Game colliders, physics, movement, ball inventory, wildlife behavior, and visibility-based optimization are runtime work. The GLBs contain visual geometry and placement hints.
- The source preserves separate mesh parts for editing. The tractor has 130 mesh parts and 10,532 triangles; merge static meshes by material during runtime integration if profiling calls for fewer draw calls. Instance repeated golf balls, trees, and props.

## Inspect in a browser

From this `assets` folder:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/viewer.html`. This utility previews assets only.

## Validate exports

```powershell
cd tools
npm ci
npm run validate
```

All 16 exported GLBs passed the Khronos validator with zero errors and warnings. Checks also confirm a single asset scene/root, embedded buffers, expected mesh counts, and the expected animation presence. All 16 were loaded in Babylon.js 9.29.0 using WebGL 2; all four animation clips produced changing poses.
