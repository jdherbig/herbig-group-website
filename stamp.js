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
