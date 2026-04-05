function normalizeRemoteAddress(value) {
  return String(value || '').replace(/^::ffff:/, '');
}

function isLoopbackAddress(value) {
  const addr = normalizeRemoteAddress(value);
  return addr === '127.0.0.1' || addr === '::1';
}

export function getOperatorUiToken() {
  return String(process.env.ACTION_GATE_UI_TOKEN || '').trim();
}

export function hasOperatorAccess(req, url) {
  const token = getOperatorUiToken();
  if (!token) {
    return isLoopbackAddress(req?.socket?.remoteAddress);
  }

  const headerToken = req?.headers?.['x-crabtrap-ui-token'];
  const queryToken = url?.searchParams?.get('token');
  return headerToken === token || queryToken === token;
}
