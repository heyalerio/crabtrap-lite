import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const dataDir = path.resolve(process.cwd(), 'data');
const logPath = path.join(dataDir, 'actions.jsonl');

fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '');

export function nextId() {
  return crypto.randomUUID();
}

export function appendEvent(event) {
  fs.appendFileSync(logPath, JSON.stringify(event) + '\n');
}

export function readEvents() {
  const raw = fs.readFileSync(logPath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function applyEvent(state, event) {
  if (event.kind === 'proposal') {
    state[event.id] = {
      id: event.id,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      proposal: event.proposal,
      evaluation: event.evaluation,
      receiptMode: event.receiptMode,
      status: event.evaluation.effectiveDecision,
      internalDecision: event.evaluation.decision,
      history: [
        {
          at: event.createdAt,
          kind: 'proposal',
          decision: event.evaluation.decision,
          effectiveDecision: event.evaluation.effectiveDecision,
          reason: event.evaluation.reason
        }
      ]
    };
    return;
  }

  const current = state[event.id];
  if (!current) return;
  current.updatedAt = event.at;

  if (event.kind === 'approval') {
    current.status = event.approved ? 'approved' : 'denied';
    current.approval = {
      at: event.at,
      approved: event.approved,
      actor: event.actor || 'unknown',
      note: event.note || ''
    };
    current.history.push({
      at: event.at,
      kind: 'approval',
      approved: event.approved,
      actor: event.actor || 'unknown',
      note: event.note || ''
    });
    return;
  }

  if (event.kind === 'execution') {
    current.status = event.status;
    current.execution = {
      at: event.at,
      actor: event.actor || 'system',
      note: event.note || '',
      result: event.result || null,
      adapter: event.adapter || null
    };
    current.history.push({
      at: event.at,
      kind: 'execution',
      status: event.status,
      actor: event.actor || 'system',
      note: event.note || '',
      adapter: event.adapter || null,
      result: event.result || null
    });
    return;
  }

  if (event.kind === 'execution_failed') {
    current.status = 'execution_failed';
    current.execution = {
      at: event.at,
      actor: event.actor || 'system',
      note: event.note || '',
      error: event.error || 'unknown_error',
      adapter: event.adapter || null
    };
    current.history.push({
      at: event.at,
      kind: 'execution_failed',
      actor: event.actor || 'system',
      note: event.note || '',
      adapter: event.adapter || null,
      error: event.error || 'unknown_error'
    });
  }
}

export function buildState() {
  const state = {};
  for (const event of readEvents()) applyEvent(state, event);
  return state;
}

export function readActions() {
  return Object.values(buildState()).sort((a, b) =>
    String(b.updatedAt).localeCompare(String(a.updatedAt))
  );
}

export function getAction(id) {
  return buildState()[id] || null;
}

export function getStats() {
  const actions = readActions();
  return {
    total: actions.length,
    needsApproval: actions.filter((x) => x.status === 'needs_approval').length,
    blocked: actions.filter((x) => x.status === 'blocked').length,
    approved: actions.filter((x) => x.status === 'approved').length,
    executed: actions.filter((x) => x.status === 'executed').length,
    executionFailed: actions.filter((x) => x.status === 'execution_failed').length
  };
}
