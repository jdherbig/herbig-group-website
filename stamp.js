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
const ORIGIN = (process.env.URL || "").replace(/\/+$/, "");
const CONTEXT = process.env.CONTEXT || "local";
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

if (IS_PRODUCTION) {
  let canonicals = 0;
  for (const [page, route] of Object.entries(ROUTES)) {
    const file = path.join(ROOT, page);
    if (!fs.existsSync(file)) continue;
    const href = ORIGIN + route;
    let html = fs.readFileSync(file, "utf8");
    html = html.replace(/\s*<link rel="canonical"[^>]*>/g, "");
    html = html.replace("</head>", `  <link rel="canonical" href="${href}">\n</head>`);
    fs.writeFileSync(file, html);
    canonicals += 1;
  }

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
