// src/host/worker/ship.js
// 10ms host · bind the checked source seal to Worker responses. P1 · P4 · P7 · D18.
const { createWorker } = require('./index');

// Expose the source identity without parsing or hashing on requests. P1 · P4 · D18.
function createSealedWorker(program) {
  const app = createWorker({ ast: program.ast, seed: program.seed, store: new Map() });
  return {
    // Add the build-time seal to every response so the runtime stays tied to its source. P4 · D18.
    async fetch(request) {
      const response = await app.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('x-10ms-seal', program.seal);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
    scheduled: app.scheduled,
  };
}

module.exports = { createSealedWorker };
