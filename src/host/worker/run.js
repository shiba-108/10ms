// src/host/worker/run.js
// 10ms host · run: AST → chạy thật. Page/Input/Btn/Each/Assign (Web)
// và On/Need/Reply/EffectCall (Worker). Thuần: chỉ gọi ctx.fx, không fetch/Date.
// P1 · P4 · P7 · D16.
const { MAX_ITER } = require('../../core/cost');

function d13(kind, line, expected, fix, seed) {
  const e = new Error(kind);
  e.detail = { error: kind, pos: { line: line || 1, col: 1 }, expected, fix, seed };
  return e;
}

// ---- kiểu runtime ----
function runtimeType(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string')  return 'text';
  if (typeof v === 'number')  return 'number';
  if (typeof v === 'boolean') return 'bool';
  if (Array.isArray(v))       return 'array';
  if (typeof v === 'object')  return 'object';
  return 'unknown';
}

function lookupPath(root, path) {
  const parts = String(path).split('.');
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || typeof cur !== 'object' || !(parts[i] in cur)) {
      return { found: false, at: parts.slice(0, i + 1).join('.') };
    }
    cur = cur[parts[i]];
  }
  return { found: true, value: cur };
}

// Keep dynamic host loops within the same bound used by the core proof (P1, D14).
function checkEachLimit(list, s, ctx) {
  if (list.length > MAX_ITER) {
    throw d13('cost', s.line,
      `each list has at most ${MAX_ITER} items`,
      `reduce each list to at most ${MAX_ITER} items`,
      ctx.seed === undefined ? 0 : ctx.seed);
  }
}

// ---- eval biểu thức ----
function evalExpr(n, ctx) {
  if (!n) return null;
  switch (n.type) {
    case 'Number': return n.value;
    case 'String': return n.value;
    case 'Var':    return ctx.env.has(n.name) ? ctx.env.get(n.name) : null;
    case 'Path': {
      const r = lookupPath(ctx.env.get(String(n.path).split('.')[0]), n.path.split('.').slice(1).join('.') || '');
      if (!r.found) return null;
      return r.value;
    }
    case 'Array':  return n.items.map(x => evalExpr(x, ctx));
    case 'Object': {
      const o = {};
      for (const { key, value } of n.entries) o[key] = evalExpr(value, ctx);
      return o;
    }
    case 'Binary': {
      const l = evalExpr(n.left, ctx);
      const r = evalExpr(n.right, ctx);
      if (n.op === '+') {
        if (Array.isArray(l) && Array.isArray(r)) return l.concat(r);
        if (typeof l === 'number' && typeof r === 'number') return l + r;
        return String(l) + String(r);
      }
      return null;
    }
    case 'Effect':
      return ctx.fx.call(n.path, (n.args || []).map(x => evalExpr(x, ctx)));
    default:
      return null;
  }
}

// ---- statement ----
function execStmt(s, ctx) {
  switch (s.type) {
    case 'Need':
      // đã kiểm ở runOn; bỏ qua ở đây
      return;

    case 'Reply':
      ctx.response = evalExpr(s.value, ctx);
      return;

    case 'EffectCall':
      ctx.fx.call(s.path, (s.args || []).map(x => evalExpr(x, ctx)));
      return;

    case 'Assign':
      ctx.env.set(s.name, evalExpr(s.value, ctx));
      return;

    case 'Each': {
      const list = evalExpr(s.list, ctx);
      if (!Array.isArray(list)) return;
      checkEachLimit(list, s, ctx);
      const saved = s.var;
      const prev = ctx.env.has(saved) ? ctx.env.get(saved) : undefined;
      for (const item of list) {
        ctx.env.set(saved, item);
        for (const inner of s.body) execStmt(inner, ctx);
      }
      if (prev === undefined) ctx.env.delete(saved);
      else ctx.env.set(saved, prev);
      return;
    }

    case 'Input':
    case 'Btn':
    case 'P':
    case 'Page':
      // Các node Web xử lý trong renderStmt; execStmt chỉ chạy side-effect thuần.
      return;

    default:
      return;
  }
}

// ---- Web render (Page → HTML) ----
function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderStmt(s, ctx) {
  switch (s.type) {
    case 'Assign':
      // Page assignments initialize defaults on GET; POST keeps submitted state (P4).
      if (!ctx.preserveState || !ctx.env.has(s.name)) {
        ctx.env.set(s.name, evalExpr(s.value, ctx));
      }
      return '';
    case 'Input':
      return '<input name="' + escapeHtml(s.var) + '" type="text" value="' +
        escapeHtml(ctx.env.get(s.var)) + '" />';
    case 'P':
      return '<p>' + escapeHtml(evalExpr(s.expr, ctx)) + '</p>';
    case 'Btn': {
      const id = ctx.buttons ? ctx.buttons.length : 0;
      if (ctx.buttons) ctx.buttons.push({ body: s.body, env: new Map(ctx.env) });
      return '<button type="submit" name="__btn" value="' + id + '" data-label="' +
        escapeHtml(s.label) + '">' + escapeHtml(s.label) + '</button>';
    }
    case 'Each': {
      const list = evalExpr(s.list, ctx);
      if (!Array.isArray(list)) return '';
      checkEachLimit(list, s, ctx);
      const saved = s.var;
      const prev = ctx.env.has(saved) ? ctx.env.get(saved) : undefined;
      let html = '';
      for (const item of list) {
        ctx.env.set(saved, item);
        for (const inner of s.body) html += renderStmt(inner, ctx);
      }
      if (prev === undefined) ctx.env.delete(saved);
      else ctx.env.set(saved, prev);
      return html;
    }
    default:
      return '';
  }
}

function renderPage(pageNode, ctx) {
  ctx.buttons = [];
  const parts = pageNode.body.map(s => renderStmt(s, ctx)).join('');
  const state = escapeHtml(JSON.stringify(Object.fromEntries(ctx.env)));
  return '<!doctype html><html><body><form method="post">' +
    '<input type="hidden" name="__state" value="' + state + '" />' +
    parts + '</form></body></html>';
}

// ---- On (Worker) ----
function runOn(onNode, ctx) {
  // Kiểm need trước khi chạy body (D13)
  for (const s of onNode.body) {
    if (s.type !== 'Need') continue;
    const r = lookupPath({ body: ctx.body }, s.path);
    if (!r.found) {
      throw d13(
        'type', s.line,
        s.path + ' present with type ' + s.ty,
        'include "' + s.path.split('.').pop() + '": "<' + s.ty + '>" at ' + s.path,
        ctx.seed
      );
    }
    const t = runtimeType(r.value);
    if (t !== s.ty) {
      throw d13(
        'type', s.line,
        s.path + ' : ' + s.ty,
        'change ' + s.path + ' from ' + t + ' to ' + s.ty,
        ctx.seed
      );
    }
  }
  for (const s of onNode.body) execStmt(s, ctx);
  return ctx.response;
}

module.exports = { evalExpr, execStmt, renderPage, renderStmt, runOn, runtimeType, lookupPath };
