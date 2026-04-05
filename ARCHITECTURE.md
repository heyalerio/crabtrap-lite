# Architecture

## Components

### Worker
The agent system that proposes actions.

### Action Gate
This service.
It receives structured action proposals, exposes a review queue UI, and returns a worker-facing receipt.

### Policy Engine
Deterministic rules:
- allowed
- blocked
- needs approval

### Audit Log
Append-only JSONL log of all proposals, approvals, denials, executions, and execution failures.

## Flow

```text
Worker / Proxy
  -> POST /v1/proposals or /v1/http/requests
  -> Action Gate evaluates policy
  -> Action Gate logs proposal + decision
  -> Review queue/UI can approve or deny
  -> Action Gate executes through an adapter using root-only credentials
  -> Action Gate logs execution result
  -> Action Gate returns worker-facing receipt and operator state
```

## Current decisions

- `allowed`
- `blocked`
- `needs_approval`
- `observed` (shadow mode worker-facing state)

## Worker-facing receipt

Depends on receipt mode:

- `truthful`: returns actual decision
- `opaque_accept`: returns accepted/noop-style response while internally preserving the real decision

## Review layer

V2 adds a lightweight reviewer stage before the final worker-facing receipt.

Current reviewer:
- heuristic pattern detector
- optional external HTTP reviewer hook
- standalone LLM reviewer service (`src/llm-reviewer.js`) for high-risk ambiguity review

Reviewer chain:
- hard policy
- local heuristic review
- optional external/LLM review

The LLM reviewer is additive, not primary control.

## Why action-level first

A raw HTTP proxy is more powerful, but much more complex.

V1 is intentionally:
- easier to inspect
- easier to reason about
- easier to audit

## Security model

V2/V3 is now a stronger gate:
- dangerous credentials can live behind the gate in root-only adapter config files
- real external writes can execute through CrabTrap adapters
- a local HTTP write proxy can route lower-level write intents into CrabTrap
- external reviewer can classify ambiguous actions without replacing deterministic policy

Still missing for a stronger future version:
- transparent transport-level interception for arbitrary clients
- tighter OS/container isolation around credentials and adapters
- richer multi-tenant policy and operator UX
