# The flight art from the source images into assets/flight/.
#   python tools/flight-art.py [source folder]   (tools/flight-src by default)
# Source files:
# - the module's plane side views (assets/Planes.png, or planes-sheet.webp in the folder), white,
#   nose to the left, on green, one above the other in this order: 747, DC-10, L-1011, 767, A300
#   (a sixth, if there, is left out);
# - the cabin with green-screen windows: assets/80sPlaneInterior-realistic2.png (kept with the
#   module; the first version, -realistic.png, if there is no second), else cabin.webp in the folder;
#   "cabin" as the first argument keys only the cabin;
# - optionally liveries/<airline>-<aircraft>.png or .jpg on white (an airline's own paint, e.g.
#   united-dc10.jpg; the airline and aircraft keys of scripts/flights.mjs), cut into
#   assets/flight/liveries/ as WebP. Only use livery art you have the right to use.
import sys
from collections import deque
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("-") and sys.argv[1] not in ("liveries", "cabin") else ROOT / "tools" / "flight-src"
out = Path(__file__).resolve().parent.parent / "assets" / "flight"
out.mkdir(parents=True, exist_ok=True)


def white(p, t=246):
    return p[0] >= t and p[1] >= t and p[2] >= t


def plane(name, source=None, dest=None):
    im = Image.open(source or src / f"{name}.png").convert("RGB")
    w, h = im.size
    px = im.load()
    # The background: white reached from the edges (the white fuselage is walled off by its
    # grey outline), then a soft edge.
    alpha = Image.new("L", (w, h), 255)
    a = alpha.load()
    seen = bytearray(w * h)
    q = deque([(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)])
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not white(px[x, y]):
            continue
        a[x, y] = 0
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                q.append((nx, ny))
    # Two planes to an image, and the lower one's tail rises past the upper one's belly: keep
    # the shape (connected, not background) that starts highest, the plane in flight.
    comp = bytearray(w * h)
    best = None
    label = 0
    for sy in range(h):
        for sx in range(w):
            i = sy * w + sx
            if comp[i] or a[sx, sy] == 0:
                continue
            label += 1
            comp[i] = label
            q = deque([(sx, sy)])
            n, top = 0, sy
            while q:
                x, y = q.popleft()
                n += 1
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if not comp[j] and a[nx, ny]:
                            comp[j] = label
                            q.append((nx, ny))
            if n > w * h * 0.02 and (best is None or top < best[1]):
                best = (label, top)
    for y in range(h):
        for x in range(w):
            if comp[y * w + x] != best[0]:
                a[x, y] = 0
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))
    im.putalpha(alpha)
    im = im.crop(im.getbbox())
    im.save(dest or out / f"{name}.webp", quality=92, alpha_quality=100, method=6)
    print(name, im.size)


SHEET_ORDER = ["747", "dc10", "l1011", "767", "a300"]


def sheet():
    """The planes off the green sheet: each one connected shape, top to bottom."""
    # The sheet kept with the module (assets/Planes.png), else one in the source folder.
    kept = Path(__file__).resolve().parent.parent / "assets" / "Planes.png"
    im = Image.open(kept if kept.exists() else src / "planes-sheet.webp").convert("RGB")
    w, h = im.size
    px = im.load()
    # Green screen: how green each pixel is beyond its red and blue.
    key = Image.new("L", (w, h), 0)
    k = key.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            k[x, y] = max(0, min(255, (g - max(r, b)) * 2))
    # Planes: the not-green, as connected shapes, the big ones, top to bottom.
    solid = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            solid[y * w + x] = k[x, y] < 128
    label = [0] * (w * h)
    shapes = []
    for sy in range(h):
        for sx in range(w):
            i = sy * w + sx
            if not solid[i] or label[i]:
                continue
            n = len(shapes) + 1
            label[i] = n
            q = deque([(sx, sy)])
            box = [sx, sy, sx, sy]
            size = 0
            while q:
                x, y = q.popleft()
                size += 1
                box = [min(box[0], x), min(box[1], y), max(box[2], x), max(box[3], y)]
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if solid[j] and not label[j]:
                            label[j] = n
                            q.append((nx, ny))
            shapes.append((n, size, box))
    planes = sorted([s for s in shapes if s[1] > w * h * 0.01], key=lambda s: s[2][1])
    for name, (n, _, box) in zip(SHEET_ORDER, planes):
        x0, y0, x1, y1 = box[0] - 3, box[1] - 3, box[2] + 4, box[3] + 4
        cut = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
        c = cut.load()
        for y in range(max(0, y0), min(h, y1)):
            for x in range(max(0, x0), min(w, x1)):
                # This plane's pixels and its soft edge (green fringe next to it), spill removed.
                near = any(label[yy * w + xx] == n for yy in range(max(0, y - 2), min(h, y + 3)) for xx in range(max(0, x - 2), min(w, x + 3))) if label[y * w + x] != n else True
                if not near:
                    continue
                r, g, b = px[x, y]
                a = 255 - k[x, y]
                if a <= 0:
                    continue
                c[x - x0, y - y0] = (r, min(g, max(r, b) + 6), b, a)
        cut = cut.crop(cut.getbbox())
        cut.save(out / f"{name}.webp", quality=92, alpha_quality=100, method=6)
        print(name, cut.size)


def cabin():
    kept = next((p for p in (ROOT / "assets" / f"80sPlaneInterior-realistic{n}.png" for n in ("2", "")) if p.exists()), ROOT / "assets" / "80sPlaneInterior-realistic.png")
    im = Image.open(kept if kept.exists() else src / "cabin.webp").convert("RGB")
    # Green screen: how green each pixel is beyond its red and blue. Strongly green goes clear,
    # the edge fringe partly, with the green spill taken out of what stays.
    r, g, b = im.split()
    rb = ImageChops.lighter(r, b)
    k = ImageChops.subtract(g, rb)
    alpha = k.point(lambda v: 255 if v <= 30 else 0 if v >= 90 else round(255 * (1 - (v - 30) / 60)))
    g = Image.composite(ImageChops.darker(g, rb), g, k.point(lambda v: 255 if v > 30 else 0))
    Image.merge("RGBA", (r, g, b, alpha)).save(out / "cabin.webp", quality=90, alpha_quality=100, method=6)
    print("cabin", im.size)


# "liveries" cuts only the liveries; --out <folder> puts them there instead of the module (your
# own Foundry data folder, set as the "Plane liveries folder" setting, keeps them out of the module).
args = sys.argv[2:]
if sys.argv[1:2] == ["cabin"]:
    cabin()
    sys.exit()
livery_out = Path(args[args.index("--out") + 1]) if "--out" in args else out / "liveries"
if "liveries" not in args:
    sheet()
    cabin()
liveries = sorted(p for p in (src / "liveries").glob("*") if p.suffix.lower() in (".png", ".jpg", ".jpeg"))
if liveries:
    livery_out.mkdir(parents=True, exist_ok=True)
for p in liveries:
    plane(p.stem.lower(), source=p, dest=livery_out / f"{p.stem.lower()}.webp")
