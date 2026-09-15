/*
 * Herbig Group — deploy-time asset versioning (HG-P4-07).
 *
 * Every first-party asset is served with a long-lived immutable cache
 * header (see _headers), which is only safe if changing a file also
 * changes its URL. This script is what makes that true: on each deploy it
 * hashes every local asset the pages reference and rewrites the reference
 * to "<path>?v=<hash>". A file whose bytes are unchanged keeps the same
 * URL and stays cached; a file that changed gets a new URL and is fetched
 * immediately. Nothing is renamed on disk and nothing is committed - this
 * runs against Netlify's build workspace, so the repository keeps plain,
 * readable filenames.
 *
 * It is deliberately dependency-free (no package.json, no install step)
 * and idempotent: running it twice produces the same output.
 *
 * Run locally the same way Netlify does:  node stamp.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const HASHES = new Map();

function hashFor(relPath) {
  if (HASHES.has(relPath)) return HASHES.get(relPath);
  let hash = null;
  try {
    const bytes = fs.readFileSync(path.join(ROOT, relPath));
    hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  } catch (err) {
    hash = null; // referenced file missing: leave the URL untouched
  }
  HASHES.set(relPath, hash);
  return hash;
}

// Local assets worth versioning: the stylesheet, the scripts, and anything
// under assets/ (images, icons, the animation JSON). External URLs never
// match, since they start with a scheme.
const ASSET_RE = /\b((?:assets\/[A-Za-z0-9_\-./]+\.(?:jpg|jpeg|png|svg|avif|webp|json|woff2?)|styles\.css|script\.js|transitions\.js))(\?v=[0-9a-f]+)?/g;

function stampHtml(file) {
  const original = fs.readFileSync(file, "utf8");
  let replaced = 0;
  const updated = original.replace(ASSET_RE, (match, relPath) => {
    const hash = hashFor(relPath);
    if (!hash) return relPath;
    replaced += 1;
    return `${relPath}?v=${hash}`;
  });
  if (updated !== original) fs.writeFileSync(file, updated);
  return replaced;
}

const pages = fs.readdirSync(ROOT).filter((name) => name.endsWith(".html"));
let total = 0;
for (const page of pages) {
  const count = stampHtml(path.join(ROOT, page));
  total += count;
  console.log(`stamped ${String(count).padStart(3)} asset references in ${page}`);
}

const missing = [...HASHES.entries()].filter(([, hash]) => !hash).map(([p]) => p);
if (missing.length) {
  console.warn(`warning: ${missing.length} referenced file(s) not found on disk:`);
  missing.forEach((p) => console.warn(`  ${p}`));
}
console.log(`done: ${total} references across ${pages.length} pages, ${HASHES.size} unique assets`);

/* ---------------------------------------------------------------------------
 * Canonical URLs, sitemap and robots.txt.
 *
 * These need an absolute origin, and the origin is the one thing this
 * repository should not hard-code: the site is mid-migration to its own
 * domain, and a canonical pointing at a host that is not serving the site
 * is worse than no canonical at all. Netlify already knows the answer and
 * passes it in as URL (the primary custom domain once one is attached,
 * the netlify.app address until then), so the correct origin appears on
 * its own the moment the domain cuts over, with no code change.
 *
 * Deploy previews and branch deploys get a noindex robots.txt instead, so
 * a staging copy cannot compete with the real site in search.
 * ------------------------------------------------------------------------- */
const CONTEXT = process.env.CONTEXT || "local";
// SITE_ORIGIN exists so the production metadata can be generated and checked
// on a local build (node SITE_ORIGIN=https://herbig.group CONTEXT=production
// stamp.js). Netlify never sets it, so it cannot leak into a real deploy.
const ORIGIN = (process.env.SITE_ORIGIN || process.env.URL || "").replace(/\/+$/, "");
const IS_PRODUCTION = CONTEXT === "production" && !!ORIGIN;

// Route per page, matching how the site is actually served (extensionless).
const ROUTES = {
  "index.html": "/",
  "our-blueprint.html": "/our-blueprint",
  "active-holdings.html": "/active-holdings",
  "joint-ventures.html": "/joint-ventures",
  "housing-projects.html": "/housing-projects",
  "fortitude-arizona-case-study.html": "/fortitude-arizona-case-study",
};

/* ---------------------------------------------------------------------------
 * Social metadata (P7-01 / P7-02 / P7-06).
 *
 * The titles and descriptions are not restated here: they are read back out
 * of each page's own <title> and meta description, so the approved copy has
 * exactly one home and OG can never drift away from what the page says.
 *
 * Only the image assignment is configuration. Every route resolves to an
 * approved card - its own where it has one, the shared brand card otherwise -
 * chosen here at build time rather than by leaving a platform to guess at
 * body images or by any client-side fallback, neither of which a crawler
 * would honour.
 *
 * Status claims ("under construction", "future direction") live in the
 * description and the image alt, not burned into the artwork, so they stay
 * editable as the project moves.
 * ------------------------------------------------------------------------- */
const DEFAULT_SOCIAL = {
  image: "assets/social/og-herbig-group.jpg",
  alt: "The Herbig Group mark on a dark field",
};

const SOCIAL = {
  "index.html": DEFAULT_SOCIAL,
  "our-blueprint.html": DEFAULT_SOCIAL,
  "joint-ventures.html": DEFAULT_SOCIAL,
  "housing-projects.html": DEFAULT_SOCIAL,
  "active-holdings.html": {
    image: "assets/social/og-fortitude-arizona.jpg",
    alt: "The Herbig Group mark over a rendering of the Fortitude Arizona headquarters, the company's first project, currently under construction",
  },
  "fortitude-arizona-case-study.html": {
    image: "assets/social/og-fortitude-arizona.jpg",
    alt: "The Herbig Group mark over a rendering of the Fortitude Arizona headquarters, the company's first project, currently under construction",
  },
};

// Minimal JPEG/PNG header readers. A configured card that is missing, is not
// the type it claims, or does not parse fails the build (see below) rather
// than shipping a broken preview that only shows up on someone else's
// timeline - and reading the real header is also what keeps the declared
// og:image:width/height honest instead of hand-copied.
function imageInfo(relPath) {
  const file = path.join(ROOT, relPath);
  const buf = fs.readFileSync(file);
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { type: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      // SOF0-SOF15, excluding the non-frame markers in that range
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "image/jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  throw new Error(`${relPath}: not a readable PNG or JPEG`);
}

function firstMatch(html, re, label, page) {
  const m = html.match(re);
  if (!m) throw new Error(`${page}: no ${label} found`);
  return m[1].trim();
}

const escapeAttr = (s) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

if (IS_PRODUCTION) {
  // Validate every configured card before writing anything, so a missing or
  // corrupt asset stops the deploy instead of producing half-stamped pages.
  const cards = new Map();
  const cardErrors = [];
  for (const [page, cfg] of Object.entries(SOCIAL)) {
    try {
      const info = imageInfo(cfg.image);
      const hash = hashFor(cfg.image);
      cards.set(page, { ...cfg, ...info, url: `${ORIGIN}/${cfg.image}${hash ? `?v=${hash}` : ""}` });
    } catch (err) {
      cardErrors.push(`  ${page} -> ${cfg.image}: ${err.message}`);
    }
  }
  if (cardErrors.length) {
    console.error("social card assets failed validation:");
    cardErrors.forEach((line) => console.error(line));
    process.exit(1);
  }

  let canonicals = 0;
  for (const [page, route] of Object.entries(ROUTES)) {
    const file = path.join(ROOT, page);
    if (!fs.existsSync(file)) continue;
    const href = ORIGIN + route;
    let html = fs.readFileSync(file, "utf8");

    // Re-running must not stack duplicates of anything emitted here.
    html = html.replace(/\s*<link rel="canonical"[^>]*>/g, "");
    html = html.replace(/\s*<meta property="og:[^"]*"[^>]*>/g, "");
    html = html.replace(/\s*<meta name="twitter:[^"]*"[^>]*>/g, "");

    const title = firstMatch(html, /<title>([\s\S]*?)<\/title>/, "<title>", page);
    const description = firstMatch(
      html, /<meta name="description" content="([^"]*)"/, "meta description", page);
    const card = cards.get(page) || { ...DEFAULT_SOCIAL };

    const tags = [
      `<link rel="canonical" href="${href}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="Herbig Group">`,
      `<meta property="og:locale" content="en_US">`,
      `<meta property="og:url" content="${href}">`,
      `<meta property="og:title" content="${escapeAttr(title)}">`,
      `<meta property="og:description" content="${escapeAttr(description)}">`,
      `<meta property="og:image" content="${card.url}">`,
      `<meta property="og:image:type" content="${card.type}">`,
      `<meta property="og:image:width" content="${card.width}">`,
      `<meta property="og:image:height" content="${card.height}">`,
      `<meta property="og:image:alt" content="${escapeAttr(card.alt)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${escapeAttr(title)}">`,
      `<meta name="twitter:description" content="${escapeAttr(description)}">`,
      `<meta name="twitter:image" content="${card.url}">`,
      `<meta name="twitter:image:alt" content="${escapeAttr(card.alt)}">`,
    ].map((tag) => `  ${tag}`).join("\n");

    html = html.replace("</head>", `${tags}\n</head>`);
    fs.writeFileSync(file, html);
    canonicals += 1;
  }
  console.log(`social: ${cards.size} routes stamped with OG/Twitter metadata`);

  const urls = Object.values(ROUTES)
    .map((route) => `  <url><loc>${ORIGIN}${route}</loc></url>`)
    .join("\n");
  fs.writeFileSync(
    path.join(ROOT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
  fs.writeFileSync(
    path.join(ROOT, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`
  );
  console.log(`canonical: ${canonicals} pages at ${ORIGIN}, sitemap and robots.txt written`);
} else {
  // Anything that is not the production deploy stays out of search entirely.
  fs.writeFileSync(path.join(ROOT, "robots.txt"), "User-agent: *\nDisallow: /\n");
  console.log(`context "${CONTEXT}": canonicals skipped, robots.txt set to disallow`);
}
