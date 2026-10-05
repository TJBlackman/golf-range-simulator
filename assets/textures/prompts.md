# Generated environment assets

## Alpine panorama

- File: `alpine-panorama.png`
- Dimensions: 2172 × 724 pixels
- Generator: built-in ImageGen
- Purpose: photographic mountain and pine forest vista for the distant range backdrop.
- Source artifact: `C:/Users/Trevor/.codex/generated_images/01a10941-d81c-7a13-9004-7f95e971910d/exec-59a6f7d9-52c6-44d6-8df1-5ad38a5921b6.png`

### Final prompt

```text
Use case: photorealistic-natural
Asset type: panoramic photographic distant environment texture for a realistic 3D golf driving range, to wrap on a very distant cylindrical backdrop.
Primary request: Create a gorgeous, convincing real photograph of the Colorado Front Range foothills, distant evergreen pine forest ridgelines, and rugged Rocky Mountain peaks under a pale atmospheric blue sky. Extremely wide panoramic framing, ideally 3:1 aspect ratio.
Style/medium: Professional outdoor landscape photography, detailed natural texture, believable atmospheric perspective, no stylization.
Composition/framing: Uninterrupted wide vista at eye level; forested horizon around the lower third of the image, sky occupying the upper two thirds. Low rolling pine forest ridges along the bottom edge; distant rugged mountains above them. Keep the left and right edge horizon, sky colors and forest heights consistent so the image can wrap around the view without an obvious edge. No nearby foreground objects or dominant framing trees.
Lighting/mood: Clear late afternoon in early autumn, soft warm sunlight from the right, gentle atmospheric haze on distant peaks, pale blue sky with subtle delicate thin clouds; serene premium golf course setting, naturally subdued evergreen and warm earth palette.
Materials/textures: Real evergreen canopy texture, layered blue-gray distant mountain rock, fine cloud wisps, soft distant detail.
Constraints: The horizon must stay in the lower third. Distant scenery only. No buildings, people, equipment, flagpoles, golf balls, fences, roads, text, signs, logos or watermark. No foreground landscape that competes with a 3D golf course. No low-poly geometry, illustration, cartoon, oversaturated fantasy lighting or stylized rendering.
```

## Reproducible procedural surfaces

Surface assets are generated from seeded, periodic multi-scale noise and fine surface primitives by `assets/tools/generate_surfaces.py` using Pillow. These are code-native material textures, generated independently of the photographic panorama.

Run `python assets/tools/generate_surfaces.py` to rebuild all five 1024 × 1024 RGB albedo maps and their matching grayscale bump maps:

- `grass-albedo.png`, `grass-bump.png`: short dense natural turf fibers, subdued olive green.
- `gravel-albedo.png`, `gravel-bump.png`: fine warm gray aggregate with shallow irregular stone relief.
- `rock-albedo.png`, `rock-bump.png`: mottled granite, mineral speckles, and fine weathered fissures.
- `bark-albedo.png`, `bark-bump.png`: dark brown vertical bark grain and coarse fissures.
- `sand-albedo.png`, `sand-bump.png`: fine beige grains with low sandy surface variation.

Preview contact sheet: `assets/previews/surface-materials.jpg`.

Matching `.webp` copies are exported for browser loading. Albedo quality is 92; grayscale bump quality is 95, both using encoder method 6. PNGs remain the full-quality source exports. The photographic panorama remains unchanged as PNG.
