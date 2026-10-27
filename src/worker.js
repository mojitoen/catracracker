// Runs on Cracken, alongside server.js (separate process).
// Polls the DB for jobs needing an attempt and runs them through the
// hashcat driver, one step at a time.
//
// A job is a SEQUENCE of steps, each a { wordlist, rule } pair. Each tick
// runs exactly one step — the one at the job's current index — then records
// the result, which either advances the job to the next step (status stays
// 'running', so it gets re-claimed next tick) or finalizes it ('done' if
// cracked, 'failed' if the queue is exhausted).
//
// Single job at a time for now. Using all 4 GPUs concurrently is future
// work (would mean claiming/running several jobs in parallel here).

const jobs = require("./jobs");
const driver = require("./driver");
const { resolveWordlist } = require("./wordlists");
const { resolveRule } = require("./rules");

const POLL_INTERVAL_MS = 2000;

// Guards against overlapping ticks: a hashcat run takes far longer than the
// poll interval, and we don't want a second tick claiming work while the
// first is still running.
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const job = await claimAndRun();
    // If a job was handled, poll again immediately rather than waiting the
    // full interval — keeps the queue draining quickly when it's backed up.
    if (job) setImmediate(tick);
  } catch (err) {
    console.error("worker tick error:", err.message);
  } finally {
    busy = false;
  }
}

// Describes a step for log lines, e.g. 'rockyou' or 'rockyou +best64'.
function stepLabel(step) {
  return step.rule ? `${step.wordlist} +${step.rule}` : step.wordlist;
}

// Claims the next job needing work and runs ONE step against it.
// Returns the job if one was handled, or null if the queue was empty.
async function claimAndRun() {
  const job = jobs.claimNextJob();
  if (!job) return null; // nothing to do

  const step = job.stepQueue[job.current_step_index];
  const startedAt = new Date().toISOString();
  console.log(`job ${job.id}: trying ${stepLabel(step)} (mode ${job.mode})`);

  let cracked = false;
  let plaintext = null;
  let errored = false;
  try {
    const wordlistPath = resolveWordlist(step.wordlist);
    const rulePath = step.rule ? resolveRule(step.rule) : null;
    ({ cracked, plaintext } = await driver.runHashcat({
      hash: job.hash,
      mode: job.mode,
      wordlistPath,
      rulePath,
    }));
  } catch (err) {
    // A failed step (unknown wordlist/rule, hashcat error) counts as
    // "didn't crack it" so the job advances to the next step, or fails out
    // if this was the last one — rather than getting stuck 'running' and
    // re-claimed forever.
    errored = true;
    console.error(`job ${job.id}: step errored on ${stepLabel(step)}:`, err.message);
  }

  jobs.recordAttemptResult(job.id, {
    wordlist: step.wordlist,
    rule: step.rule,
    cracked,
    plaintext,
    startedAt,
    finishedAt: new Date().toISOString(),
  });

  // Narrate the outcome so the log never goes silent: every step prints a
  // result line, and a job that runs out of steps prints a FAILED line.
  const wasLastStep = job.current_step_index + 1 >= job.stepQueue.length;
  if (cracked) {
    console.log(`job ${job.id}: CRACKED => ${plaintext}`);
  } else if (!errored) {
    console.log(`job ${job.id}: exhausted ${stepLabel(step)} (no crack)`);
  }
  if (!cracked && wasLastStep) {
    console.log(`job ${job.id}: FAILED — all ${job.stepQueue.length} step(s) exhausted`);
  }
  return job;
}

function startWorker() {
  console.log("catracracker worker started, polling for jobs...");
  setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { startWorker };

// Run standalone when invoked directly; when required by app.js (combined
// mode) it's started explicitly there instead.
if (require.main === module) {
  startWorker();
}
