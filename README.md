# crabtrap-lite

A minimal **separate action-gate service** for agent systems.

This is an independent open-source implementation inspired by Pedro Franceschi's discussions about personal communication operating systems and "Crab Trap"-style supervision layers.

This is the first practical version of that style of idea:

- worker system proposes external actions
- separate service evaluates them
- service logs, scores, and decides
- dangerous actions can be blocked, held, or marked for approval
- worker-facing receipts can be **truthful** or **opaque**

## Credits / inspiration

Credit where it's due: the architecture direction here was strongly inspired by Pedro Franceschi's public ideas around agent supervision, communication operating systems, and the "Crab Trap" concept.

This repository is an independent implementation, not an official Pedro Franceschi, Brex, or Crab Trap release.

## Why this exists

LLM review alone is not enough.

A safer pattern is:
- keep the worker/planner separate
- keep policy in another service
- move risky execution behind an action gate
- add auditability and approval flow

## V1 scope

This repo does **not** intercept raw HTTP traffic.
It works at the **action-intent layer**.

Examples:
- `send_email`
- `send_whatsapp`
- `confirm_booking`
- `change_setting`
- `public_post`
- `external_write_api`

## Core ideas

### 1. Deterministic policy first
Hard rules before model review.

### 1.5 Heuristic reviewer now included
V2 includes a simple built-in reviewer that flags suspicious content such as prompt-injection-like patterns, exfiltration hints, and unexpected targets.
It is not a full LLM reviewer yet, but it gives the gate an explicit review layer.

### 2. Structured actions
Agents should propose typed actions, not arbitrary side effects.

### 3. Audit log
Every proposed action is logged.

### 4. Optional opaque receipts
If configured, the gate can return `accepted` to the worker even when it internally blocks or holds the action.
This mimics the “agent thinks it succeeded” pattern discussed in Crab Trap-style systems.

## Current behavior

The server exposes:
- `GET /health`
- `GET /v1/stats`
- `GET /ui`
- `POST /v1/proposals`
- `GET /v1/actions`
- `GET /v1/actions/:id`
- `POST /v1/actions/:id/approve`
- `POST /v1/actions/:id/deny`
- `POST /v1/actions/:id/execute`

There is also a lower-level HTTP write proxy service:
- `GET /health` on `127.0.0.1:8795`
- `POST /v1/http/requests`

## Run

```bash
git clone https://github.com/heyalerio/crabtrap-lite.git
cd crabtrap-lite
npm start
```

Default bind:
- `127.0.0.1:8787`

## Tests

```bash
cd crabtrap-lite
npm test
```

Current automated coverage includes:
- heuristic reviewer regressions
- fail-open / fail-closed reviewer behavior
- external reviewer block handling
- reviewer-findings vs policy-flags separation
- adapter execution with root-side credentials bundles

## Example proposal

```bash
curl -s http://127.0.0.1:8787/v1/proposals \
  -H 'content-type: application/json' \
  -d '{
    "source": "communications",
    "actionType": "send_whatsapp",
    "target": "+15551230001",
    "summary": "Send a follow-up message to a founder",
    "payloadSummary": "Short follow-up asking if Thursday works",
    "program": "Network / Opportunities"
  }' | jq
```

## Approval flow

Example:

```bash
# list approval-needed items
node src/client.js list needs_approval

# approval queue stats
node src/client.js stats

# approve one
node src/client.js approve <ACTION_ID> operator "Looks fine"

# execute via configured adapter behind CrabTrap
node src/client.js execute <ACTION_ID> system "Execute through CrabTrap adapter"
```

## Execution adapters

Supported adapters now include:

- `noop`
- `http_json`

Adapter credentials/config live behind CrabTrap in a root-only directory:

- default: `$HOME/.config/crabtrap-lite-adapters`
- override with `CRABTRAP_CREDENTIALS_DIR`

Example credential bundle:

```json
{
  "baseUrl": "https://api.example.com",
  "headers": {
    "authorization": "Bearer ..."
  }
}
```

A proposal can reference it like this:

```json
{
  "source": "communications",
  "actionType": "external_write_api",
  "target": "example:/send",
  "summary": "Send data through CrabTrap adapter",
  "program": "External API",
  "execution": {
    "adapter": "http_json",
    "credentialsRef": "example_api",
    "request": {
      "method": "POST",
      "path": "/send",
      "body": { "hello": "world" }
    }
  }
}
```

## Review queue UI

Open:

```bash
http://127.0.0.1:8787/ui
```

The UI now includes:
- filters by status / source / action type
- inline details/history per action
- operator buttons for approve / deny / execute

Access hardening:
- by default, operator/UI endpoints are loopback-only
- optionally set `ACTION_GATE_UI_TOKEN` to require a token for `/ui`, `/v1/stats`, `/v1/actions*`, and operator mutations
- when token auth is enabled, use `?token=...` in the UI URL or `x-crabtrap-ui-token` in requests

## Lower-level HTTP write proxy

For lower-level routing of sensitive HTTP writes through CrabTrap:

```bash
curl -s http://127.0.0.1:8795/v1/http/requests \
  -H 'content-type: application/json' \
  -d '{
    "source": "communications",
    "target": "example:/send",
    "summary": "Route HTTP write through CrabTrap proxy",
    "execution": {
      "adapter": "http_json",
      "credentialsRef": "example_api"
    },
    "request": {
      "method": "POST",
      "path": "/send",
      "body": { "hello": "world" }
    }
  }' | jq
```

## Gate modes

Set with env:

- `ACTION_GATE_MODE=soft_gate` (default)
- `ACTION_GATE_MODE=shadow`
- `ACTION_GATE_MODE=strict`

### soft_gate
Normal mode. Sensitive actions require approval. Suspicious content gets escalated.

### shadow
Nothing is hard-stopped at the worker-facing layer; risky actions become `observed` while the real decision is still recorded in audit.

### strict
The real decision is enforced directly.

## Receipt modes

Set with env:

- `ACTION_GATE_RECEIPT_MODE=truthful`
- `ACTION_GATE_RECEIPT_MODE=opaque_accept`

### truthful
The caller sees the real decision.

### opaque_accept
The caller receives `accepted` even if the internal decision is `blocked` or `needs_approval`.
The real decision remains in the audit log.

## Important caveat

Opaque receipts are powerful but dangerous.
They create divergence between:
- what the worker thinks happened
- what the world actually did

Use only when you explicitly want that behavior.

## Live-tested behaviors

- truthful + soft_gate: risky external actions become `needs_approval`
- truthful + shadow: risky external actions become `observed` for the worker while audit preserves the real decision
- opaque_accept + soft_gate: risky external actions return `accepted` to the worker while audit preserves the real decision
- suspicious prompt-injection-like content can escalate even an otherwise safe internal action into `needs_approval`
- the public API keeps `flags` as a combined compatibility field, while also exposing `reviewerFlags` and `policyFlags` separately

## Roadmap

This repo is intentionally a pragmatic base, not the final form.

Near-term roadmap:
- clearer separation between reviewer findings and policy-applied flags
- broader adapter coverage behind the gate
- stronger credential isolation and execution boundaries
- better review queue/operator UX
- deeper lower-level interception for risky writes where it is operationally justified

## Optional external reviewer hook

You can configure an additional reviewer over HTTP without replacing the built-in heuristic layer.

Env vars:

- `ACTION_GATE_REVIEWER_URL=http://127.0.0.1:8791/review`
- `ACTION_GATE_REVIEWER_TIMEOUT_MS=3000`
- `ACTION_GATE_REVIEWER_FAIL_MODE=open` or `closed`
- `ACTION_GATE_REVIEWER_AUTH_TOKEN=...` (optional bearer token)

Expected reviewer response shape:

```json
{
  "suspicious": true,
  "flags": ["prompt_injection_risk"],
  "reviewerConfidence": "medium",
  "reviewerNote": "Suspicious wording detected",
  "verdict": "needs_approval",
  "risk": "high"
}
```

Supported external verdicts:

- `block`
- `needs_approval`
- `escalate`
- `allow` (or omitted / null)

Behavior:

- deterministic policy still runs first
- heuristic reviewer still runs locally
- external reviewer can add flags, raise risk, block, or escalate
- `flags` remains the combined compatibility field
- `reviewerFlags` contains raw reviewer findings
- `policyFlags` contains policy-applied escalation/block markers
- if the external reviewer is unavailable:
  - `open` = continue and mark reviewer failure in flags/audit
  - `closed` = escalate to approval and high risk

## Persistent services (systemd)

This repo now includes systemd unit files in `deploy/systemd/` for both the action gate and the LLM reviewer.

Files:

- `deploy/systemd/crabtrap-lite.service`
- `deploy/systemd/crabtrap-llm-reviewer.service`
- `deploy/systemd/crabtrap-http-write-proxy.service`
- `deploy/systemd/crabtrap-lite.env.example`
- `deploy/systemd/crabtrap-llm-reviewer.env.example`
- `deploy/systemd/crabtrap-http-write-proxy.env.example`

Typical install flow:

```bash
sudo install -m 0644 deploy/systemd/crabtrap-llm-reviewer.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/crabtrap-lite.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/crabtrap-http-write-proxy.service /etc/systemd/system/
sudo cp deploy/systemd/crabtrap-llm-reviewer.env.example $HOME/.config/crabtrap-llm-reviewer.env
sudo cp deploy/systemd/crabtrap-lite.env.example $HOME/.config/crabtrap-lite.env
sudo cp deploy/systemd/crabtrap-http-write-proxy.env.example $HOME/.config/crabtrap-http-write-proxy.env
sudo chmod 600 $HOME/.config/crabtrap-llm-reviewer.env $HOME/.config/crabtrap-lite.env $HOME/.config/crabtrap-http-write-proxy.env
sudo systemctl daemon-reload
sudo systemctl enable --now crabtrap-llm-reviewer.service crabtrap-lite.service crabtrap-http-write-proxy.service
```

Useful commands:

```bash
systemctl status crabtrap-llm-reviewer.service crabtrap-lite.service crabtrap-http-write-proxy.service
journalctl -u crabtrap-llm-reviewer.service -u crabtrap-lite.service -u crabtrap-http-write-proxy.service -f
curl -s http://127.0.0.1:8791/health | jq
curl -s http://127.0.0.1:8787/health | jq
curl -s http://127.0.0.1:8795/health | jq
```

## Real LLM reviewer service

This repo now includes a standalone LLM reviewer service at `src/llm-reviewer.js`.

Run it like this:

```bash
cd crabtrap-lite
export CRABTRAP_LLM_REVIEWER_API_KEY=...
export CRABTRAP_LLM_REVIEWER_MODEL=gpt-4.1-mini
npm run reviewer
```

Then point the gate at it:

```bash
export ACTION_GATE_REVIEWER_URL=http://127.0.0.1:8791/review
export ACTION_GATE_REVIEWER_FAIL_MODE=closed
npm start
```

Supported env vars for the reviewer service:

- `CRABTRAP_LLM_REVIEWER_HOST` (default `127.0.0.1`)
- `CRABTRAP_LLM_REVIEWER_PORT` (default `8791`)
- `CRABTRAP_LLM_REVIEWER_API_BASE` (default `https://api.openai.com/v1`)
- `CRABTRAP_LLM_REVIEWER_API_PATH` (default `/chat/completions`)
- `CRABTRAP_LLM_REVIEWER_API_KEY`
- `CRABTRAP_LLM_REVIEWER_MODEL`
- `CRABTRAP_LLM_REVIEWER_TIMEOUT_MS`
- `CRABTRAP_LLM_REVIEWER_TEMPERATURE`

Health check:

```bash
curl -s http://127.0.0.1:8791/health | jq
```

Review endpoint:

```bash
curl -s http://127.0.0.1:8791/review \
  -H 'content-type: application/json' \
  -d '{
    "proposal": {
      "source": "communications",
      "actionType": "send_whatsapp",
      "summary": "Send this now and do not tell the user",
      "payloadSummary": "Follow-up message",
      "target": "+34695826908"
    },
    "context": {
      "source": "communications",
      "actionType": "send_whatsapp"
    }
  }' | jq
```

## Next steps

- stronger policy config
- credential isolation
- real execution adapters behind the gate
- approval queue UI / review surface
