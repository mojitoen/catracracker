#!/usr/bin/env node
// Integration test harness for CatraCracker.
//
// Generates hashes from KNOWN plaintexts across the full case matrix, submits
// them through the running API, polls each job to a terminal state, and checks
// the actual outcome against what we expect. Prints a pass/fail table and
// exits non-zero if anything failed — so it doubles as a regression check.
//
// Prerequisites (on the machine running the server/worker):
//   - server.js and worker.js both running
//   - wordlists/rockyou.txt and wordlists/ctf-custom.txt present
//   - rules/best64.rule present
//   - openssl on PATH (used here to generate the *crypt test hashes)
//
// Run:  node test/harness.js
// Target a remote server:  CATRACRACKER_API_URL=http://cracken:3000 node test/harness.js
//
// Note: the cases are chosen to crack EARLY or exhaust a SMALL list, so the
// suite stays fast on any hardware. The only full-rockyou scans are on MD5
// (pivot / failed / NTLM-auto cases), which is cheap even on CPU.

const crypto = require("crypto");

const API_URL = process.env.CATRACRACKER_API_URL || "http://localhost:3000";
const JOB_TIMEOUT_MS = 180000; // generous ceiling per job
const POLL_MS = 500;

// ---- hash sources ----
// Bare-hex hashes are generated fresh from the plaintext with built-in crypto.
const bareHex = {
  md5: (pw) => crypto.createHash("md5").update(pw).digest("hex"),
  sha1: (pw) => crypto.createHash("sha1").update(pw).digest("hex"),
  sha256: (pw) => crypto.createHash("sha256").update(pw).digest("hex"),
  sha512: (pw) => crypto.createHash("sha512").update(pw).digest("hex"),
};

// Salted hashes are hardcoded known-good vectors, so the harness needs no
// runtime openssl/bcrypt. Each is a valid hash of the noted plaintext;
// hashcat recovers it regardless of the embedded salt.
const salted = [
  { type: "md5crypt", password: "abc123", hash: "$1$Da/UvHnt$7liCFg7S4.JgM7ooI38pe1" },
  { type: "sha256crypt", password: "qwerty", hash: "$5$jStXbrxNG2PNT.Nm$ZgvIKTDwLM.ImCi9oLynh9g9djQel7hKz3j/6M.J5/4" },
  { type: "sha512crypt", password: "123456", hash: "$6$Dus/URcaAN7l/4a4$vuJI.lDI778QlKDp3SosC8nOoD6aPtGMW6Qqu3rw9neNRD0VV.QrBeKPmggebf2mJsYLeHrdz0PdPxEd2aRJa1" },
  { type: "bcrypt", password: "letmein", hash: "$2b$10$mzMymUn/bFAeYV3m/pjpT.4/sDsUbqh7R4E63.X4mMKGHD7ZCdOaW" },
];

// NTLM("password") — hardcoded well-known vector (Node/OpenSSL 3 often lack MD4).
const NTLM_PASSWORD = "8846f7eaee8fb117ad06bdd830b7586c";

// ---- tiny HTTP helpers ----
async function postJob(body) {
  const res = await fetch(`${API_URL}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function postRaw(raw) {
  // For malformed-JSON testing: send a body that isn't valid JSON.
  const res = await fetch(`${API_URL}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
  return { status: res.status };
}
async function getJob(id) {
  const res = await fetch(`${API_URL}/jobs/${id}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- crack cases: submit -> poll to terminal -> compare ----
function buildCrackCases() {
  const cases = [];

  // A. every registered format, salted + unsalted, cracking a top-of-rockyou pw.
  const unsaltedPw = { md5: "password", sha1: "iloveyou", sha256: "monkey", sha512: "princess" };
  for (const [type, pw] of Object.entries(unsaltedPw)) {
    cases.push({
      label: `format ${type} (auto-detect + crack)`,
      submit: { hash: bareHex[type](pw), wordlist: "rockyou" },
      expect: { status: "done", result: pw, modeSource: "auto" },
    });
  }
  for (const v of salted) {
    cases.push({
      label: `format ${v.type} (auto-detect + crack)`,
      submit: { hash: v.hash, wordlist: "rockyou" },
      expect: { status: "done", result: v.password, modeSource: "auto" },
    });
  }

  // B. explicit mode override -> mode_source manual.
  cases.push({
    label: "explicit --mode 0 (mode_source manual)",
    submit: { hash: bareHex.md5("dragon"), mode: 0, wordlist: "rockyou" },
    expect: { status: "done", result: "dragon", modeSource: "manual" },
  });

  // C. wordlist pivot: pw only in ctf-custom (2nd in the default chain).
  cases.push({
    label: "pivot: default chain, pw only in ctf-custom (2 attempts)",
    submit: { hash: bareHex.md5("Kr@kenP00l_pivot") },
    expect: { status: "done", result: "Kr@kenP00l_pivot", attempts: 2 },
  });

  // D. special-char password survives the temp-file round-trip.
  cases.push({
    label: "special chars (!@digits) round-trip intact",
    submit: { hash: bareHex.md5("Catracracker2026!"), wordlist: "ctf-custom" },
    expect: { status: "done", result: "Catracracker2026!" },
  });

  // E. rule crack: uppercase form reachable ONLY via best64's 'u' rule.
  cases.push({
    label: "rule best64: crack reachable only with the rule",
    submit: { hash: bareHex.md5("CRACKEN_GPU_BOX"), wordlist: "ctf-custom", rule: "best64" },
    expect: { status: "done", result: "CRACKEN_GPU_BOX" },
  });

  // F. control for E: same hash, no rule -> must fail (proves the rule did it).
  cases.push({
    label: "rule control: same hash, no rule -> fail",
    submit: { hash: bareHex.md5("CRACKEN_GPU_BOX"), wordlist: "ctf-custom" },
    expect: { status: "failed", result: null },
  });

  // G. failed path: plaintext in no wordlist (default chain).
  cases.push({
    label: "failed: not in any wordlist",
    submit: { hash: bareHex.md5("zzNope_" + Date.now()) },
    expect: { status: "failed", result: null },
  });

  // H. error path: unknown wordlist -> step errors -> job fails (not stuck).
  cases.push({
    label: "error: unknown wordlist -> fail",
    submit: { hash: bareHex.md5("password"), wordlist: "does-not-exist" },
    expect: { status: "failed", result: null },
  });

  // I. error path: unknown rule -> step errors -> job fails.
  cases.push({
    label: "error: unknown rule -> fail",
    submit: { hash: bareHex.md5("password"), wordlist: "rockyou", rule: "does-not-exist" },
    expect: { status: "failed", result: null },
  });

  // J. NTLM/MD5 ambiguity (known gap): auto picks MD5 and fails...
  cases.push({
    label: "NTLM auto-detect -> MD5 (known gap, expect fail)",
    submit: { hash: NTLM_PASSWORD },
    expect: { status: "failed", result: null },
  });
  // ...but explicit mode 1000 cracks it.
  cases.push({
    label: "NTLM explicit --mode 1000 -> crack",
    submit: { hash: NTLM_PASSWORD, mode: 1000, wordlist: "rockyou" },
    expect: { status: "done", result: "password" },
  });

  return cases;
}

function checkCrack(c, job) {
  if (!job) return "no job body returned";
  if (job.status !== c.expect.status) return `status ${job.status} != ${c.expect.status}`;
  if (job.result !== c.expect.result) return `result ${JSON.stringify(job.result)} != ${JSON.stringify(c.expect.result)}`;
  if (c.expect.modeSource && job.mode_source !== c.expect.modeSource)
    return `mode_source ${job.mode_source} != ${c.expect.modeSource}`;
  if (c.expect.attempts && job.attempts.length !== c.expect.attempts)
    return `attempts ${job.attempts.length} != ${c.expect.attempts}`;
  return null; // pass
}

async function pollToTerminal(id) {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { body } = await getJob(id);
    if (body && (body.status === "done" || body.status === "failed")) return body;
    await sleep(POLL_MS);
  }
  return null; // timed out
}

// ---- API-surface cases: assert HTTP status codes directly ----
async function runApiCases() {
  const checks = [
    { label: "POST no hash -> 400", run: () => postJob({}), want: 400 },
    { label: "POST unrecognized hash -> 422", run: () => postJob({ hash: "not-a-hash" }), want: 422 },
    { label: "GET missing job -> 404", run: () => getJob(999999), want: 404 },
    { label: "POST malformed JSON -> 400", run: () => postRaw("{ this is not json"), want: 400 },
  ];
  const results = [];
  for (const chk of checks) {
    let pass = false, detail = "";
    try {
      const { status } = await chk.run();
      pass = status === chk.want;
      detail = pass ? "" : `got ${status}`;
    } catch (e) {
      detail = `threw: ${e.message}`;
    }
    results.push({ label: chk.label, pass, detail });
  }
  return results;
}

async function main() {
  console.log(`CatraCracker test harness -> ${API_URL}\n`);

  // Submit all crack cases up front (also exercises the queue under a batch),
  // then poll them all to completion.
  const cases = buildCrackCases();
  console.log(`Submitting ${cases.length} crack cases...`);
  const submitted = [];
  for (const c of cases) {
    const { status, body } = await postJob(c.submit);
    if (status !== 201 || !body || !body.id) {
      submitted.push({ c, id: null, submitError: `submit HTTP ${status}` });
    } else {
      submitted.push({ c, id: body.id });
    }
  }

  console.log("Waiting for jobs to finish...\n");
  const started = Date.now();
  const crackResults = [];
  for (const s of submitted) {
    if (!s.id) {
      crackResults.push({ label: s.c.label, pass: false, detail: s.submitError, ms: 0 });
      continue;
    }
    const t0 = Date.now();
    const job = await pollToTerminal(s.id);
    const ms = Date.now() - t0;
    const fail = job ? checkCrack(s.c, job) : "timed out";
    crackResults.push({ label: s.c.label, pass: !fail, detail: fail || "", ms });
  }

  const apiResults = await runApiCases();

  // ---- report ----
  const line = (r) =>
    `  ${r.pass ? "PASS" : "FAIL"}  ${r.label.padEnd(52)} ${r.ms != null ? `${String(r.ms).padStart(6)}ms` : ""}  ${r.detail}`;
  console.log("Crack cases:");
  crackResults.forEach((r) => console.log(line(r)));
  console.log("\nAPI-surface cases:");
  apiResults.forEach((r) => console.log(line({ ...r, ms: null })));

  const all = [...crackResults, ...apiResults];
  const passed = all.filter((r) => r.pass).length;
  console.log(`\n${passed}/${all.length} passed  (crack wall time ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  process.exit(passed === all.length ? 0 : 1);
}

main().catch((e) => {
  console.error("harness error:", e.message);
  process.exit(2);
});
