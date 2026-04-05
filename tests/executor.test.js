import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { executeAction } from '../src/executor.js';

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

test('noop adapter executes successfully', async () => {
  const result = await executeAction({
    id: 'noop-test',
    proposal: {
      execution: {
        adapter: 'noop'
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.adapter, 'noop');
});

test('http_json adapter executes with root-side credentials bundle', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crabtrap-credentials-'));
  fs.writeFileSync(path.join(tmpDir, 'mock.json'), JSON.stringify({
    baseUrl: 'http://127.0.0.1:0'
  }));

  let received = null;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      received = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: data ? JSON.parse(data) : null
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  fs.writeFileSync(path.join(tmpDir, 'mock.json'), JSON.stringify({
    baseUrl: `http://127.0.0.1:${port}`,
    headers: {
      'x-test-adapter': 'yes'
    }
  }));

  try {
    await withEnv({ CRABTRAP_CREDENTIALS_DIR: tmpDir }, async () => {
      const result = await executeAction({
        id: 'http-json-test',
        proposal: {
          execution: {
            adapter: 'http_json',
            credentialsRef: 'mock',
            request: {
              method: 'POST',
              path: '/send',
              body: { hello: 'world' }
            }
          }
        }
      });

      assert.equal(result.ok, true);
      assert.equal(result.adapter, 'http_json');
      assert.equal(received.method, 'POST');
      assert.equal(received.url, '/send');
      assert.equal(received.headers['x-test-adapter'], 'yes');
      assert.deepEqual(received.body, { hello: 'world' });
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
