// All SQLite access for jobs lives here. Nothing else should touch the
// database directly — api routes and worker.js both go through this module.
//
// A job is an ORDERED SEQUENCE of attempts, not a single hashcat run. Each
// step in the queue is a { wordlist, rule } pair (rule may be null for a
// plain run). The worker advances through the steps until one attempt cracks
// the hash, or the queue is exhausted.

const db = require("./db");

function rowToJob(row) {
  if (!row) return null;
  return {
    ...row,
    stepQueue: JSON.parse(row.step_queue),
    attempts: JSON.parse(row.attempts),
  };
}

function createJob({ hash, mode, modeSource, stepQueue }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO jobs (hash, mode, mode_source, step_queue, status, attempts, created_at, updated_at)
    VALUES (@hash, @mode, @modeSource, @stepQueue, 'queued', '[]', @now, @now)
  `);
  const info = stmt.run({
    hash,
    mode,
    modeSource,
    stepQueue: JSON.stringify(stepQueue),
    now,
  });
  return getJob(info.lastInsertRowid);
}

function getJob(id) {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  return rowToJob(row);
}

function listJobs() {
  const rows = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all();
  return rows.map(rowToJob);
}

// Used by the worker to grab the next job needing an attempt run.
// Picks the oldest job that's still queued or mid-sequence (running).
function claimNextJob() {
  const claim = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM jobs
         WHERE status IN ('queued', 'running')
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get();
    if (!row) return null;
    db.prepare(
      `UPDATE jobs SET status = 'running', updated_at = @now WHERE id = @id`
    ).run({ id: row.id, now: new Date().toISOString() });
    return getJob(row.id);
  });
  return claim();
}

// Record the outcome of one attempt (one step tried against one job).
// Advances the job to the next step, or finishes it as done/failed.
function recordAttemptResult(id, { wordlist, rule, cracked, plaintext, startedAt, finishedAt }) {
  const job = getJob(id);
  if (!job) return;

  const attempts = [
    ...job.attempts,
    { wordlist, rule: rule || null, outcome: cracked ? "cracked" : "exhausted", startedAt, finishedAt },
  ];
  const now = new Date().toISOString();

  if (cracked) {
    db.prepare(
      `UPDATE jobs SET status = 'done', result = @result, attempts = @attempts, updated_at = @now WHERE id = @id`
    ).run({ id, result: plaintext, attempts: JSON.stringify(attempts), now });
    return;
  }

  const nextIndex = job.current_step_index + 1;
  if (nextIndex < job.stepQueue.length) {
    // more steps left to try — stays "running", worker will pick it up again
    db.prepare(
      `UPDATE jobs SET current_step_index = @nextIndex, attempts = @attempts, updated_at = @now WHERE id = @id`
    ).run({ id, nextIndex, attempts: JSON.stringify(attempts), now });
  } else {
    // step queue exhausted, nothing cracked it
    db.prepare(
      `UPDATE jobs SET status = 'failed', attempts = @attempts, updated_at = @now WHERE id = @id`
    ).run({ id, attempts: JSON.stringify(attempts), now });
  }
}

// Delete one job. Returns true if a row was removed. Safe to call on a job
// that's mid-run: the worker's recordAttemptResult no-ops when the row is gone.
function deleteJob(id) {
  return db.prepare("DELETE FROM jobs WHERE id = ?").run(id).changes > 0;
}

// Delete every job. Returns how many rows were removed.
function deleteAllJobs() {
  return db.prepare("DELETE FROM jobs").run().changes;
}

module.exports = {
  createJob,
  getJob,
  listJobs,
  claimNextJob,
  recordAttemptResult,
  deleteJob,
  deleteAllJobs,
};
