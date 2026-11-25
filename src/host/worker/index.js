// src/host/worker/index.js
// 10ms host · worker entry. fetch() nhận request, route theo `on` (Worker)
// hoặc `page` (Web). KHÔNG tự parse — chỉ nhận AST từ lõi. P1 · P4 · P7 · D16.
// `scheduled()` phục vụ `on every 1h` (Cloudflare cron trigger).

const { createLog }     = require('./log');
const { createEffects } = require('./effects');
const { runOn, renderPage, execStmt } = require('./run');

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function htmlResponse(html, status) {
  return new Response(html, {
    status: status || 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

// Restore only declared user inputs from the form; internal fields remain reserved (P4).
function collectInputs(statements, names) {
  for (const s of statements) {
    if (s.type === 'Input') names.add(s.var);
    if (s.type === 'Each') collectInputs(s.body, names);
  }
}

function createWorker({ ast, seed, store }) {
  const log = createLog();
  const fx  = createEffects(log, store instanceof Map ? store : new Map(), seed || 0);
  const S   = seed || 0;

  function findRoute(method, path) {
    for (const n of ast.body) {
      if (n.type !== 'On') continue;
      if (n.method === method && n.path === path) return n;
    }
    return null;
  }

  function findPage(path) {
    for (const n of ast.body) {
      if (n.type === 'Page' && (n.path || '/') === path) return n;
    }
    return null;
  }

  async function readBody(request) {
    const ct = (request.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('json')) return {};
    try { return await request.json(); }
    catch (_) { return {}; }
  }

  // Apply a native form submission to the page AST and return its next state (P3, P4, P7).
  async function processPage(request, page) {
    const ctx = {
      env: new Map(), fx, log, body: {}, response: null, seed: S,
      preserveState: false,
    };
    if (request.method === 'GET') return htmlResponse(renderPage(page, ctx));

    let form;
    try { form = await request.formData(); }
    catch (_) {
      return jsonResponse({ error: 'web', pos: { line: 1, col: 1 },
        expected: 'a submitted page form', fix: 'submit the page form with its button', seed: S }, 400);
    }
    const stateText = form.get('__state');
    let state;
    try { state = typeof stateText === 'string' ? JSON.parse(stateText) : null; }
    catch (_) { state = null; }
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return jsonResponse({ error: 'web', pos: { line: 1, col: 1 },
        expected: 'page state as an object', fix: 'submit the page form without editing __state', seed: S }, 400);
    }

    ctx.env = new Map(Object.entries(state));
    const inputNames = new Set();
    collectInputs(page.body, inputNames);
    for (const name of inputNames) {
      const value = form.get(name);
      if (typeof value === 'string') ctx.env.set(name, value);
    }
    ctx.preserveState = true;

    // Render once to bind the submitted button to its AST body (D16).
    renderPage(page, ctx);
    const buttonValue = form.get('__btn');
    const buttonIndex = typeof buttonValue === 'string' ? Number(buttonValue) : -1;
    const button = Number.isInteger(buttonIndex) && buttonIndex >= 0
      ? ctx.buttons[buttonIndex] : null;
    if (!button) {
      return jsonResponse({ error: 'web', pos: { line: 1, col: 1 },
        expected: 'a button from the submitted page', fix: 'click a page button to submit', seed: S }, 400);
    }

    ctx.env = button.env;
    for (const statement of button.body) execStmt(statement, ctx);
    return htmlResponse(renderPage(page, ctx));
  }

  // Convert D13 runtime failures into stable HTTP JSON rather than leaking exceptions (P8).
  async function handlePage(request, page) {
    try { return await processPage(request, page); }
    catch (e) {
      if (e && e.detail) return jsonResponse(e.detail, 400);
      return jsonResponse({ error: 'internal', message: String(e && e.message) }, 500);
    }
  }

  async function fetch(request) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = url.pathname;

    // 1. Route Worker
    const on = findRoute(method, path);
    if (on) {
      const body = (method === 'POST' || method === 'PUT' || method === 'PATCH')
        ? await readBody(request)
        : {};
      const ctx = {
        env: new Map([['body', body]]),
        fx, log, body, response: null, seed: S,
      };
      try {
        const result = runOn(on, ctx);
        return jsonResponse(result);
      } catch (e) {
        if (e && e.detail) return jsonResponse(e.detail, 400);
        return jsonResponse({ error: 'internal', message: String(e && e.message) }, 500);
      }
    }

    // 2. Page (Web)
    if (method === 'GET' || method === 'POST') {
      const page = findPage(path);
      if (page) return handlePage(request, page);
    }

    return jsonResponse({ error: 'not_found', method, path }, 404);
  }

  // `on every` — Cloudflare cron trigger gọi scheduled
  async function scheduled(_event) {
    const results = [];
    for (const n of ast.body) {
      if (n.type === 'On' && n.every) {
        const ctx = { env: new Map(), fx, log, body: {}, response: null, seed: S };
        for (const s of n.body) execStmt(s, ctx);
        results.push({ every: n.every, ok: true });
      }
    }
    return results;
  }

  // Cho test truy cập
  return { fetch, scheduled, log, fx, store: fx.snapshotStore() };
}

module.exports = { createWorker };
