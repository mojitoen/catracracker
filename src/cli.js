#!/usr/bin/env node
// Thin client. Talks only to the HTTP API — run this from anywhere
// (your laptop during a CTF, or Cracken itself), no hashcat or DB
// needed locally.
//
// Mode and wordlist are optional: the server auto-detects the mode and
// falls back to its default wordlist chain when they're omitted, so the
// simplest submission is just `submit --hash <hash>`.

const { Command } = require("commander");

const API_URL = process.env.CATRACRACKER_API_URL || "http://localhost:3000";

const program = new Command();
program.name("catracracker").description("CLI client for the CatraCracker cracking server");

program
  .command("submit")
  .requiredOption("--hash <hash>", "the hash to crack")
  .option("--mode <mode>", "hashcat mode number, e.g. 0 for MD5 (auto-detected if omitted)", Number)
  .option("--wordlist <name>", "single wordlist name, e.g. rockyou (uses default chain if omitted)")
  .option("--wordlists <names>", "comma-separated wordlist chain, e.g. rockyou,ctf-custom (overrides --wordlist)")
  .option("--rule <name>", "rule name to apply to every step, e.g. best64 (none if omitted)")
  .action(async (opts) => {
    // Only send fields the user actually provided — the server treats a
    // missing mode/wordlist/rule as "figure it out for me".
    const body = { hash: opts.hash };
    if (opts.mode !== undefined) body.mode = opts.mode;
    if (opts.wordlists !== undefined) {
      body.wordlists = opts.wordlists.split(",").map((w) => w.trim()).filter(Boolean);
    } else if (opts.wordlist !== undefined) {
      body.wordlist = opts.wordlist;
    }
    if (opts.rule !== undefined) body.rule = opts.rule;

    const res = await fetch(`${API_URL}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const job = await res.json();
    if (!res.ok) {
      console.error(`submit failed (${res.status}):`, job.error || job);
      process.exitCode = 1;
      return;
    }
    console.log(job);
  });

program
  .command("status")
  .argument("<jobId>", 'a job id, or "all" for every job')
  .option("--simple", "print only cracked jobs as hash:password (pipe-friendly)")
  .action(async (jobId, opts) => {
    const url = jobId === "all" ? `${API_URL}/jobs` : `${API_URL}/jobs/${jobId}`;

    // --simple just forwards to the server's ?simple view (hash:password for
    // cracked jobs) — identical to `curl host/jobs?simple`.
    if (opts.simple) {
      const res = await fetch(`${url}?simple=1`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error(`status failed (${res.status}):`, body.error || res.statusText);
        process.exitCode = 1;
        return;
      }
      const text = (await res.text()).replace(/\n$/, "");
      if (text) console.log(text);
      return;
    }

    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) {
      console.error(`status failed (${res.status}):`, body.error || body);
      process.exitCode = 1;
      return;
    }
    console.log(body);
  });

program
  .command("wordlists")
  .description("list available wordlists and the default chain")
  .action(async () => {
    const res = await fetch(`${API_URL}/wordlists`);
    console.log(await res.json());
  });

program
  .command("list")
  .action(async () => {
    const res = await fetch(`${API_URL}/jobs`);
    console.log(await res.json());
  });

program.parseAsync();
