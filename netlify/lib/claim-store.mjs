/*
 * Herbig Group — the submission claim store (P9-04).
 *
 * This is deliberately a small, swappable module with an honest name for what
 * it actually provides, because the strength of de-duplication is the whole
 * question here and it should not be buried in the handler.
 *
 * WHAT THIS IS
 * ------------
 * An in-memory claim table, scoped to one warm function instance, with a TTL.
 *
 * WHAT IT COVERS
 * --------------
 * The duplicate that actually happens: a person double-clicks Submit, or the
 * response to their first attempt is lost and they press it again, or a flaky
 * connection retries. Those arrive within seconds of each other and land on
 * the same warm instance, so this stops them - and, just as importantly, it
 * catches the case where the SAME id arrives carrying DIFFERENT content, which
 * is a different inquiry wearing a stale id and must not be silently merged.
 *
 * WHAT IT DOES NOT COVER
 * ----------------------
 * Two requests that land on two different instances, or a retry that arrives
 * after this instance has been recycled. Those will produce two records. This
 * is a real limit and it is written down here rather than implied away.
 *
 * WHY NOT A DURABLE STORE
 * -----------------------
 * The durable answer is Netlify Blobs. It was written and then removed before
 * deploying, for one reason: this environment cannot reach the npm registry,
 * so @netlify/blobs could not be installed, its API could not be checked
 * against the real package, and no code path touching it could be executed
 * even once. Shipping it would have meant adding the site's first-ever
 * dependency, and a build-time `npm install`, on the strength of remembered
 * API shapes - with a failed install taking the whole deploy, and the live
 * site, down with it. A weaker guarantee that is tested beats a stronger one
 * that is assumed.
 *
 * WHAT A DURABLE STORE WOULD STILL NOT FIX
 * ----------------------------------------
 * Even with Blobs, the "did the store commit the lead before the response was
 * lost?" question is unanswerable from here, because Netlify Forms cannot be
 * read back without an API token. A durable claim table makes the UNCERTAIN
 * state survive across instances; it does not resolve it. Resolving it needs a
 * reconciliation read against the lead store.
 *
 * To upgrade: implement the same methods against Blobs (claim/confirm/release/
 * markUncertain), swap the export, and verify against a real deploy. Nothing
 * else in the function needs to change - that is why this boundary exists.
 */

const CLAIM_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 5000; // a hard ceiling so a flood cannot grow this forever

const claims = new Map();

function sweep(now) {
  for (const [key, entry] of claims) {
    if (now - entry.at >= CLAIM_TTL_MS) claims.delete(key);
  }
  // Map preserves insertion order, so this drops the oldest first.
  while (claims.size > MAX_ENTRIES) {
    const oldest = claims.keys().next();
    if (oldest.done) break;
    claims.delete(oldest.value);
  }
}

/**
 * Attempt to claim an id for this payload.
 *
 * Returns one of:
 *   { state: "claimed"   }  - first time; caller should proceed and confirm
 *   { state: "duplicate", receipt }  - same id, same content, and we KNOW the
 *                                     original reached the store
 *   { state: "uncertain" }  - same id, same content, but whether the original
 *                             reached the store is genuinely unknown
 *   { state: "conflict"  }  - same id, different content
 *
 * The claim is recorded BEFORE the caller forwards anything, so a second
 * request carrying the same id cannot also reach the form store. Within a
 * single instance this is genuinely exclusive: Node runs the check and the
 * write in one synchronous turn, with no await between them, so two
 * concurrent requests cannot interleave inside it.
 */
export function claim(key, fingerprint, receipt) {
  const now = Date.now();
  sweep(now);

  const existing = claims.get(key);
  if (existing && now - existing.at < CLAIM_TTL_MS) {
    if (existing.fingerprint === fingerprint) {
      if (existing.uncertain) return { state: "uncertain", receipt: existing.receipt };
      return { state: "duplicate", receipt: existing.receipt };
    }
    return { state: "conflict" };
  }

  // `receipt` is what the visitor is told, so it must be THEIR submission id
  // and never this table's internal namespaced key.
  claims.set(key, { at: now, fingerprint, receipt, forwarded: false, uncertain: false });
  return { state: "claimed" };
}

/** Mark a claim as having actually reached the store. */
export function confirm(key) {
  const entry = claims.get(key);
  if (entry) entry.forwarded = true;
}

/**
 * Release a claim whose forward was DEFINITIVELY rejected - the store answered,
 * and it answered no. There is no record, so the visitor's retry is a first
 * attempt. Only call this when the store actually replied; see markUncertain
 * for the case where it did not.
 */
export function release(key) {
  claims.delete(key);
}

/**
 * The ambiguous case, and the one that matters most.
 *
 * If the request to the store threw - a timeout, a dropped connection, a
 * response lost on the way back - then the store may have committed the lead
 * or may not have. We cannot tell, because we cannot read the store back.
 *
 * Both of the obvious moves are wrong:
 *   - releasing the claim risks a SECOND stored lead, because the first may
 *     already be in there
 *   - keeping it as a plain duplicate risks a LOST lead, because the retry
 *     would be told "already received" for something that never arrived
 *
 * So the claim is kept and flagged. A retry of the same content is answered
 * honestly - we could not confirm it, please use the email address - which
 * neither invents a duplicate nor swallows the inquiry, and leaves the person
 * with a route that works. That is the best answer available without the
 * ability to read the lead store back; see the header of this file.
 */
export function markUncertain(key) {
  const entry = claims.get(key);
  if (entry) entry.uncertain = true;
}

/** Test seam. */
export function _reset() {
  claims.clear();
}
