// Single place for all environment-driven settings.
// Nothing else in the codebase should read process.env directly.

module.exports = {
  port: process.env.CATRACRACKER_PORT || 3000,
  dbPath: process.env.CATRACRACKER_DB_PATH || __dirname + "/../catracracker.db",
  hashcatBin: process.env.CATRACRACKER_HASHCAT_BIN || "hashcat",
  wordlistsDir: process.env.CATRACRACKER_WORDLISTS_DIR || __dirname + "/../wordlists",
  rulesDir: process.env.CATRACRACKER_RULES_DIR || __dirname + "/../rules",
};
