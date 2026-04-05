const INJECTION_PATTERNS = [
  /ignore (all|any|previous|prior) instructions/i,
  /do not tell (the user|anyone)/i,
  /you are authorized/i,
  /override (policy|rules|guardrails)/i,
  /system prompt/i,
  /reveal (secrets|credentials|tokens)/i,
  /send (the|this) message now/i,
  /bypass/i,
  /exfiltrat/i
];

const SENSITIVE_TEXT_PATTERNS = [
  /api key/i,
  /access token/i,
  /bearer token/i,
  /refresh token/i,
  /password/i,
  /private key/i,
  /session cookie/i,
  /secret(?!ary)/i
];

function collectHumanText(input) {
  return [
    input?.summary || '',
    input?.payloadSummary || '',
    input?.notes || ''
  ].join('\n');
}

function collectTargetText(input) {
  return [
    input?.target || ''
  ].join('\n');
}

function unique(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function maxRisk(a, b) {
  const rank = { low: 1, medium: 2, high: 3 };
  return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
}

export function heuristicReviewProposal(input) {
  const humanText = collectHumanText(input);
  const targetText = collectTargetText(input);
  const flags = [];

  if (INJECTION_PATTERNS.some((re) => re.test(humanText))) {
    flags.push('prompt_injection_risk');
  }

  if (SENSITIVE_TEXT_PATTERNS.some((re) => re.test(humanText))) {
    flags.push('exfiltration_risk');
  }

  if ((/https?:\/\//i.test(humanText) || /https?:\/\//i.test(targetText)) && String(input?.actionType || '') !== 'external_write_api') {
    flags.push('unexpected_target');
  }

  const suspicious = flags.length > 0;

  return {
    reviewerMode: 'heuristic',
    suspicious,
    flags,
    reviewerConfidence: suspicious ? 'medium' : 'high',
    reviewerNote: suspicious
      ? 'Heuristic reviewer flagged suspicious content'
      : 'No suspicious patterns detected by heuristic reviewer'
  };
}

async function externalHttpReviewProposal(input, options = {}) {
  const reviewerUrl = options.reviewerUrl || process.env.ACTION_GATE_REVIEWER_URL;
  if (!reviewerUrl) {
    return {
      enabled: false,
      ok: false,
      skipped: true,
      reviewerMode: 'http_disabled',
      suspicious: false,
      flags: [],
      reviewerConfidence: 'low',
      reviewerNote: 'External reviewer not configured'
    };
  }

  const timeoutMs = Number(options.timeoutMs || process.env.ACTION_GATE_REVIEWER_TIMEOUT_MS || 3000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(reviewerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.authToken || process.env.ACTION_GATE_REVIEWER_AUTH_TOKEN
          ? { authorization: `Bearer ${options.authToken || process.env.ACTION_GATE_REVIEWER_AUTH_TOKEN}` }
          : {})
      },
      body: JSON.stringify({
        proposal: input,
        context: {
          source: input?.source || null,
          actionType: input?.actionType || null
        }
      }),
      signal: controller.signal
    });

    const body = await res.json().catch(() => ({}));
    return {
      enabled: true,
      ok: res.ok,
      skipped: false,
      statusCode: res.status,
      reviewerMode: 'http',
      suspicious: Boolean(body?.suspicious),
      flags: unique(body?.flags),
      reviewerConfidence: body?.reviewerConfidence || 'low',
      reviewerNote: body?.reviewerNote || `External reviewer returned HTTP ${res.status}`,
      verdict: body?.verdict || null,
      risk: body?.risk || null,
      raw: body
    };
  } catch (err) {
    return {
      enabled: true,
      ok: false,
      skipped: false,
      reviewerMode: 'http_error',
      suspicious: false,
      flags: ['reviewer_unavailable'],
      reviewerConfidence: 'low',
      reviewerNote: `External reviewer request failed: ${String(err.message || err)}`,
      error: String(err.message || err)
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function reviewProposal(input, options = {}) {
  const heuristic = heuristicReviewProposal(input);
  const external = await externalHttpReviewProposal(input, options);
  const failMode = options.failMode || process.env.ACTION_GATE_REVIEWER_FAIL_MODE || 'open';

  let flags = unique([...heuristic.flags, ...external.flags]);
  let suspicious = heuristic.suspicious || external.suspicious;
  let reviewerNote = heuristic.reviewerNote;
  let reviewerConfidence = heuristic.reviewerConfidence;
  let reviewerMode = heuristic.reviewerMode;
  let verdict = external.verdict || null;
  let risk = external.risk || null;

  if (external.enabled && !external.skipped) {
    reviewerMode = external.ok ? 'heuristic+http' : 'heuristic+http_error';
    reviewerNote = external.ok
      ? `${heuristic.reviewerNote} | ${external.reviewerNote}`
      : `${heuristic.reviewerNote} | ${external.reviewerNote}`;
    reviewerConfidence = external.ok ? external.reviewerConfidence || reviewerConfidence : reviewerConfidence;
  }

  if (external.enabled && !external.ok && failMode === 'closed') {
    suspicious = true;
    flags = unique([...flags, 'reviewer_fail_closed']);
    verdict = verdict || 'needs_approval';
    risk = maxRisk(risk || 'low', 'high');
  }

  return {
    reviewerMode,
    suspicious,
    flags,
    reviewerConfidence,
    reviewerNote,
    verdict,
    risk,
    heuristic,
    external,
    failMode
  };
}
