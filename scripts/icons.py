"""Generates the web and iOS app icons from assets/icon.png.

The source artwork has its rounded corners drawn in, on a white background.
iOS needs a full-bleed square (the system applies its own corner mask), so
that version is cropped inside the corners. The web icons keep the artwork's
own corners, with the white outside them made transparent.

Run from the repo root after changing the artwork: python3 scripts/icons.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icon.png"
PUBLIC = ROOT / "public"
IOS_ICONSET = ROOT / "ios" / "Labelsmith" / "Assets.xcassets" / "AppIcon.appiconset"

# The corner curves reach about 80 px in along the diagonal of the 1254 px
# source; cropping 96 px from each side leaves only the blue background.
CORNER_INSET = 96 / 1254


def full_bleed(src: Image.Image) -> Image.Image:
    w, h = src.size
    d = round(w * CORNER_INSET)
    return src.crop((d, d, w - d, h - d))


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

    rounded = transparent_corners(src)
    for size in (32, 192, 512):
        rounded.resize((size, size), Image.LANCZOS).save(PUBLIC / f"icon-{size}.png", optimize=True)
    print("Icons written to public/ and", IOS_ICONSET.relative_to(ROOT))


if __name__ == "__main__":
    main()
