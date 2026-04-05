function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function option(value, current) {
  const selected = String(value) === String(current || '') ? ' selected' : '';
  return `<option value="${esc(value)}"${selected}>${esc(value)}</option>`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
}

function renderFilters({ actions, filters, token }) {
  const statuses = uniqueSorted(actions.map((x) => x.status));
  const sources = uniqueSorted(actions.map((x) => x.proposal?.source));
  const actionTypes = uniqueSorted(actions.map((x) => x.proposal?.actionType));

  return `
    <form class="filters" method="GET" action="/ui">
      <label>Status
        <select name="status">
          <option value="">all</option>
          ${statuses.map((value) => option(value, filters.status)).join('')}
        </select>
      </label>
      <label>Source
        <select name="source">
          <option value="">all</option>
          ${sources.map((value) => option(value, filters.source)).join('')}
        </select>
      </label>
      <label>Action type
        <select name="actionType">
          <option value="">all</option>
          ${actionTypes.map((value) => option(value, filters.actionType)).join('')}
        </select>
      </label>
      ${token ? `<input type="hidden" name="token" value="${esc(token)}" />` : ''}
      <button type="submit">Apply</button>
      <a href="/ui${token ? `?token=${encodeURIComponent(token)}` : ''}">Reset</a>
    </form>`;
}

function renderActionDetails(action) {
  const evaluation = action.evaluation || {};
  const reviewer = evaluation.reviewer || {};
  const details = {
    internalDecision: action.internalDecision || evaluation.decision || null,
    effectiveDecision: action.status,
    reviewerMode: reviewer.reviewerMode || null,
    reviewerVerdict: reviewer.verdict || null,
    reviewerConfidence: reviewer.reviewerConfidence || null,
    reviewerNote: reviewer.reviewerNote || null,
    history: action.history || [],
    execution: action.execution || null
  };

  return `<details>
    <summary>details</summary>
    <pre>${esc(JSON.stringify(details, null, 2))}</pre>
  </details>`;
}

export function renderReviewQueuePage({ actions, stats, filters = {}, token = '' }) {
  const rows = actions.map((action) => {
    const proposal = action.proposal || {};
    const evaluation = action.evaluation || {};
    const canExecute = action.status === 'allowed' || action.status === 'approved';
    return `
      <tr>
        <td class="mono">${esc(action.id)}</td>
        <td>${esc(action.status)}</td>
        <td>${esc(proposal.source)}</td>
        <td>${esc(proposal.actionType)}</td>
        <td>${esc(proposal.target)}</td>
        <td>
          <div>${esc(proposal.summary)}</div>
          ${renderActionDetails(action)}
        </td>
        <td>${esc(evaluation.risk)}</td>
        <td>${esc((evaluation.flags || []).join(', '))}</td>
        <td>
          <button onclick="act('${esc(action.id)}','approve')">approve</button>
          <button onclick="act('${esc(action.id)}','deny')">deny</button>
          <button ${canExecute ? '' : 'disabled'} onclick="act('${esc(action.id)}','execute')">execute</button>
        </td>
      </tr>`;
  }).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>CrabTrap Review Queue</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; background: #0f172a; color: #e2e8f0; }
    h1, h2 { margin-bottom: 8px; }
    .stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .card { background: #111827; padding: 12px 16px; border-radius: 10px; border: 1px solid #334155; }
    .filters { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; margin-bottom: 18px; }
    .filters label { display: flex; flex-direction: column; gap: 6px; }
    table { border-collapse: collapse; width: 100%; background: #111827; }
    th, td { padding: 10px; border: 1px solid #334155; vertical-align: top; }
    th { text-align: left; background: #1e293b; }
    button, select { margin-right: 6px; padding: 6px 10px; }
    .muted { color: #94a3b8; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #020617; padding: 12px; border-radius: 8px; }
    details { margin-top: 8px; }
    a { color: #93c5fd; }
  </style>
</head>
<body>
  <h1>CrabTrap Review Queue</h1>
  <div class="stats">
    <div class="card"><strong>Total</strong><div>${esc(stats.total)}</div></div>
    <div class="card"><strong>Needs approval</strong><div>${esc(stats.needsApproval)}</div></div>
    <div class="card"><strong>Blocked</strong><div>${esc(stats.blocked)}</div></div>
    <div class="card"><strong>Approved</strong><div>${esc(stats.approved)}</div></div>
    <div class="card"><strong>Executed</strong><div>${esc(stats.executed)}</div></div>
    <div class="card"><strong>Exec failed</strong><div>${esc(stats.executionFailed)}</div></div>
  </div>
  <p class="muted">Lightweight operator queue for reviewing, approving, denying, and executing actions.</p>
  ${renderFilters({ actions, filters, token })}
  <table>
    <thead>
      <tr>
        <th>ID</th><th>Status</th><th>Source</th><th>Action</th><th>Target</th><th>Summary</th><th>Risk</th><th>Flags</th><th>Ops</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="9">No actions yet</td></tr>'}</tbody>
  </table>
  <script>
    const operatorToken = ${JSON.stringify(token || '')};
    async function act(id, verb) {
      const note = prompt('Optional note:', '') ?? '';
      const headers = { 'content-type': 'application/json' };
      if (operatorToken) headers['x-crabtrap-ui-token'] = operatorToken;
      const res = await fetch('/v1/actions/' + id + '/' + verb, {
        method: 'POST',
        headers,
        body: JSON.stringify({ actor: 'ui', note })
      });
      const json = await res.json();
      if (!res.ok) {
        alert('Error: ' + JSON.stringify(json));
        return;
      }
      location.reload();
    }
  </script>
</body>
</html>`;
}
