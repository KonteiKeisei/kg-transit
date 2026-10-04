"""Build a clean zip for sideloading into Foundry.

    python tools/package.py            dist/kg-transit v4.zip (from module.json's version)
    python tools/package.py --force    rebuild a version that already has a zip

The zip is named after the version in module.json, so every build is kept: 4.0.0 becomes
"kg-transit v4.zip", a patch like 4.0.1 becomes "kg-transit v4.0.1.zip". An existing zip
for the same version is never overwritten without --force: bump the version in module.json
(and package.json) for a new build.

It holds only what Foundry loads (the manifest, scripts, styles, templates, the keyed art,
the city sound, the city network packs and the README), all inside a top-level kg-transit/
folder. Extract it into Data/modules to get Data/modules/kg-transit/module.json.
"""
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / "module.json").read_text(encoding="utf-8"))
module_id = manifest["id"]
version = manifest["version"]

INCLUDE = [
    "module.json",
    "README.md",
    "LICENSE",
    "DATA-LICENSE.md",
    "CREDITS.md",
    "scripts/*.mjs",
    "styles/*.css",
    "templates/*.hbs",
    "assets/car-interior.webp",
    "assets/steam-interior.webp",
    "assets/strip-map-mask.webp",
    "assets/sounds/*.ogg",
    "assets/flight/*.webp",
    "assets/terminals/*.webp",
    "data/cities/*.json",
    "data/airports.json",
]


def version_label(v):
    """"4" for 4.0.0, otherwise the version as written ("4.0.1", "4.1.0")."""
    parts = v.split(".")
    return parts[0] if all(p == "0" for p in parts[1:]) else v


files = sorted({p for pattern in INCLUDE for p in ROOT.glob(pattern) if p.is_file()})

# Every file the manifest names must be in the package.
for entry in manifest.get("esmodules", []) + manifest.get("styles", []):
    assert (ROOT / entry) in files, f"manifest file missing: {entry}"

out = ROOT / "dist" / f"{module_id} v{version_label(version)}.zip"
out.parent.mkdir(exist_ok=True)
if out.exists() and "--force" not in sys.argv:
    sys.exit(f"{out.name} already exists. Bump the version in module.json, or pass --force to rebuild it.")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for path in files:
        z.write(path, f"{module_id}/{path.relative_to(ROOT).as_posix()}")

print(f"{out}  (version {version})")
for path in files:
    print(f"  {module_id}/{path.relative_to(ROOT).as_posix()}")
print(f"{len(files)} files, {out.stat().st_size / 1e6:.1f} MB")
