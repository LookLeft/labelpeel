"""Generates the web and iOS app icons from assets/icon.png.

The source artwork has its rounded corners drawn in, on a white background.
iOS needs a full-bleed square (the system applies its own corner mask), so
that version is cropped inside the corners. The web icons keep the artwork's
own corners, with the white outside them made transparent.

Run from the repo root after changing the artwork: python3 scripts/icons.py
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icon.png"
PUBLIC = ROOT / "public"
IOS_ICONSET = ROOT / "ios" / "Labelsmith" / "Assets.xcassets" / "AppIcon.appiconset"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res" / "drawable-nodpi"
MAC_ICONSET = ROOT / "macos" / "Labelsmith" / "Assets.xcassets" / "AppIcon.appiconset"

# The corner curves reach about 80 px in along the diagonal of the 1254 px
# source; cropping 96 px from each side leaves only the blue background.
CORNER_INSET = 96 / 1254


def full_bleed(src: Image.Image) -> Image.Image:
    w, h = src.size
    d = round(w * CORNER_INSET)
    return src.crop((d, d, w - d, h - d))


def android_adaptive(art: Image.Image, size: int = 432) -> Image.Image:
    """Adaptive icon layer (108 dp, shown at 432 px). Launchers crop it to a
    shape inside the middle 72 dp, so the artwork is shrunk to keep the letter
    in that zone, over a background extended from the artwork's own edges."""
    art = art.convert("RGB")
    # The artwork's background is a vertical gradient: stretch its left edge
    # column across the canvas, then feather the artwork onto it.
    column = art.crop((0, 0, 1, art.height)).resize((1, size), Image.BILINEAR)
    canvas = column.resize((size, size), Image.NEAREST)
    inner = round(size * 0.64)
    scaled = art.resize((inner, inner), Image.LANCZOS)
    mask = Image.new("L", (inner, inner), 0)
    feather = round(inner * 0.08)
    px = mask.load()
    for y in range(inner):
        for x in range(inner):
            d = min(x, y, inner - 1 - x, inner - 1 - y)
            px[x, y] = 255 if d >= feather else round(255 * d / feather)
    off = (size - inner) // 2
    canvas.paste(scaled, (off, off), mask)
    return canvas


def transparent_corners(src: Image.Image) -> Image.Image:
    """Make the white outside the rounded square transparent, un-blending the
    anti-aliased edge so it doesn't leave a light fringe."""
    rgb = src.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    # Flood-fill the near-white area connected to the image border.
    outside = bytearray(w * h)
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    while stack:
        x, y = stack.pop()
        i = y * w + x
        if outside[i] or min(px[x, y]) < 200:
            continue
        outside[i] = 1
        if x > 0: stack.append((x - 1, y))
        if x < w - 1: stack.append((x + 1, y))
        if y > 0: stack.append((x, y - 1))
        if y < h - 1: stack.append((x, y + 1))

    out = Image.new("RGBA", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if outside[y * w + x]:
                op[x, y] = (0, 0, 0, 0)
                continue
            near_edge = any(
                0 <= x + dx < w and 0 <= y + dy < h and outside[(y + dy) * w + x + dx]
                for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2))
            )
            if not near_edge:
                op[x, y] = (r, g, b, 255)
                continue
            # Edge pixel = a * blue + (1 - a) * white; the background's red
            # channel is ~0, so red measures how much white is mixed in.
            a = max(1, 255 - r)
            unblend = lambda c: max(0, min(255, round((c - (255 - a)) * 255 / a)))
            op[x, y] = (unblend(r), unblend(g), unblend(b), a)
    return out


def main() -> None:
    src = Image.open(SRC).convert("RGB")

    IOS_ICONSET.mkdir(parents=True, exist_ok=True)
    full_bleed(src).resize((1024, 1024), Image.LANCZOS).save(IOS_ICONSET / "AppIcon.png")

    # Home-screen icon for Safari's "Add to Home Screen" (iOS rounds it).
    full_bleed(src).resize((180, 180), Image.LANCZOS).save(PUBLIC / "apple-touch-icon.png")

    ANDROID_RES.mkdir(parents=True, exist_ok=True)
    android_adaptive(full_bleed(src)).save(ANDROID_RES / "ic_launcher_background.png", optimize=True)

    rounded = transparent_corners(src)

    # macOS icons keep their own rounded shape inside Apple's 1024 px grid,
    # with the shape 824 px across.
    MAC_ICONSET.mkdir(parents=True, exist_ok=True)
    mac = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    mac.paste(rounded.resize((824, 824), Image.LANCZOS), (100, 100))
    images = []
    for pt in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            name = f"icon_{pt}x{pt}{'@2x' if scale == 2 else ''}.png"
            mac.resize((pt * scale, pt * scale), Image.LANCZOS).save(MAC_ICONSET / name, optimize=True)
            images.append({"filename": name, "idiom": "mac", "scale": f"{scale}x", "size": f"{pt}x{pt}"})
    (MAC_ICONSET / "Contents.json").write_text(json.dumps({"images": images, "info": {"author": "xcode", "version": 1}}, indent=2) + "\n")
    for size in (32, 192, 512):
        rounded.resize((size, size), Image.LANCZOS).save(PUBLIC / f"icon-{size}.png", optimize=True)
    print("Icons written to public/,", IOS_ICONSET.relative_to(ROOT), ",", MAC_ICONSET.relative_to(ROOT), "and", ANDROID_RES.relative_to(ROOT))


if __name__ == "__main__":
    main()
