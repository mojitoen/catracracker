// Combined single-process entrypoint: serves the API + web UI AND runs the
// cracking worker in the same process. The simplest way to run CatraCracker on
// one machine — `npm run web`, then open http://localhost:3000.
//
// Why this is safe in one process: the heavy work (hashcat) runs in a CHILD
// process (see driver.js), so Node's single event loop stays free to serve
// HTTP while a crack is in progress. The API never blocks on cracking.
//
// For a multi-GPU box you may still prefer the split setup (`npm start` +
// `npm run worker`) — separate processes give crash isolation and let you run
// the API and the cracking engine on their own. Both modes share the exact
// same modules; this file just wires them into one process.

const app = require("./server"); // Express app (routes + static UI), not listening yet
const { startWorker } = require("./worker");
const config = require("./config");

startWorker();
app.listen(config.port, () => {
  console.log(`catracracker web + worker listening on http://localhost:${config.port}`);
});
