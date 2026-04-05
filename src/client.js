#!/usr/bin/env node
const base = process.env.ACTION_GATE_URL || 'http://127.0.0.1:8787';
const [,, command, ...args] = process.argv;

async function main() {
  if (command === 'propose') {
    const json = args.join(' ');
    const res = await fetch(`${base}/v1/proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json
    });
    console.log(JSON.stringify(await res.json(), null, 2));
    return;
  }

  if (command === 'list') {
    const status = args[0] ? `?status=${encodeURIComponent(args[0])}` : '';
    const res = await fetch(`${base}/v1/actions${status}`);
    console.log(JSON.stringify(await res.json(), null, 2));
    return;
  }

  if (command === 'stats') {
    const res = await fetch(`${base}/v1/stats`);
    console.log(JSON.stringify(await res.json(), null, 2));
    return;
  }

  if (command === 'approve' || command === 'deny' || command === 'execute') {
    const [id, actor='user', note=''] = args;
    if (!id) throw new Error(`Missing id for ${command}`);
    const res = await fetch(`${base}/v1/actions/${id}/${command}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actor, note })
    });
    console.log(JSON.stringify(await res.json(), null, 2));
    return;
  }

  console.error('Usage: client.js propose <json> | list [status] | stats | approve <id> [actor] [note] | deny <id> [actor] [note] | execute <id> [actor] [note]');
  process.exit(1);
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(1);
});
