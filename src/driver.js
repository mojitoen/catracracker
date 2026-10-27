// Thin wrapper around the hashcat binary. This is the only file that
// shells out to a process — everything else deals with plain data.
//
// Takes a job's (hash, mode, wordlistPath), runs hashcat once against that
// one wordlist, and reports back whether it cracked and the plaintext if so.
// Side-effect-free from the caller's point of view: it owns its temp files
// start to finish, so jobs.js / worker.js never need to know how hashcat
// actually works.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const config = require("./config");

/**
 * Run hashcat against a single hash with a single wordlist, optionally
 * applying a rule file.
 * @param {{ hash: string, mode: number, wordlistPath: string, rulePath?: string|null }} params
 * @returns {Promise<{ cracked: boolean, plaintext: string|null }>}
 */
async function runHashcat({ hash, mode, wordlistPath, rulePath }) {
  // Everything for this run lives in one throwaway dir we delete at the end.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "catracracker-"));
  const hashFile = path.join(workDir, "hash.txt");
  const outFile = path.join(workDir, "cracked.txt");

  // hashcat wants the hash in a file, not on the command line.
  fs.writeFileSync(hashFile, hash + "\n");

  const args = [
    "-m", String(mode),
    "-a", "0", // straight (dictionary) attack
    hashFile,
    wordlistPath,
    "--potfile-disable",       // don't let a prior crack short-circuit this run
    "--outfile-format", "2",   // write ONLY the plaintext, so salted hashes
                               // with colons don't confuse parsing
    "-o", outFile,
    "--quiet",
  ];

  // Optional rule file (-r): mangles each wordlist candidate.
  if (rulePath) {
    args.push("-r", rulePath);
  }

  try {
    const { code, stderr } = await spawnHashcat(args);

    // hashcat exit codes: 0 = something cracked, 1 = exhausted (nothing
    // cracked). Both are normal completions. Anything else is a real error
    // (bad mode, missing wordlist, GPU problem) and should surface.
    if (code !== 0 && code !== 1) {
      throw new Error(
        `hashcat exited with code ${code}` + (stderr ? `: ${stderr.trim()}` : "")
      );
    }

    // The outfile is the source of truth: present and non-empty => cracked.
    let cracked = false;
    let plaintext = null;
    if (fs.existsSync(outFile)) {
      const contents = fs.readFileSync(outFile, "utf8");
      const firstLine = contents.split("\n").find((l) => l.length > 0);
      if (firstLine !== undefined) {
        cracked = true;
        // Only strip the trailing newline; keep any leading/inner whitespace
        // that's genuinely part of the password.
        plaintext = firstLine.replace(/\r$/, "");
      }
    }

    return { cracked, plaintext };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

// Spawns hashcat, collects stderr, resolves with { code, stderr } on exit.
// Rejects only if the process can't be spawned at all (e.g. binary missing).
function spawnHashcat(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.hashcatBin, args);
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    // Drain stdout so the pipe buffer can't fill and stall hashcat.
    proc.stdout.on("data", () => {});

    proc.on("error", (err) => {
      reject(
        new Error(
          `failed to run hashcat ("${config.hashcatBin}"): ${err.message}`
        )
      );
    });
    proc.on("close", (code) => {
      resolve({ code, stderr });
    });
  });
}

module.exports = { runHashcat };
