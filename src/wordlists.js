// Wordlists live as .txt files in the wordlists dir. A wordlist's NAME is its
// filename without the .txt extension (so wordlists/rockyou.txt -> "rockyou").
//
// The registry is the directory itself: list() scans it, so a wordlist
// uploaded at runtime (POST /wordlists) shows up immediately with no redeploy.
// Names are restricted to a safe character set so a name can never escape the
// wordlists dir (no "../", no slashes).

const fs = require("fs");
const path = require("path");
const config = require("./config");

const EXT = ".txt";
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

// Tried in this order when a job doesn't specify a wordlist. Keep
// cheap/likely-to-hit lists first — expensive ones are a last resort.
const DEFAULT_CHAIN = ["rockyou", "ctf-custom"];

function isValidName(name) {
  return typeof name === "string" && SAFE_NAME.test(name);
}

// Absolute path for a (validated) wordlist name — used for both reading and
// for the upload destination. Throws on an unsafe name.
function pathFor(name) {
  if (!isValidName(name)) {
    throw new Error(`Invalid wordlist name "${name}" (use letters, digits, _ or -)`);
  }
  return path.join(config.wordlistsDir, name + EXT);
}

// Names of every .txt wordlist currently in the dir, sorted.
function list() {
  let files;
  try {
    files = fs.readdirSync(config.wordlistsDir);
  } catch {
    return []; // dir doesn't exist yet
  }
  return files
    .filter((f) => f.endsWith(EXT))
    .map((f) => path.basename(f, EXT))
    .filter(isValidName)
    .sort();
}

function resolveWordlist(name) {
  const filePath = pathFor(name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Unknown wordlist "${name}". Known: ${list().join(", ")}`);
  }
  return filePath;
}

module.exports = { DEFAULT_CHAIN, isValidName, pathFor, list, resolveWordlist };
