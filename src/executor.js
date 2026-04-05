import fs from 'fs';
import path from 'path';
import { executeNoop } from './adapters/noop.js';
import { executeHttpJson } from './adapters/http-json.js';

function getCredentialsDir() {
  return process.env.CRABTRAP_CREDENTIALS_DIR || '/root/.config/crabtrap-lite-adapters';
}

function resolveCredentialsPath(credentialsRef) {
  return path.join(getCredentialsDir(), `${credentialsRef}.json`);
}

function loadCredentials(credentialsRef) {
  const filePath = resolveCredentialsPath(credentialsRef);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw ? JSON.parse(raw) : {};
}

function getAdapterName(action) {
  return String(action?.proposal?.execution?.adapter || '').trim();
}

function getCredentialsRef(action, adapter) {
  return String(action?.proposal?.execution?.credentialsRef || adapter || '').trim();
}

export function listSupportedAdapters() {
  return ['noop', 'http_json'];
}

export async function executeAction(action) {
  const adapter = getAdapterName(action);
  if (!adapter) {
    throw new Error('Action is missing proposal.execution.adapter');
  }

  if (!listSupportedAdapters().includes(adapter)) {
    throw new Error(`Unsupported adapter: ${adapter}`);
  }

  const credentials = loadCredentials(getCredentialsRef(action, adapter));

  if (adapter === 'noop') {
    return executeNoop({ action, credentials });
  }

  if (adapter === 'http_json') {
    return executeHttpJson({ action, credentials });
  }

  throw new Error(`No executor found for adapter: ${adapter}`);
}
