import { reviewProposal } from './reviewer.js';

const REQUIRES_APPROVAL = new Set([
  'send_email',
  'send_whatsapp',
  'send_dm',
  'confirm_booking',
  'change_setting',
  'external_write_api',
  'public_post',
  'spend_money'
]);

const AUTO_ALLOW = new Set([
  'read_signal',
  'summarize',
  'update_ledger',
  'recommend_action',
  'prepare_draft'
]);

function riskRank(risk) {
  return { low: 1, medium: 2, high: 3 }[risk] || 0;
}

function maxRisk(a, b) {
  return riskRank(a) >= riskRank(b) ? a : b;
}

function unique(list) {
  return [...new Set((list || []).filter(Boolean))];
}

export async function evaluateProposal(input, { gateMode = 'soft_gate' } = {}) {
  const errors = [];
  if (!input || typeof input !== 'object') errors.push('Proposal body must be an object');
  if (!input?.source) errors.push('Missing source');
  if (!input?.actionType) errors.push('Missing actionType');
  if (!input?.summary) errors.push('Missing summary');

  const reviewer = await reviewProposal(input || {});

  if (errors.length) {
    return {
      decision: 'blocked',
      effectiveDecision: gateMode === 'shadow' ? 'observed' : 'blocked',
      reason: 'invalid_proposal',
      confidence: 'high',
      errors,
      risk: 'high',
      flags: unique(['invalid_proposal', ...reviewer.flags]),
      reviewer,
      gateMode,
      approvalRequired: false
    };
  }

  const actionType = String(input.actionType);
  let decision = 'blocked';
  let reason = 'unknown_action_type';
  let confidence = 'medium';
  let risk = 'high';
  let approvalRequired = false;

  if (AUTO_ALLOW.has(actionType)) {
    decision = 'allowed';
    reason = 'safe_internal_action';
    confidence = 'high';
    risk = 'low';
  } else if (REQUIRES_APPROVAL.has(actionType)) {
    decision = 'needs_approval';
    reason = 'external_or_sensitive_action';
    confidence = 'high';
    risk = 'medium';
    approvalRequired = true;
  }

  let flags = [...reviewer.flags];

  if (reviewer.suspicious) {
    flags.push('reviewer_flagged');
    risk = maxRisk(risk, reviewer.risk || 'high');
    if (decision === 'allowed') {
      decision = 'needs_approval';
      reason = 'suspicious_internal_action';
      approvalRequired = true;
    }
  }

  if (reviewer.verdict === 'block') {
    decision = 'blocked';
    reason = 'external_reviewer_blocked';
    approvalRequired = false;
    risk = maxRisk(risk, reviewer.risk || 'high');
    flags.push('external_reviewer_block');
  } else if (reviewer.verdict === 'needs_approval' || reviewer.verdict === 'escalate') {
    if (decision !== 'blocked') {
      decision = 'needs_approval';
      reason = 'external_reviewer_escalated';
      approvalRequired = true;
    }
    risk = maxRisk(risk, reviewer.risk || 'high');
    flags.push('external_reviewer_escalation');
  }

  flags = unique(flags);

  let effectiveDecision = decision;
  if (gateMode === 'shadow' && decision !== 'allowed') {
    effectiveDecision = 'observed';
  } else if (
    gateMode === 'soft_gate' &&
    decision === 'blocked' &&
    flags.includes('reviewer_flagged') &&
    !flags.includes('external_reviewer_block')
  ) {
    effectiveDecision = 'needs_approval';
    approvalRequired = true;
  }

  return {
    decision,
    effectiveDecision,
    reason,
    confidence,
    risk,
    flags,
    reviewer,
    gateMode,
    approvalRequired
  };
}

export function toWorkerReceipt({ proposalId, evaluation, receiptMode }) {
  if (receiptMode === 'opaque_accept' && evaluation.effectiveDecision !== 'allowed') {
    return {
      proposalId,
      status: 'accepted',
      visibleDecision: 'accepted',
      note: 'Action accepted for processing'
    };
  }

  return {
    proposalId,
    status: evaluation.effectiveDecision,
    visibleDecision: evaluation.effectiveDecision,
    intendedDecision: evaluation.decision,
    reason: evaluation.reason,
    confidence: evaluation.confidence,
    risk: evaluation.risk,
    flags: evaluation.flags,
    approvalRequired: evaluation.approvalRequired,
    reviewerMode: evaluation.reviewer?.reviewerMode || 'none',
    reviewerVerdict: evaluation.reviewer?.verdict || null
  };
}
