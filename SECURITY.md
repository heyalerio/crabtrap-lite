# Security Notes

## Scope

`crabtrap-lite` is a local action-gate service intended to sit between an agent/planner and risky external writes.

## What this repo should never contain

- real production secrets
- checked-in `.env` files
- checked-in adapter credential bundles
- checked-in approval tokens

## Recommended secret locations

- gate env: `$HOME/.config/crabtrap-lite.env`
- reviewer env: `$HOME/.config/crabtrap-llm-reviewer.env`
- proxy env: `$HOME/.config/crabtrap-http-write-proxy.env`
- adapter credential bundles: `$HOME/.config/crabtrap-lite-adapters/`

## Default safety posture

- operator endpoints are loopback-only unless a UI token is configured
- external writes are modeled as typed actions and can require approval
- adapter credentials are intended to live behind the gate, not in worker processes

## Current limitations

This project is not yet a transparent transport proxy or a hardened isolation boundary.
It is best understood as a pragmatic, auditable action gate with reviewer support.

## Disclosure

If you find a security issue, open a private report if possible before publishing a full writeup.
