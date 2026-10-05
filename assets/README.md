# Golf Range Simulator assets

Sixteen original naturalistic PBR assets replace the previous low-poly kit, with an additional two-seat resort golf cart for visitors. Smooth manufactured surfaces, natural body proportions, organic branching, cutout foliage, timber and steel architecture, and embedded surface textures are used throughout. These are procedurally authored game models, not photographic scans or photorealistic character assets.

## Source and exports

- `blender/build_realistic_assets.py`: current reproducible Blender 5.2 generator; creates all models, textures, animations, exports and rendered previews from a fresh Blender document.
- `blender/golf-range-assets.blend`: current editable source with one scene per asset and a lit collection showroom.
- `blender/build_assets.py`: preserved original low-poly generator. Running it replaces current exports with the original visual style.
- `blender/finalize_exports.py`: re-export utility for manually edited scenes.
- `models/*.glb`: seventeen independent assets with embedded textures and geometry.
- `code/golf-cart.ts`: packaged copy of the runtime cart builder, with `tools/export-golf-cart.mjs` for independent GLB export.
- `textures/*.png`: original procedural wood grain, bark, concrete, turf, fur, oak leaves, pine needles and golf-ball dimple normal map; also embedded in the GLBs.
- `manifest.json`: descriptions, bounds, geometry and material counts, sizes and animation names.
- `validation.json`: Khronos glTF Validator results and runtime compatibility checks.
- `previews/`: Blender renders of the complete kit, detailed tractor and wildlife, plus `golfer-swing.png` with six swing poses and its individual source frames.
- `viewer.html`: independent Babylon.js asset inspection utility.

## Rebuild

From the repository root with Blender 5.2 installed:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python assets/blender/build_realistic_assets.py
node --experimental-strip-types assets/tools/export-golf-cart.mjs
node assets/tools/validate.mjs
```

The generator writes the current `.blend`, all sixteen core `.glb` files, PNG textures, manifest, collection/tractor/wildlife renders and the six-pose golfer swing contact sheet. It uses Blender's bundled Python and NumPy, without external assets or other modeling dependencies. Install the validator dependency with `npm ci` in `assets/tools` if needed.

To update only the golfer and right-handed hitting bay in the existing kit:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background assets/blender/golf-range-assets.blend --python assets/blender/build_realistic_assets.py -- --update-golfer
node assets/tools/validate.mjs
```

## Asset details

| Asset | Current design | Animation |
| --- | --- | --- |
| tractor-picker | Orange commercial machine, curved hood, grille, lights, tyre tread, cockpit controls, steel mesh hopper and disk collector | Runtime wheel, steering and collector pivots |
| golf-cart | Rounded two-seat resort cart, open cabin, roof, windscreen, seated driver, lights and rear golf bags | Runtime arrival, boarding, wheel rotation and departure |
| golf-ball | Regulation 42.67 mm white ball with dimple normal map | None |
| target-flag | Wind-formed textile, slim fibreglass pole and lined cup | Runtime flag motion |
| distance-marker-50 / 100 / 150 | Aluminium signs, recessed faces, timber supports and fasteners | None |
| ball-depot | Timber framing, standing seam roof, stainless receiving chute and concrete apron | None |
| hitting-bay | Timber and steel architecture, roof seams, partition flutes, mat, dispenser and tray | None |
| golfer | Athletic right-handed stance, fitted knit polo, articulated arms, torso and hip turn, wrist release, face/cap details and steel iron | Three-second PracticeSwing |
| goose | Curved neck, cheek patches, layered feather detail and webbed feet | Walk |
| fox | Tapered muzzle, cream bib, dark stockings and brush tail | Walk |
| deer | Long slender legs, tapered head, branching antlers and pale markings | Walk |
| tree-pine / tree-broadleaf | Irregular branching with masked needle / leaf sprays | None |
| fence-section | Weathered timber rails, post caps and steel bolts | None |
| range-ground | Flat 60 x 90 metre module, mowing bands and target greens | None |

## Runtime contracts and optimization

Units are metres. Blender uses Z up and -Y forward; GLB uses Y up and +Z forward. Each GLB has one asset root at the origin with an `asset` identifier in extras.

- Tractor: `Front_L_Steer`, `Front_R_Steer`, `Rear_L_Steer`, `Rear_R_Steer`; each owns its corresponding `*_Wheel`. Wheels rotate around local X, steering around exported Y. `CollectorRoller` rotates around local X. `HopperFillAnchor` retains its original interior placement. `CollectionZone` carries the 2.85 metre pickup width hint.
- Depot: `UnloadZone` carries a 3.7 x 2.8 metre size hint; `BallReturnAnchor` marks the chute.
- Bay: `BallLaunchAnchor` and `Tee` are at Blender X=-0.46, with `HittingStrip` at X=-0.48, placing the tee on the left of the mat for the right-handed stance.
- Golfer: `Torso`, `LeftUpperArm` and `RightUpperArm` remain named meshes for runtime shirt recoloring.
- Range: `Ground` and `MowingStrip` remain named for runtime turf materials. `Flag` remains a named mesh for runtime motion and target colors.
- Golf ball: one mesh at regulation size, compatible with runtime instancing.
- Wildlife: transform-hierarchy animation, two-second source loops at 24 FPS, with one exported `Walk` clip each.
- Golfer: one three-second `PracticeSwing` clip at 24 FPS, exported with zero-based time inputs from 0 to 3 seconds. Frame 35 is exact impact, at 34/24 = 1.4166667 seconds. The club head center at address and impact is GLB `(0, 0.139130435, 0.71)`; at runtime body Y=0.18 and scale 1.15 this aligns to the tee height of 0.34 metres. The model faces local +Z; local +X is the target direction, with the backswing toward -X and follow-through toward +X. Hands rise beside the rear shoulder/ear on the backswing and lead shoulder/ear on the finish, with the club wrapping across the back of the shoulders. Independent arm joints, torso and hip turn, wrist release and trail heel rise are baked into the clip.
- Golfer walking pivots: `LeftHip`, `RightHip`, `LeftKnee`, `RightKnee`, `LeftShoulder`, `RightShoulder`, plus `ClubRig`. Hip X rest rotation is -0.14 radians and knee X rest rotation +0.25 radians; apply gait relative to these poses while the swing clip is paused. Left is the lead side at local +X.

Static meshes are merged by material within each parent. Trees use two meshes/material groups each and fewer than 4,000 source triangles. Pine needle cards use dense overlapping branchlet sprays to preserve coverage at landscape distances. The tractor has 37 material-group meshes rather than the original 130 separate parts; wheel and collector pivots remain independent. Roughness and metalness vary across paint, rubber, fabric, wood, glass and steel.

GLBs contain visual geometry and placement hints. Physics, colliders, inventory, wildlife behavior and dynamic instancing are runtime responsibilities. `browser-validation.json` records the historical Babylon.js inspection milestone; current playable-game verification is recorded separately.

## Inspect assets separately

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory assets
```

Open `http://127.0.0.1:8765/viewer.html`. This asset utility uses Babylon.js from its official CDN; the playable game uses the repository's application build.
