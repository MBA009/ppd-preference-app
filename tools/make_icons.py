#!/usr/bin/env python3
"""Generate PWA icons (shield with a check) into public/icons/. Needs Pillow."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)
BLUE, WHITE = (0, 102, 204, 255), (255, 255, 255, 255)
S = 1024  # draw large, then downsample

def render(size, maskable):
    img = Image.new("RGBA", (S, S), BLUE if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not maskable:
        d.rounded_rectangle((0, 0, S, S), radius=int(S * 0.22), fill=BLUE)
    k = 0.60 if maskable else 0.68  # glyph scale; maskable keeps the safe zone (inner 80%)
    cx, cy, w, h = S / 2, S / 2, S * k * 0.72, S * k
    top, bot = cy - h / 2, cy + h / 2
    pts = [(cx, top), (cx + w / 2, top + h * 0.14), (cx + w / 2, top + h * 0.50)]
    # right side curve to the bottom point
    for i in range(1, 25):
        t = i / 24
        pts.append((cx + w / 2 * (1 - t) ** 1.6 + 0, top + h * 0.50 + (bot - top - h * 0.50) * t))
    for i in range(24, 0, -1):
        t = i / 24
        pts.append((cx - w / 2 * (1 - t) ** 1.6, top + h * 0.50 + (bot - top - h * 0.50) * t))
    pts += [(cx - w / 2, top + h * 0.50), (cx - w / 2, top + h * 0.14)]
    d.polygon(pts, fill=WHITE)
    lw = int(S * 0.055)
    c = [(cx - w * 0.22, cy - h * 0.02), (cx - w * 0.05, cy + h * 0.14), (cx + w * 0.26, cy - h * 0.16)]
    d.line(c, fill=BLUE, width=lw, joint="curve")
    for x, y in (c[0], c[-1]):
        d.ellipse((x - lw / 2, y - lw / 2, x + lw / 2, y + lw / 2), fill=BLUE)
    return img.resize((size, size), Image.LANCZOS)

for name, size, maskable in (("icon-192.png", 192, False), ("icon-512.png", 512, False),
                             ("icon-maskable-512.png", 512, True), ("apple-touch-icon.png", 180, True)):
    render(size, maskable).save(os.path.join(OUT, name))
print("icons written to", os.path.abspath(OUT))
