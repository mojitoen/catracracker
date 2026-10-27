// The API server. Runs on Cracken. Clients (your laptop, the CLI) talk
// to this over HTTP — no direct DB or hashcat access from clients.

const express = require("express");
const path = require("path");
const fs = require("fs");
const config = require("./config");
const jobs = require("./jobs");
const hashid = require("./hashid");
const wordlists = require("./wordlists");

const app = express();
app.use(express.json());

// Serve the simple web UI (public/index.html) at /. Static files that don't
// exist fall through to the API routes below, so GET /jobs still works.
app.use(express.static(path.join(__dirname, "../public")));

// Create a new job. Only `hash` is required — mode and wordlist are
// auto-detected/auto-selected when omitted, so the simplest possible
// submission is just: { "hash": "..." }
//
// Optional fields:
//   mode     — hashcat mode number (otherwise auto-detected)
//   wordlist — a single wordlist name (otherwise the default pivot chain)
//   rule     — a single rule name applied to every step (otherwise none)
app.post("/jobs", (req, res) => {
  const { hash, mode, wordlist, wordlists: chain, rule } = req.body;
  if (!hash) {
    return res.status(400).json({ error: "hash is required" });
  }

  let resolvedMode = mode;
  let modeSource = "manual";
  if (resolvedMode === undefined) {
    const guess = hashid.detectMode(hash);
    if (!guess) {
      return res.status(422).json({
        error: "could not auto-detect hash mode; pass an explicit `mode`",
      });
    }
    resolvedMode = guess.mode;
    modeSource = "auto";
  }

  // Choose the wordlist chain (tried in order): an explicit `wordlists` array
  // wins, then a single `wordlist`, then the server's default pivot chain.
  const chosen =
    Array.isArray(chain) && chain.length ? chain
    : wordlist ? [wordlist]
    : wordlists.DEFAULT_CHAIN;

  // Each step is a { wordlist, rule } pair. A rule (if given) applies to
  // every step; null means a plain run.
  const stepQueue = chosen.map((w) => ({ wordlist: w, rule: rule || null }));

  const job = jobs.createJob({ hash, mode: resolvedMode, modeSource, stepQueue });
  res.status(201).json(job);
});

// `?simple` renders a cracked job as a plain `hash:password` line (empty if not
// cracked), so `curl host/jobs?simple` is the recovered-creds export — the same
// thing `cli status --simple` does, now server-side.
function simpleLine(job) {
  return job.status === "done" && job.result != null ? `${job.hash}:${job.result}` : "";
}

// Fetch one job's status/result.
app.get("/jobs/:id", (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  if (req.query.simple !== undefined) return res.type("text").send(simpleLine(job) + "\n");
  res.json(job);
});

// List all jobs, most recent first.
app.get("/jobs", (req, res) => {
  const all = jobs.listJobs();
  if (req.query.simple !== undefined) {
    const lines = all.map(simpleLine).filter(Boolean);
    return res.type("text").send(lines.length ? lines.join("\n") + "\n" : "");
  }
  res.json(all);
});

// Delete every job (clears the history). Returns how many were removed.
app.delete("/jobs", (req, res) => {
  res.json({ deleted: jobs.deleteAllJobs() });
});

// Delete one job.
app.delete("/jobs/:id", (req, res) => {
  if (!jobs.deleteJob(req.params.id)) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

// List the hashcat modes we know by name (for the UI mode dropdown).
app.get("/modes", (req, res) => {
  res.json({ modes: hashid.knownModes() });
});

// List available wordlists (names) plus the default pivot chain.
app.get("/wordlists", (req, res) => {
  res.json({ wordlists: wordlists.list(), default: wordlists.DEFAULT_CHAIN });
});

// Upload a wordlist. The file's bytes are the request body (streamed straight
// to disk, so large lists don't buffer in memory); the name comes from ?name.
//   curl -X POST "host/wordlists?name=mylist" -H 'Content-Type: text/plain' --data-binary @mylist.txt
app.post("/wordlists", (req, res) => {
  const name = req.query.name;
  if (!wordlists.isValidName(name)) {
    return res.status(400).json({ error: "invalid or missing ?name (letters, digits, _ or -)" });
  }
  let dest;
  try {
    dest = wordlists.pathFor(name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const out = fs.createWriteStream(dest);
  out.on("error", (err) => res.status(500).json({ error: err.message }));
  out.on("finish", () => res.status(201).json({ name, bytes: out.bytesWritten }));
  req.on("error", () => out.destroy());
  req.pipe(out);
});

module.exports = app;

// Run standalone (API only — pair with `npm run worker`) when invoked directly.
// When required by app.js (combined mode) this block doesn't run.
if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`catracracker API listening on port ${config.port}`);
  });
}
