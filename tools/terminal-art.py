# The airport terminal art from its source zip into assets/terminals/.
#   python tools/terminal-art.py [source.zip]
# The source (assets/airport-terminal-1980s-layers-1980s.zip by default, kept out of git) holds,
# for each airport code, three 1664 x 936 JPEGs:
#   CODE_terminal-key.jpg  the terminal interior, its windows flat #00FF00 green
#   CODE_tarmac-day.jpg    the view out of those windows by day
#   CODE_tarmac-dusk.jpg   the same at dusk and night
# Out come CODE-terminal.webp (the windows keyed clear), CODE-day.webp and CODE-dusk.webp. The
# flight screen stacks them: tarmac, weather, terminal (scripts/plane-show.mjs).
# The jet bridge (assets/BoardingTunnel.png, any airport) becomes jetbridge.webp, shown while
# boarding and getting off the plane.
import io
import sys
import zipfile
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else next(ROOT.glob("assets/airport-terminal-*.zip"), None)
if not src or not src.exists():
    sys.exit("No source zip: pass its path, or put it in assets/ (airport-terminal-*.zip).")
out = ROOT / "assets" / "terminals"
out.mkdir(parents=True, exist_ok=True)

# How green a pixel is beyond its red and blue: past HARD it goes clear, between SOFT and HARD
# partly (the window edge, softened by the JPEG), with the green spill taken out of what stays.
SOFT, HARD = 30, 90


def key(im):
    r, g, b = im.convert("RGB").split()
    rb = ImageChops.lighter(r, b)
    k = ImageChops.subtract(g, rb)
    alpha = k.point(lambda v: 255 if v <= SOFT else 0 if v >= HARD else round(255 * (1 - (v - SOFT) / (HARD - SOFT))))
    # Spill: where the pixel leans green, green comes down to its red or blue.
    fringe = k.point(lambda v: 255 if v > SOFT else 0)
    g = Image.composite(ImageChops.darker(g, rb), g, fringe)
    return Image.merge("RGBA", (r, g, b, alpha))


total = 0
with zipfile.ZipFile(src) as z:
    codes = sorted({n.split("_")[0] for n in z.namelist() if n.endswith(".jpg")})
    for code in codes:
        layers = {
            "terminal": (f"{code}_terminal-key.jpg", lambda im: key(im), 88),
            "day": (f"{code}_tarmac-day.jpg", lambda im: im.convert("RGB"), 82),
            "dusk": (f"{code}_tarmac-dusk.jpg", lambda im: im.convert("RGB"), 82),
        }
        for layer, (name, make, quality) in layers.items():
            im = make(Image.open(io.BytesIO(z.read(name))))
            path = out / f"{code}-{layer}.webp"
            im.save(path, quality=quality, method=6)
            total += path.stat().st_size
        print(code)
bridge = ROOT / "assets" / "BoardingTunnel.png"
if bridge.exists():
    path = out / "jetbridge.webp"
    Image.open(bridge).convert("RGB").save(path, quality=84, method=6)
    total += path.stat().st_size
    print("jet bridge")
print(f"{len(codes)} airports, {total / 1e6:.1f} MB in {out}")
