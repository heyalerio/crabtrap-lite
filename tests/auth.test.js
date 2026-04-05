import test from 'node:test';
import assert from 'node:assert/strict';
import { hasOperatorAccess } from '../src/auth.js';

function withEnv(pairs, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(pairs)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function makeReq(remoteAddress, headers = {}) {
  return {
    socket: { remoteAddress },
    headers
  };
}

test('operator access defaults to loopback only when no token is configured', async () => {
  await withEnv({ ACTION_GATE_UI_TOKEN: null }, async () => {
    const url = new URL('http://127.0.0.1/ui');
    assert.equal(hasOperatorAccess(makeReq('127.0.0.1'), url), true);
    assert.equal(hasOperatorAccess(makeReq('::1'), url), true);
    assert.equal(hasOperatorAccess(makeReq('10.0.0.5'), url), false);
  });
});

test('operator access accepts header or query token when configured', async () => {
  await withEnv({ ACTION_GATE_UI_TOKEN: 'secret-token' }, async () => {
    const headerUrl = new URL('http://127.0.0.1/ui');
    const queryUrl = new URL('http://127.0.0.1/ui?token=secret-token');
    assert.equal(hasOperatorAccess(makeReq('10.0.0.5', { 'x-crabtrap-ui-token': 'secret-token' }), headerUrl), true);
    assert.equal(hasOperatorAccess(makeReq('10.0.0.5'), queryUrl), true);
    assert.equal(hasOperatorAccess(makeReq('127.0.0.1'), headerUrl), false);
  });
});
