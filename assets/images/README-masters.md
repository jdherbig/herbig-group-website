# Image masters — what is here, and what is still missing

The files in this folder are the masters. Everything in `r/` is generated
from them by `tools/generate-image-variants.py` and should never be edited by
hand: replace a master, re-run that script, and the whole candidate ladder is
rebuilt.

Nothing is ever upscaled. A candidate wider than its master is simply not
produced, because enlarging an export adds file size without adding detail.
That matters here, because several masters are smaller than the space the
design gives them.

## Masters that are too small for the layout (HG-P4-05)

Required width is the source width the layout genuinely needs at that
viewport: for a `cover` crop that is `max(boxWidth, boxHeight × aspectRatio)`,
not the CSS box width, plus a little for the entrance transform. DPR 2 is what
a modern phone or laptop screen actually asks for.

| Master | Size today | Needs (DPR 1) | Needs (DPR 2) | Verdict |
|---|---|---|---|---|
| `page-header-jv.jpg` | 896 × 1152 | 1440 | 2880 | **Worst case.** Also portrait, so a short full-width banner throws most of the decoded image away. Wants a landscape master of at least 1920 wide. |
| `page-header-housing.jpg` | 1264 × 720 | 1440 | 2880 | Slightly soft at desktop already; wants ≥ 1920. |
| `case-hero-primary.jpg` | 1376 × 768 | 1441 | 2882 | Serves both the case-study hero and the Blueprint page header. Wants ≥ 1920, ideally 2560. |
| `page-header-holdings.jpg` | 1800 × 1025 | 1440 | 2880 | Fine at DPR 1, short at DPR 2. |
| `hero.jpg` | 2200 × 1236 | 1541 | 3083 | Comfortable at DPR 1 — the only master that is. |
| Cards, features, team portraits | 900–1000 wide | 400–1100 | 800–2200 | Adequate at DPR 1, short at DPR 2. |

These are asset limitations, not markup ones. The responsive markup is already
in place and picks the best candidate the master can supply, so the fix when
better originals arrive is only:

1. Drop the new file in this folder under the same name.
2. Add the wider candidate widths to `PLAN` in
   `tools/generate-image-variants.py` (the ladder is 360, 480, 640, 768, 960,
   1200, 1440, 1800, 2200, 2560).
3. Run `python3 tools/generate-image-variants.py`.
4. Widen the last `sizes` bucket in the markup only if the new master can
   actually serve it.

No layout, crop or focal-point change is needed, and none should be made while
swapping a master: the composition on the page is the approved one.

## Quality settings

AVIF 60, WebP 85, JPEG 86, chosen by comparing each format against the master
at the final crop — including the architectural drawings, whose drawn text and
hairlines break before any photograph does. If a future master is noticeably
grainier or more detailed, compare before trusting these numbers.
