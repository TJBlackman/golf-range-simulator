"""Rebuild seamless, deterministic 1024px range materials with Pillow.

Run: python assets/tools/generate_surfaces.py
Requires: Pillow. Each albedo has a matching grayscale height/bump map.
"""

from pathlib import Path
import math
import random
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

SIZE = 1024
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "textures"
PREVIEW = ROOT / "assets" / "previews"


def periodic_noise(rng, cells):
    """Resample a repeated random lattice, retaining periodic interpolation."""
    source = Image.frombytes("L", (cells, cells), rng.randbytes(cells * cells))
    tiled = Image.new("L", (cells * 3, cells * 3))
    for y in range(3):
        for x in range(3):
            tiled.paste(source, (x * cells, y * cells))
    tiled = tiled.resize((SIZE * 3, SIZE * 3), Image.Resampling.BICUBIC)
    return tiled.crop((SIZE, SIZE, SIZE * 2, SIZE * 2))


def fractal(rng, scales=(8, 24, 96, 512), weights=(0.3, 0.3, 0.25, 0.15)):
    result = None
    total = 0.0
    for cells, weight in zip(scales, weights):
        layer = periodic_noise(rng, cells)
        result = layer if result is None else Image.blend(result, layer, weight / (total + weight))
        total += weight
    return result


def wrap_line(draw, points, fill, width=1):
    xs, ys = zip(*points)
    xoffs = [0]
    yoffs = [0]
    if min(xs) < 0:
        xoffs.append(SIZE)
    if max(xs) >= SIZE:
        xoffs.append(-SIZE)
    if min(ys) < 0:
        yoffs.append(SIZE)
    if max(ys) >= SIZE:
        yoffs.append(-SIZE)
    for ox in xoffs:
        for oy in yoffs:
            draw.line([(x + ox, y + oy) for x, y in points], fill=fill, width=width)


def wrap_ellipse(draw, box, fill, outline=None, width=1):
    x0, y0, x1, y1 = box
    xoffs = [0] + ([SIZE] if x0 < 0 else []) + ([-SIZE] if x1 >= SIZE else [])
    yoffs = [0] + ([SIZE] if y0 < 0 else []) + ([-SIZE] if y1 >= SIZE else [])
    for ox in xoffs:
        for oy in yoffs:
            draw.ellipse((x0 + ox, y0 + oy, x1 + ox, y1 + oy), fill, outline, width)


def grain(image, rng, strength=0.12):
    noise = Image.frombytes("L", (SIZE, SIZE), rng.randbytes(SIZE * SIZE))
    if image.mode == "RGB":
        noise = noise.convert("RGB")
    return Image.blend(image, noise, strength)


def save(name, albedo, bump):
    albedo.save(OUT / f"{name}-albedo.png", optimize=True)
    bump.save(OUT / f"{name}-bump.png", optimize=True)
    albedo.save(OUT / f"{name}-albedo.webp", quality=92, method=6)
    bump.save(OUT / f"{name}-bump.webp", quality=95, method=6)
    print(f"{name}: {SIZE}x{SIZE}, PNG source maps + browser WebP maps")
    return albedo


def grass():
    rng = random.Random(91703)
    variation = fractal(rng)
    albedo = ImageOps.colorize(variation, (46, 64, 35), (135, 146, 83))
    bump = ImageOps.colorize(fractal(rng, (64, 256, 1024), (0.2, 0.3, 0.5)), (90,) * 3, (158,) * 3).convert("L")
    color_draw, height_draw = ImageDraw.Draw(albedo), ImageDraw.Draw(bump)
    for _ in range(76000):
        x, y = rng.randrange(SIZE), rng.randrange(SIZE)
        length = rng.uniform(2, 10)
        theta = rng.uniform(0, math.tau)
        dx, dy = math.cos(theta) * length, math.sin(theta) * length
        light = rng.uniform(0, 1)
        color = (int(47 + 72 * light), int(65 + 65 * light), int(34 + 43 * light))
        points = [(x, y), (x + dx * 0.45, y + dy * 0.45), (x + dx, y + dy)]
        wrap_line(color_draw, points, color, 1)
        wrap_line(height_draw, points, int(100 + 85 * light), 1)
    return save("grass", grain(albedo, rng, 0.045), grain(bump, rng, 0.10))


def gravel():
    rng = random.Random(31842)
    noise = fractal(rng, (32, 128, 512), (0.3, 0.3, 0.4))
    albedo = ImageOps.colorize(noise, (94, 91, 84), (155, 151, 140))
    bump = ImageOps.colorize(noise, (68,) * 3, (118,) * 3).convert("L")
    color_draw, height_draw = ImageDraw.Draw(albedo), ImageDraw.Draw(bump)
    for _ in range(35000):
        x, y = rng.randrange(SIZE), rng.randrange(SIZE)
        radius = rng.uniform(1.3, 6.4)
        flatten = rng.uniform(0.58, 1.2)
        value = rng.randint(91, 183)
        tint = rng.randint(-5, 5)
        color = (value + tint, value, value - rng.randint(2, 10))
        box = (x - radius, y - radius * flatten, x + radius, y + radius * flatten)
        wrap_ellipse(color_draw, box, color, (max(0, value - 27),) * 3)
        wrap_ellipse(height_draw, box, rng.randint(141, 196), 79)
        if radius > 3:
            wrap_line(color_draw, [(x - radius * 0.5, y - radius * flatten * 0.45), (x + radius * 0.4, y - radius * flatten * 0.4)], (min(value + 14, 210),) * 3)
    return save("gravel", grain(albedo, rng, 0.08), grain(bump, rng, 0.10))


def rock():
    rng = random.Random(67034)
    noise = fractal(rng, (4, 16, 64, 512), (0.3, 0.25, 0.2, 0.25))
    albedo = ImageOps.colorize(noise, (74, 73, 67), (180, 174, 157))
    bump = ImageOps.colorize(noise, (88,) * 3, (162,) * 3).convert("L")
    color_draw, height_draw = ImageDraw.Draw(albedo), ImageDraw.Draw(bump)
    for _ in range(62000):
        x, y = rng.randrange(SIZE), rng.randrange(SIZE)
        radius = rng.choices((0.6, 1.0, 1.6, 2.4), weights=(4, 4, 2, 1))[0]
        value = rng.randint(66, 192)
        color = (value, value - rng.randint(0, 7), value - rng.randint(3, 14))
        wrap_ellipse(color_draw, (x, y, x + radius * 2, y + radius * 1.5), color)
        wrap_ellipse(height_draw, (x, y, x + radius * 2, y + radius * 1.5), rng.randint(102, 175))
    for _ in range(25):
        x, y = rng.randrange(SIZE), rng.randrange(SIZE)
        points = [(x, y)]
        for _ in range(rng.randint(6, 16)):
            x += rng.uniform(-13, 19)
            y += rng.uniform(8, 22)
            points.append((x, y))
        wrap_line(color_draw, points, (80, 78, 69), 1)
        wrap_line(height_draw, points, 76, 1)
    return save("rock", grain(albedo, rng, 0.06), grain(bump, rng, 0.12))


def bark():
    rng = random.Random(43681)
    noise = fractal(rng, (16, 64, 256), (0.35, 0.4, 0.25))
    albedo = ImageOps.colorize(noise, (46, 36, 27), (107, 88, 62))
    bump = ImageOps.colorize(noise, (84,) * 3, (162,) * 3).convert("L")
    color_draw, height_draw = ImageDraw.Draw(albedo), ImageDraw.Draw(bump)
    for line in range(230):
        x0 = line * SIZE / 230 + rng.uniform(-5, 5)
        phase = rng.uniform(0, math.tau)
        amplitude = rng.uniform(1, 6)
        cycles = rng.randint(1, 5)
        points = [(x0 + amplitude * math.sin(math.tau * cycles * y / SIZE + phase), y) for y in range(-8, SIZE + 9, 4)]
        width = rng.choice((1, 1, 2, 3, 4))
        value = rng.randint(25, 59)
        wrap_line(color_draw, points, (value + 8, value, max(value - 9, 0)), width)
        wrap_line(height_draw, points, rng.randint(45, 84), width)
        highlights = [(x + width + 1, y) for x, y in points]
        wrap_line(color_draw, highlights, (rng.randint(83, 115), rng.randint(63, 86), rng.randint(44, 58)), 1)
        wrap_line(height_draw, highlights, rng.randint(160, 198), 1)
    for _ in range(24000):
        x, y = rng.randrange(SIZE), rng.randrange(SIZE)
        value = rng.randint(42, 102)
        wrap_line(color_draw, [(x, y), (x + rng.uniform(-1, 1), y + rng.randint(2, 8))], (value + 9, value, value - 15), 1)
        wrap_line(height_draw, [(x, y), (x, y + rng.randint(2, 8))], rng.randint(100, 180), 1)
    return save("bark", grain(albedo, rng, 0.05), grain(bump, rng, 0.10))


def sand():
    rng = random.Random(12531)
    noise = fractal(rng, (8, 32, 256, 1024), (0.25, 0.25, 0.2, 0.3))
    albedo = ImageOps.colorize(noise, (153, 143, 119), (220, 208, 176))
    bump = ImageOps.colorize(fractal(rng, (128, 512, 1024), (0.2, 0.3, 0.5)), (105,) * 3, (160,) * 3).convert("L")
    return save("sand", grain(albedo, rng, 0.06), grain(bump, rng, 0.16))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    textures = {"Turf": grass(), "Gravel": gravel(), "Granite": rock(), "Bark": bark(), "Sand": sand()}
    sheet = Image.new("RGB", (1200, 830), (23, 29, 32))
    draw = ImageDraw.Draw(sheet)
    for index, (name, texture) in enumerate(textures.items()):
        x, y = (index % 3) * 400, (index // 3) * 415
        sheet.paste(texture.resize((380, 380), Image.Resampling.LANCZOS), (x + 10, y + 10))
        draw.text((x + 13, y + 394), name, fill=(229, 230, 221))
    sheet.save(PREVIEW / "surface-materials.jpg", quality=92)


if __name__ == "__main__":
    main()
