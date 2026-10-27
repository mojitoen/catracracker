// Guesses a hash's hashcat mode (-m value) from its shape (length, charset,
// prefix). Single best guess only — no attempt to run multiple modes per
// hash. If the guess is wrong, resubmit with an explicit `mode`.
//
// This is deliberately small: a handful of common CTF hash types, checked
// in order from most specific (distinctive prefix) to least specific
// (bare hex of a given length). Add more rows as you actually hit them —
// resist pre-building an exhaustive table nobody asked for yet.

const RULES = [
  // [name, hashcat mode, test function]
  ["bcrypt", 3200, (h) => /^\$2[aby]?\$/.test(h)],
  ["sha512crypt", 1800, (h) => h.startsWith("$6$")],
  ["sha256crypt", 7400, (h) => h.startsWith("$5$")],
  ["md5crypt", 500, (h) => h.startsWith("$1$")],
  ["NTLM", 1000, (h) => /^[a-f0-9]{32}$/i.test(h) && false], // see note below
  ["MD5", 0, (h) => /^[a-f0-9]{32}$/i.test(h)],
  ["SHA1", 100, (h) => /^[a-f0-9]{40}$/i.test(h)],
  ["SHA256", 1400, (h) => /^[a-f0-9]{64}$/i.test(h)],
  ["SHA512", 1700, (h) => /^[a-f0-9]{128}$/i.test(h)],
];

/**
 * @param {string} hash
 * @returns {{ name: string, mode: number } | null}
 */
function detectMode(hash) {
  const trimmed = hash.trim();
  for (const [name, mode, test] of RULES) {
    if (test(trimmed)) return { name, mode };
  }
  return null;
}

// The modes we know by name — handy for a UI dropdown or `GET /modes`.
// Sorted by mode number for a tidy list. NTLM is included (so it can be picked
// explicitly) even though it's not auto-detected — see the note below.
function knownModes() {
  return RULES.map(([name, mode]) => ({ name, mode })).sort((a, b) => a.mode - b.mode);
}

module.exports = { detectMode, knownModes };

// NOTE on the NTLM row above: a bare 32-char hex string is ambiguous
// between MD5 and NTLM — same shape, no way to tell from the string
// alone. It's listed here (disabled, `&& false`) as a reminder that this
// is a real gap, not an oversight. For now MD5 wins ambiguous cases
// since it's more common in CTFs; if you know a hash is NTLM, pass
// `mode: 1000` explicitly on submit.
