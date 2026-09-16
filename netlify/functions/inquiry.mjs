/*
 * Herbig Group — inquiry submission boundary (P9-04 / P9-05 / P9-08).
 *
 * Why this exists at all: with native Netlify Forms the browser posts straight
 * to the form store, so "server-side validation" and "duplicate prevention"
 * had nowhere to live - a crafted POST bypassed every rule, and a submission
 * id could identify a duplicate but never prevent one. Both were recorded as
 * unmet in the Phase 9 report rather than papered over. This function is the
 * boundary that makes validation met, and duplicate prevention partly met
 * (see netlify/lib/claim-store.mjs, which states exactly what it does and does
 * not cover - it is bounded to one warm instance, and that limit is real).
 *
 * It does not replace Netlify Forms; it stands in front of it. A submission
 * that passes validation and de-duplication is forwarded to the form store, so
 * the dashboard, the spam quarantine and the email notification all keep
 * working exactly as they do now.
 *
 * It has no dependencies. That is deliberate: the site had none before this,
 * and a build-time `npm install` that fails takes the live site down with it.
 * Everything here is Node built-ins and files in this repository.
 *
 * Order matters: validate, then claim the id, then forward, then confirm. The
 * claim happens BEFORE the forward so two concurrent requests carrying the
 * same id cannot both reach the store.
 *
 * Afterwards there are three outcomes, not two, and the distinction is the
 * whole point:
 *   - the store answered OK        -> confirm the claim
 *   - the store answered NOT-OK    -> release it; there is definitively no
 *                                     record, so a retry is a first attempt
 *   - the store did not answer     -> flag it UNCERTAIN. Releasing here would
 *                                     risk a second stored lead; treating it
 *                                     as a duplicate would risk losing one.
 *                                     We say we could not confirm, and give
 *                                     the person an address that works.
 */
import {
  validateInquiry,
  payloadFingerprint,
  normalizeSubmissionId,
  FORMS,
} from "../lib/inquiry-contract.mjs";
import { claim, confirm, release, markUncertain } from "../lib/claim-store.mjs";

// Generous by design. This is an inquiry form for a company that currently
// receives very little traffic; the cost of turning away a real person is far
// higher than the cost of letting a little spam through to a filtered,
// reviewable store. Shared networks (an office, a co-working space, a
// university) share an address, so the limit has to tolerate a whole building.
//
// Like the claim table, this counter lives in one warm instance, so it is a
// speed bump rather than a guarantee. It is still worth having: a scripted
// flood comes from one source and mostly lands on one instance.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateCounters = new Map();

// Used wherever we genuinely cannot tell whether a lead was stored. It never
// claims receipt and never claims failure, and it always leaves the person a
// route that works.
const UNCONFIRMED_MESSAGE =
  "We could not confirm that your inquiry was received. Please email info@herbiggroup.com so nothing is missed.";

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
  });
}

function clientIp(req) {
  const fwd =
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for") ||
    "";
  return fwd.split(",")[0].trim() || "unknown";
}

function checkRateLimit(ip) {
  const now = Date.now();
  for (const [key, entry] of rateCounters) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) rateCounters.delete(key);
  }
  const existing = rateCounters.get(ip);
  if (existing && now - existing.windowStart < RATE_LIMIT_WINDOW_MS) {
    if (existing.count >= RATE_LIMIT_MAX) {
      return {
        allowed: false,
        retryAfter: Math.ceil(
          (existing.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000
        ),
      };
    }
    existing.count += 1;
    return { allowed: true };
  }
  rateCounters.set(ip, { windowStart: now, count: 1 });
  return { allowed: true };
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST" });
  }

  let raw;
  try {
    raw = Object.fromEntries(new URLSearchParams(await req.text()));
  } catch (e) {
    return json({ ok: false, error: "unreadable_body" }, 400);
  }

  const formName = typeof raw["form-name"] === "string" ? raw["form-name"] : "";
  if (!FORMS[formName]) {
    return json({ ok: false, error: "unknown_form" }, 400);
  }

  const rate = checkRateLimit(clientIp(req));
  if (!rate.allowed) {
    return json(
      {
        ok: false,
        error: "rate_limited",
        message:
          "Too many inquiries have been sent from this network recently. Please try again shortly, or email info@herbiggroup.com.",
      },
      429,
      { "Retry-After": String(rate.retryAfter) }
    );
  }

  // P9-05: the real enforcement point. A request that never ran our JS still
  // has to satisfy the same contract.
  const result = validateInquiry(formName, raw);
  if (!result.ok) {
    return json({ ok: false, error: "invalid", errors: result.errors }, 400);
  }

  const submissionId = normalizeSubmissionId(raw["submission-id"]);
  const fingerprint = payloadFingerprint(formName, result.values);

  /* P9-04: three outcomes, all deliberate.
   *  - same id, same content     -> the original receipt, no second record
   *    (an honest retry of a submission whose response was lost)
   *  - same id, different content -> 409, because that is a different inquiry
   *    wearing a stale id, and silently accepting it would lose one of them
   *  - new id                    -> claim it and forward
   */
  let claimKey = null;
  if (submissionId) {
    claimKey = `${formName}/${submissionId}`;
    const outcome = claim(claimKey, fingerprint, submissionId);
    if (outcome.state === "duplicate") {
      return json(
        {
          ok: true,
          duplicate: true,
          receipt: outcome.receipt,
          message: "This inquiry was already received.",
        },
        200
      );
    }
    if (outcome.state === "uncertain") {
      // A previous attempt with this id was sent to the store and the store
      // never answered. Answering "already received" could swallow a lead that
      // was never stored; answering "go ahead" could create a second one.
      return json(
        { ok: false, error: "unconfirmed", message: UNCONFIRMED_MESSAGE },
        409
      );
    }
    if (outcome.state === "conflict") {
      return json(
        {
          ok: false,
          error: "id_conflict",
          message:
            "This submission identifier has already been used for different content.",
        },
        409
      );
    }
  }

  // Forward the validated, trimmed values to Netlify Forms so the dashboard,
  // spam quarantine and notifications keep working unchanged. Only the fields
  // the contract accepts are forwarded - anything else a crafted POST added is
  // dropped here rather than stored.
  const forward = new URLSearchParams();
  forward.set("form-name", formName);
  if (submissionId) forward.set("submission-id", submissionId);
  for (const [field, value] of Object.entries(result.values)) {
    forward.set(field, value);
  }

  const origin = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!origin) {
    if (claimKey) release(claimKey);
    return json({ ok: false, error: "origin_unavailable" }, 500);
  }

  try {
    const res = await fetch(new URL("/", origin).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: forward.toString(),
    });
    if (!res.ok) {
      // The store ANSWERED, and answered no. There is definitively no record,
      // so the claim is released and a retry is a clean first attempt.
      if (claimKey) release(claimKey);
      return json({ ok: false, error: "store_rejected", status: res.status }, 502);
    }
  } catch (e) {
    /* The store did NOT answer. This is the case the review was right to press
     * on: Netlify may have committed the lead and lost the response on the way
     * back, in which case releasing the claim would let the retry create a
     * second stored lead. We cannot read the store back to find out, so we do
     * not pretend to know. The claim is kept and flagged uncertain, and both
     * this attempt and any retry get an answer that is true - we could not
     * confirm it - plus an address that works. */
    if (claimKey) markUncertain(claimKey);
    return json({ ok: false, error: "unconfirmed", message: UNCONFIRMED_MESSAGE }, 502);
  }

  if (claimKey) confirm(claimKey);

  return json(
    {
      ok: true,
      duplicate: false,
      receipt: submissionId || null,
      deduplicated: Boolean(claimKey),
    },
    200
  );
};

export const config = { path: "/api/inquiry" };
