"""Key the chroma-green windows out of the car interiors.

    python tools/key-interior.py

subway: assets/subway-interior-source.png -> assets/car-interior.webp and
        assets/strip-map-mask.webp (the overhead line maps, repainted per line at ride
        time). The round logos on the overhead panels are painted out.
steam:  assets/steam-interior-source.png -> assets/steam-interior.webp

Alpha falls from 255 to 0 as greenness (g - max(r, b)) rises from LO to HI. Green spill
near the windows is removed; the subway art has no real greens so it is despilled all
over, but the steam coach's green upholstery is left alone.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ASSETS = Path(__file__).resolve().parent.parent / "assets"
LO, HI = 70, 140
PANELS = [(290, 0, 540, 210), (1130, 0, 1380, 210)]
# Small boxes around the round logos on those panels (the panels' light strips are white too).
LOGOS = [(325, 0, 390, 80), (1282, 5, 1345, 85)]
RED_LO, RED_HI = 40, 110


def key(src, despill_everywhere):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    px = list(im.getdata())
    alpha = []
    for r, g, b in px:
        d = g - max(r, b)
        if d <= LO or g < 110:
            alpha.append(255)
        elif d >= HI:
            alpha.append(0)
        else:
            alpha.append(round(255 * (HI - d) / (HI - LO)))
    a_img = Image.new("L", (w, h))
    a_img.putdata(alpha)
    near = list(a_img.point(lambda v: 255 if v < 250 else 0).filter(ImageFilter.MaxFilter(9)).getdata())
    out = []
    for (r, g, b), a, n in zip(px, alpha, near):
        if (despill_everywhere or n) and g > max(r, b):
            g = max(r, b)
        out.append((r, g, b, a))
    res = Image.new("RGBA", (w, h))
    res.putdata(out)
    return res


def paint_out_logos(res):
    """Cover the round white logos on the overhead panels with the panel's own dark colour."""
    draw = ImageDraw.Draw(res)
    for x0, y0, x1, y1 in LOGOS:
        xs, ys = [], []
        for y in range(y0, y1):
            for x in range(x0, x1):
                r, g, b, a = res.getpixel((x, y))
                # Light and greyish: the logo disc, including its shaded edge.
                if min(r, g, b) > 120 and max(r, g, b) - min(r, g, b) < 45:
                    xs.append(x)
                    ys.append(y)
        if not xs:
            continue
        bx0, by0, bx1, by1 = min(xs) - 3, min(ys) - 3, max(xs) + 3, max(ys) + 3
        # The panel colour just below the logo.
        samples = [res.getpixel(((bx0 + bx1) // 2 + k, min(by1 + 4, res.size[1] - 1)))[:3] for k in range(-3, 3)]
        fill = tuple(sorted(c[i] for c in samples)[len(samples) // 2] for i in range(3)) + (255,)
        # The logo is a tilted ellipse: cover its white pixels (widened a little) and the
        # upright ellipse around them, which takes in the letter inside.
        mask = Image.new("L", res.size, 0)
        mdraw = ImageDraw.Draw(mask)
        mdraw.ellipse((bx0, by0, bx1, by1), fill=255)
        for x, y in zip(xs, ys):
            mask.putpixel((x, y), 255)
        mask = mask.filter(ImageFilter.MaxFilter(7))
        res.paste(Image.new("RGBA", res.size, fill), (0, 0), mask)


def strip_mask(res):
    """Lift the red of the overhead line maps into a mask, leaving a dark neutral underneath."""
    w, h = res.size
    mask = Image.new("L", (w, h), 0)
    for x0, y0, x1, y1 in PANELS:
        for y in range(y0, min(y1, h)):
            for x in range(x0, min(x1, w)):
                r, g, b, a = res.getpixel((x, y))
                red = r - max(g, b)
                if red <= RED_LO or r < 90:
                    continue
                m = min(255, round(255 * (red - RED_LO) / (RED_HI - RED_LO)))
                mask.putpixel((x, y), m)
                k = m / 255
                dark = round((0.3 * r + 0.59 * g + 0.11 * b) * 0.25)
                res.putpixel((x, y), (round(r + (dark - r) * k), round(g + (dark - g) * k), round(b + (dark - b) * k), a))
    white = Image.new("L", (w, h), 255)
    return Image.merge("RGBA", (white, white, white, mask))


subway = key(ASSETS / "subway-interior-source.png", despill_everywhere=True)
paint_out_logos(subway)
# WebP: the interiors lossy (transparency exact), the mask lossless.
strip_mask(subway).save(ASSETS / "strip-map-mask.webp", lossless=True, method=6)
subway.save(ASSETS / "car-interior.webp", quality=90, alpha_quality=100, method=6)

steam = key(ASSETS / "steam-interior-source.png", despill_everywhere=False)
steam.save(ASSETS / "steam-interior.webp", quality=90, alpha_quality=100, method=6)
print("done")
