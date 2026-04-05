import http from 'http';

const host = process.env.CRABTRAP_HTTP_PROXY_HOST || '127.0.0.1';
const port = Number(process.env.CRABTRAP_HTTP_PROXY_PORT || 8795);
const gateBase = process.env.ACTION_GATE_URL || 'http://127.0.0.1:8787';

function sendJson(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
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

function normalizeActionFromRequest(body) {
  const request = body.request || {};
  const execution = body.execution || {};
  return {
    source: body.source || 'http-proxy',
    actionType: body.actionType || 'external_write_api',
    target: body.target || request.url || request.path || 'http-target',
    summary: body.summary || `HTTP ${String(request.method || 'POST').toUpperCase()} write routed via CrabTrap proxy`,
    payloadSummary: body.payloadSummary || '',
    program: body.program || 'External API',
    execution: {
      adapter: execution.adapter || body.adapter || 'http_json',
      credentialsRef: execution.credentialsRef || body.credentialsRef || undefined,
      request: {
        method: request.method || 'POST',
        url: request.url,
        path: request.path,
        headers: request.headers || {},
        body: request.body
      }
    }
  };
}

async function propose(action) {
  const res = await fetch(`${gateBase}/v1/proposals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(action)
  });
  return { ok: res.ok, body: await res.json() };
}

async function execute(actionId) {
  const res = await fetch(`${gateBase}/v1/actions/${actionId}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'http-proxy', note: 'Auto-executed by proxy after allow' })
  });
  return { ok: res.ok, body: await res.json() };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'crabtrap-http-write-proxy',
      gateBase
    });
  }

  if (req.method === 'POST' && req.url === '/v1/http/requests') {
    try {
      const body = await readJson(req);
      const action = normalizeActionFromRequest(body);
      const proposal = await propose(action);
      if (!proposal.ok) return sendJson(res, 502, { error: 'proposal_failed', proposal: proposal.body });

      if (body.autoExecute === true && proposal.body?.receipt?.status === 'allowed') {
        const execution = await execute(proposal.body.audit.id);
        return sendJson(res, execution.ok ? 200 : 502, {
          proposal: proposal.body,
          execution: execution.body
        });
      }

      return sendJson(res, 200, { proposal: proposal.body });
    } catch (err) {
      return sendJson(res, 400, {
        error: 'invalid_request',
        detail: String(err.message || err)
      });
    }
  }

  return sendJson(res, 404, { error: 'not_found' });
});

server.listen(port, host, () => {
  console.log(`crabtrap-http-write-proxy listening on http://${host}:${port}`);
  console.log(`gate: ${gateBase}`);
});
