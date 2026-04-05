import http from 'http';
import { URL } from 'url';
import { evaluateProposal, toWorkerReceipt } from './policy.js';
import { appendEvent, getAction, getStats, nextId, readActions } from './store.js';
import { executeAction, listSupportedAdapters } from './executor.js';
import { renderReviewQueuePage } from './ui.js';
import { hasOperatorAccess } from './auth.js';

const host = process.env.ACTION_GATE_HOST || '127.0.0.1';
const port = Number(process.env.ACTION_GATE_PORT || 8787);
const receiptMode = process.env.ACTION_GATE_RECEIPT_MODE || 'truthful';
const gateMode = process.env.ACTION_GATE_MODE || 'soft_gate';

function sendJson(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res, code, body) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function parseFilters(url) {
  return {
    status: url.searchParams.get('status'),
    source: url.searchParams.get('source'),
    actionType: url.searchParams.get('actionType')
  };
}

function filterActions(actions, filters) {
  return actions.filter((action) => {
    if (filters.status && action.status !== filters.status) return false;
    if (filters.source && action.proposal?.source !== filters.source) return false;
    if (filters.actionType && action.proposal?.actionType !== filters.actionType) return false;
    return true;
  });
}

function requireOperatorAccess(req, res, url) {
  if (!hasOperatorAccess(req, url)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'crabtrap-lite',
      receiptMode,
      gateMode,
      adapters: listSupportedAdapters()
    });
  }

  if (req.method === 'GET' && url.pathname === '/v1/stats') {
    if (!requireOperatorAccess(req, res, url)) return;
    return sendJson(res, 200, getStats());
  }

  if (req.method === 'GET' && (url.pathname === '/ui' || url.pathname === '/')) {
    if (!requireOperatorAccess(req, res, url)) return;
    const actions = filterActions(readActions(), parseFilters(url));
    return sendHtml(res, 200, renderReviewQueuePage({
      actions,
      stats: getStats(),
      filters: parseFilters(url),
      token: url.searchParams.get('token') || ''
    }));
  }

  if (req.method === 'GET' && url.pathname === '/v1/actions') {
    if (!requireOperatorAccess(req, res, url)) return;
    const actions = filterActions(readActions(), parseFilters(url));
    return sendJson(res, 200, { actions });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/v1/actions/')) {
    if (!requireOperatorAccess(req, res, url)) return;
    const id = url.pathname.split('/')[3] || url.pathname.split('/').pop();
    const action = getAction(id);
    if (!action) return sendJson(res, 404, { error: 'not_found' });
    return sendJson(res, 200, action);
  }

  if (req.method === 'POST' && url.pathname === '/v1/proposals') {
    try {
      const body = await readJson(req);
      const evaluation = await evaluateProposal(body, { gateMode });
      const id = nextId();
      appendEvent({
        kind: 'proposal',
        id,
        createdAt: new Date().toISOString(),
        proposal: body,
        evaluation,
        receiptMode
      });
      return sendJson(res, 200, {
        receipt: toWorkerReceipt({ proposalId: id, evaluation, receiptMode }),
        audit: {
          id,
          decision: evaluation.decision,
          effectiveDecision: evaluation.effectiveDecision,
          flags: evaluation.flags
        }
      });
    } catch (err) {
      return sendJson(res, 400, {
        error: 'invalid_json',
        detail: String(err.message || err)
      });
    }
  }

  const approvalMatch = req.method === 'POST' && url.pathname.match(/^\/v1\/actions\/([^/]+)\/(approve|deny)$/);
  if (approvalMatch) {
    if (!requireOperatorAccess(req, res, url)) return;
    const id = approvalMatch[1];
    const verb = approvalMatch[2];
    const current = getAction(id);
    if (!current) return sendJson(res, 404, { error: 'not_found' });
    const body = await readJson(req).catch(() => ({}));
    appendEvent({
      kind: 'approval',
      id,
      at: new Date().toISOString(),
      approved: verb === 'approve',
      actor: body.actor || 'user',
      note: body.note || ''
    });
    return sendJson(res, 200, { ok: true, id, status: verb === 'approve' ? 'approved' : 'denied' });
  }

  const execMatch = req.method === 'POST' && url.pathname.match(/^\/v1\/actions\/([^/]+)\/execute$/);
  if (execMatch) {
    if (!requireOperatorAccess(req, res, url)) return;
    const id = execMatch[1];
    const current = getAction(id);
    if (!current) return sendJson(res, 404, { error: 'not_found' });
    if (!(current.status === 'allowed' || current.status === 'approved')) {
      return sendJson(res, 409, {
        error: 'not_executable',
        currentStatus: current.status
      });
    }

    const body = await readJson(req).catch(() => ({}));

    try {
      const result = await executeAction(current);
      appendEvent({
        kind: 'execution',
        id,
        at: new Date().toISOString(),
        status: 'executed',
        actor: body.actor || 'system',
        note: body.note || '',
        adapter: current.proposal?.execution?.adapter || null,
        result
      });
      return sendJson(res, 200, { ok: true, id, status: 'executed', result });
    } catch (err) {
      appendEvent({
        kind: 'execution_failed',
        id,
        at: new Date().toISOString(),
        actor: body.actor || 'system',
        note: body.note || '',
        adapter: current.proposal?.execution?.adapter || null,
        error: String(err.message || err)
      });
      return sendJson(res, 502, {
        error: 'execution_failed',
        id,
        detail: String(err.message || err)
      });
    }
  }

  return sendJson(res, 404, { error: 'not_found' });
});

server.listen(port, host, () => {
  console.log(`crabtrap-lite listening on http://${host}:${port}`);
  console.log(`receipt mode: ${receiptMode}`);
  console.log(`gate mode: ${gateMode}`);
});
