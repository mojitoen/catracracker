// Registry of known hashcat rule files, by friendly name. Mirrors
// wordlists.js: a rule is referenced by name and resolved to a file path on
// disk (rules aren't bundled — drop the .rule files in the rules dir, e.g.
// copy hashcat's own from /usr/share/hashcat/rules/).
//
// A rule file mangles each wordlist candidate (capitalize, leet, append
// digits, ...), so it multiplies a wordlist's reach. In CatraCracker a rule
// is the second half of a pivot STEP: each step is a { wordlist, rule } pair
// (rule may be null for a plain run). See jobs.js / worker.js.

const path = require("path");
const config = require("./config");

const REGISTRY = {
  best64: path.join(config.rulesDir, "best64.rule"),
  // Add more as needed, e.g.:
  // "d3ad0ne": path.join(config.rulesDir, "d3ad0ne.rule"),
  // "dive": path.join(config.rulesDir, "dive.rule"),
};

function resolveRule(name) {
  const filePath = REGISTRY[name];
  if (!filePath) {
    throw new Error(`Unknown rule "${name}". Known: ${Object.keys(REGISTRY).join(", ")}`);
  }
  return filePath;
}

module.exports = { REGISTRY, resolveRule };
