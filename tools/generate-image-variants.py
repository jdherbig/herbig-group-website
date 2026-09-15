#!/usr/bin/env python3
"""
Herbig Group — responsive image variants (HG-P4-02).

Regenerates every file under assets/images/r/ from the masters in
assets/images/. The candidate widths below were derived from the real
rendered box of each photograph at twelve viewport widths, accounting for
object-fit: cover (a cropped image needs max(boxWidth, boxHeight x aspect)
source pixels, not just the box width) and for the entrance transforms that
overscan slightly. The matching `sizes` attributes live in the markup.

Nothing here upscales: a candidate wider than the master is never produced,
because inventing pixels does not add detail (see assets/images/README-
masters.md for the images whose masters are genuinely too small).

Run from anywhere:  python3 tools/generate-image-variants.py
Requires Pillow with AVIF support (Pillow >= 11.3).
"""
import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install --upgrade Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTERS = os.path.join(ROOT, "assets", "images")
OUT = os.path.join(MASTERS, "r")

# Encoder settings, chosen by comparing each format against the master at the
# final crop - including the architectural drawings, whose drawn text and
# hairlines are the first thing to break under aggressive compression.
AVIF_QUALITY = 60
WEBP_QUALITY = 85
JPEG_QUALITY = 86

# stem -> (candidate widths, generate a JPEG ladder too)
# The JPEG ladder only matters for browsers with neither AVIF nor WebP, so it
# is generated only where the master is heavy enough for it to be worth the
# extra files.
PLAN = {
    "asset-fortitude-hq.jpg": ([480, 640, 768, 960], False),
    "asset-herbigives-center.jpg": ([480, 640, 768, 960], False),
    "asset-res-resiliency.jpg": ([480, 640, 768, 960], False),
    "case-feature-cryotherapy.jpg": ([480, 640, 768, 900], False),
    "case-feature-rehab-labs.jpg": ([480, 640, 768, 900], False),
    "case-gallery-main.jpg": ([480, 640, 768, 960, 1300], True),
    "case-hero-primary.jpg": ([640, 768, 960, 1200, 1376], True),
    "feature-split-housing.jpg": ([640, 768, 1000], False),
    "hero.jpg": ([640, 768, 960, 1200, 1440, 1800, 2200], True),
    "page-header-holdings.jpg": ([640, 768, 960, 1200, 1440, 1800], False),
    "page-header-housing.jpg": ([640, 768, 960, 1264], False),
    "page-header-jv.jpg": ([360, 480, 640, 768, 896], True),
    "pathway-i.jpg": ([360, 480, 640, 780], False),
    "pathway-ii.jpg": ([360, 480, 640, 780], False),
    "philosophy-fold.jpg": ([480, 640, 768, 1000], False),
    "pillar-people.jpg": ([360, 480, 600], False),
    "pillar-profit.jpg": ([360, 480, 600], False),
    "pillar-purpose.jpg": ([360, 480, 640, 768], False),
    "team-jacob.jpg": ([480, 640, 768, 900], False),
    "team-jake.jpg": ([480, 640, 768, 900], False),
    "team-michelle.jpg": ([480, 640, 768, 900], True),
    "team-nick.jpg": ([480, 640, 768, 900], False),
    "team-robyn.jpg": ([480, 640, 768, 900], False),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    written = 0
    total = 0

    for name, (widths, jpeg_ladder) in sorted(PLAN.items()):
        path = os.path.join(MASTERS, name)
        if not os.path.exists(path):
            print(f"  missing master, skipped: {name}")
            continue

        stem = name.rsplit(".", 1)[0]
        master = Image.open(path).convert("RGB")
        mw, mh = master.size

        for width in widths:
            if width > mw:
                continue  # never upscale
            height = round(width * mh / mw)
            frame = master if width == mw else master.resize((width, height), Image.LANCZOS)

            targets = [("avif", dict(quality=AVIF_QUALITY)),
                       ("webp", dict(quality=WEBP_QUALITY, method=6))]
            if jpeg_ladder and width != mw:
                targets.append(("jpg", dict(quality=JPEG_QUALITY, optimize=True, progressive=True)))

            for ext, kwargs in targets:
                out_path = os.path.join(OUT, f"{stem}-{width}.{ext}")
                frame.save(out_path, **kwargs)
                written += 1
                total += os.path.getsize(out_path)

    print(f"wrote {written} files ({total / 1_000_000:.1f} MB) to assets/images/r/")


if __name__ == "__main__":
    main()
