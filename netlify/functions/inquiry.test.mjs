/*
 * Tests for the inquiry function itself — the real handler, not a stand-in.
 *
 * This is possible only because the function has no dependencies: the module
 * imports and runs under plain Node, so these exercise the exact code that
 * will run in production. The one thing stubbed is global fetch, which stands
 * in for the Netlify Forms store, because the assertion that matters most is
 * "how many times did anything actually reach the store".
 */
import handler from "./inquiry.mjs";
import { _reset } from "../lib/claim-store.mjs";

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) pass++;
  else failures.push(`${name}${detail === undefined ? "" : `  [${detail}]`}`);
}

process.env.URL = "https://www.example.com";

let forwarded = [];
let storeStatus = 200;
let storeThrows = false;
// "The store committed the lead, then the response was lost on the way back."
// This is the case the Phase 9 review pressed on, and it cannot be simulated
// by a plain network error: the record MUST land before the throw.
let storeCommitsThenThrows = false;
globalThis.fetch = async (url, init) => {
  if (storeCommitsThenThrows) {
    forwarded.push(Object.fromEntries(new URLSearchParams(init.body)));
    throw new Error("connection reset after commit");
  }
  if (storeThrows) throw new Error("network down");
  // Only a submission the store ACCEPTED counts as forwarded - recording a
  // rejected attempt would let a lost lead look like a delivered one.
  if (storeStatus >= 200 && storeStatus < 300) {
    forwarded.push(Object.fromEntries(new URLSearchParams(init.body)));
  }
  return new Response("ok", { status: storeStatus });
};

/* The rate limiter counts per address and is module-level, so it deliberately
 * survives _reset(). Every block therefore gets a fresh address; only the
 * rate-limit block pins one on purpose. */
let ipCounter = 0;
function nextIp() {
  return `203.0.113.${(ipCounter % 250) + 1}`;
}

function reset() {
  ipCounter++;
  forwarded = [];
  storeStatus = 200;
  storeThrows = false;
  storeCommitsThenThrows = false;
  _reset();
}

const CONTACT = {
  "form-name": "contact",
  name: "QA Harness",
  email: "qa@example.com",
  organization: "Herbig QA",
  message: "Function-level check.",
};

function req(fields, opts) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== null) params.set(k, v);
  return new Request("https://www.example.com/api/inquiry", {
    method: (opts && opts.method) || "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-nf-client-connection-ip": (opts && opts.ip) || nextIp(),
    },
    body: params.toString(),
  });
}

async function call(fields, opts) {
  const res = await handler(req(fields, opts));
  let body = null;
  try { body = JSON.parse(await res.clone().text()); } catch (e) { /* not json */ }
  return { status: res.status, body, headers: res.headers };
}

/* ---------- method ---------- */
reset();
let r = await handler(new Request("https://www.example.com/api/inquiry", { method: "GET" }));
check("GET is refused", r.status === 405, r.status);
check("GET advertises POST", r.headers.get("Allow") === "POST");

/* ---------- validation is enforced server-side ---------- */
reset();
r = await call({ ...CONTACT, email: "nope" });
check("bad email refused", r.status === 400 && r.body.errors.email, JSON.stringify(r.body));
check("refused submission never reached the store", forwarded.length === 0, forwarded.length);

r = await call({ ...CONTACT, name: "Acme\r\nBcc: attacker@example.com" });
check("CR/LF header injection refused", r.status === 400 && !!r.body.errors.name, JSON.stringify(r.body));

r = await call({ ...CONTACT, "form-name": "not-a-form" });
check("unknown form refused", r.status === 400 && r.body.error === "unknown_form", r.status);

r = await call({ ...CONTACT, organization: "x".repeat(201) });
check("over-length optional field refused", r.status === 400, r.status);
check("still nothing forwarded", forwarded.length === 0, forwarded.length);

/* ---------- the happy path forwards exactly the accepted fields ---------- */
reset();
r = await call({ ...CONTACT, "submission-id": "hg-fn-1", "evil-field": "payload", admin: "true" });
check("valid submission accepted", r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
check("forwarded exactly once", forwarded.length === 1, forwarded.length);
check("unknown fields dropped before the store",
  forwarded.length === 1 && !("evil-field" in forwarded[0]) && !("admin" in forwarded[0]),
  forwarded.length ? Object.keys(forwarded[0]).join(",") : "");
check("form-name preserved so routing still works",
  forwarded.length === 1 && forwarded[0]["form-name"] === "contact");
check("values arrive trimmed", forwarded.length === 1 && forwarded[0].name === "QA Harness");

/* ---------- duplicate prevention ---------- */
reset();
const a = await call({ ...CONTACT, "submission-id": "hg-fn-dup" });
const b = await call({ ...CONTACT, "submission-id": "hg-fn-dup" });
const c = await call({ ...CONTACT, "submission-id": "hg-fn-dup" });
check("first of three accepted", a.status === 200 && a.body.duplicate === false);
check("second reported as duplicate", b.status === 200 && b.body.duplicate === true, JSON.stringify(b.body));
check("third reported as duplicate", c.status === 200 && c.body.duplicate === true);
check("three identical submissions reached the store ONCE", forwarded.length === 1, forwarded.length);
check("the duplicate response carries the original receipt", b.body.receipt === "hg-fn-dup", b.body.receipt);

/* ---------- id reuse with different content ---------- */
r = await call({ ...CONTACT, "submission-id": "hg-fn-dup", message: "A different inquiry entirely." });
check("reused id with different content is a conflict", r.status === 409, r.status);
check("the conflicting inquiry was not stored", forwarded.length === 1, forwarded.length);

/* ---------- concurrency: the check and the claim share one synchronous turn ---------- */
reset();
const raced = await Promise.all([
  call({ ...CONTACT, "submission-id": "hg-fn-race" }),
  call({ ...CONTACT, "submission-id": "hg-fn-race" }),
  call({ ...CONTACT, "submission-id": "hg-fn-race" }),
  call({ ...CONTACT, "submission-id": "hg-fn-race" }),
]);
check("four concurrent identical submissions stored once", forwarded.length === 1, forwarded.length);
check("every concurrent caller got a success", raced.every((x) => x.status === 200),
  raced.map((x) => x.status).join("/"));
check("exactly one was told it was the original",
  raced.filter((x) => x.body.duplicate === false).length === 1,
  raced.map((x) => x.body.duplicate).join("/"));

/* ---------- a submission with no id is never treated as a duplicate ---------- */
reset();
await call(CONTACT);
await call(CONTACT);
check("two id-less submissions both stored (we cannot know they are duplicates)",
  forwarded.length === 2, forwarded.length);

/* ---------- a failed forward must RELEASE the claim ---------- */
reset();
storeStatus = 500;
r = await call({ ...CONTACT, "submission-id": "hg-fn-fail" });
check("a store rejection is reported as a failure, not receipt",
  r.status === 502 && r.body.ok === false, r.status);
storeStatus = 200;
r = await call({ ...CONTACT, "submission-id": "hg-fn-fail" });
check("the retry after a failed send is treated as a FIRST attempt, not a duplicate",
  r.status === 200 && r.body.duplicate === false, JSON.stringify(r.body));
check("and it actually reached the store", forwarded.length === 1, forwarded.length);

reset();
storeThrows = true;
r = await call({ ...CONTACT, "submission-id": "hg-fn-unreachable" });
check("an unreachable store is a 502, never a success", r.status === 502, r.status);
check("an unreachable store is unconfirmed, because we cannot tell whether it landed",
  r.body.error === "unconfirmed", JSON.stringify(r.body));
storeThrows = false;
r = await call({ ...CONTACT, "submission-id": "hg-fn-unreachable" });
// Deliberately NOT treated as a clean first attempt any more. A throw is
// indistinguishable from "stored, response lost", so re-sending could create a
// second lead. This assertion used to say the opposite; it was wrong.
check("retry after an unreachable store stays unconfirmed rather than re-sending",
  r.status === 409 && r.body.error === "unconfirmed", JSON.stringify(r.body));
check("and nothing was stored, because the store never accepted anything",
  forwarded.length === 0, forwarded.length);

/* ---------- THE LOST-RESPONSE CASE ----------
 * Netlify stored the lead; the response never came back. A retry must not
 * produce a second stored lead, and must not be told "already received"
 * either, because from here those two futures are indistinguishable. */
reset();
storeCommitsThenThrows = true;
r = await call({ ...CONTACT, "submission-id": "hg-fn-lost" });
check("a lost response is never reported as success", r.status !== 200, r.status);
check("a lost response is reported as unconfirmed, not as failure",
  r.body && r.body.error === "unconfirmed", JSON.stringify(r.body));
check("the unconfirmed message offers a route that works",
  /info@herbiggroup\.com/.test((r.body && r.body.message) || ""), r.body && r.body.message);
check("the lead did in fact reach the store", forwarded.length === 1, forwarded.length);

// The retry. This is the assertion the review asked for.
storeCommitsThenThrows = false;
r = await call({ ...CONTACT, "submission-id": "hg-fn-lost" });
check("RETRY AFTER A LOST RESPONSE DOES NOT STORE A SECOND LEAD",
  forwarded.length === 1, `${forwarded.length} stored`);
check("the retry is answered unconfirmed, not 'already received'",
  r.status === 409 && r.body.error === "unconfirmed", JSON.stringify(r.body));
check("the retry never claims the inquiry was received",
  !/received/i.test(JSON.stringify(r.body)) || /could not confirm/i.test(r.body.message || ""),
  JSON.stringify(r.body));

// And the contrast: a DEFINITIVE rejection must still release, because there
// genuinely is no record and refusing the retry would lose a real lead.
reset();
storeStatus = 500;
r = await call({ ...CONTACT, "submission-id": "hg-fn-definitive" });
check("a definitive rejection is a plain failure", r.status === 502 &&
  r.body.error === "store_rejected", JSON.stringify(r.body));
storeStatus = 200;
r = await call({ ...CONTACT, "submission-id": "hg-fn-definitive" });
check("the retry after a DEFINITIVE rejection does go through",
  r.status === 200 && r.body.duplicate === false, JSON.stringify(r.body));
check("and it stored exactly one lead", forwarded.length === 1, forwarded.length);

/* ---------- the limit this cannot cross ----------
 * Everything above holds within ONE warm instance. A fresh instance has an
 * empty claim table, so the same retry becomes a first attempt and a second
 * lead IS stored. This test exists to keep that limit visible and honest
 * rather than letting the suite imply a guarantee that is not there. */
reset();
storeCommitsThenThrows = true;
await call({ ...CONTACT, "submission-id": "hg-fn-coldstart" });
storeCommitsThenThrows = false;
_reset(); // stands in for the retry landing on a different/recycled instance
r = await call({ ...CONTACT, "submission-id": "hg-fn-coldstart" });
check("KNOWN GAP: on a different instance the retry DOES store a second lead",
  forwarded.length === 2 && r.status === 200,
  `${forwarded.length} stored - this is why cross-instance dedup is reported UNMET`);

/* ---------- rate limiting ---------- */
reset();
const ip = "198.51.100.77";
let limitedAt = -1;
for (let i = 0; i < 25; i++) {
  const res = await call({ ...CONTACT, "submission-id": `hg-fn-rl-${i}` }, { ip });
  if (res.status === 429) { limitedAt = i; break; }
}
check("rate limiting engages", limitedAt === 20, `limited at attempt ${limitedAt}`);
const rl = await call({ ...CONTACT, "submission-id": "hg-fn-rl-x" }, { ip });
check("rate-limited response carries Retry-After", !!rl.headers.get("Retry-After"),
  rl.headers.get("Retry-After"));
check("rate-limited response names the email as a way through",
  /info@herbiggroup\.com/.test(rl.body.message || ""), rl.body.message);
const other = await call({ ...CONTACT, "submission-id": "hg-fn-other" }, { ip: "198.51.100.78" });
check("a different address is unaffected", other.status === 200, other.status);

/* ---------- joint-venture form ---------- */
reset();
r = await call({
  "form-name": "joint-venture",
  company: "Acme Health",
  email: "qa@example.com",
  location: "Phoenix",
  message: "A 40,000 sq ft facility.",
  "submission-id": "hg-fn-jv",
});
check("joint-venture submissions are accepted", r.status === 200, JSON.stringify(r.body));
check("joint-venture routed to its own form",
  forwarded.length === 1 && forwarded[0]["form-name"] === "joint-venture");

/* ---------- forms are de-duplicated independently ---------- */
reset();
await call({ ...CONTACT, "submission-id": "shared-id" });
await call({
  "form-name": "joint-venture",
  company: "Acme Health",
  email: "qa@example.com",
  message: "Different form, same id.",
  "submission-id": "shared-id",
});
check("the same id on two different forms is not a duplicate", forwarded.length === 2, forwarded.length);

console.log(`\ninquiry function: ${pass}/${pass + failures.length} pass`);
failures.forEach((f) => console.log(`   FAIL  ${f}`));
process.exit(failures.length ? 1 : 0);
