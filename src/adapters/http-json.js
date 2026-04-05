function normalizeMethod(method) {
  const value = String(method || 'POST').toUpperCase();
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(value) ? value : 'POST';
}

function joinUrl(baseUrl, path = '') {
  const normalizedBase = String(baseUrl || '').replace(/\/$/, '');
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
  return `${normalizedBase}${normalizedPath}`;
}

export async function executeHttpJson({ action, credentials }) {
  const execution = action?.proposal?.execution || {};
  const request = execution.request || {};
  const baseUrl = credentials?.baseUrl;
  if (!baseUrl) {
    throw new Error('http_json adapter requires credentials.baseUrl');
  }

  const url = request.url || joinUrl(baseUrl, request.path || '/');
  const method = normalizeMethod(request.method);
  const headers = {
    'content-type': 'application/json',
    ...(credentials?.headers || {}),
    ...(request.headers || {})
  };

  const res = await fetch(url, {
    method,
    headers,
    body: request.body == null ? undefined : JSON.stringify(request.body)
  });

  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}

  return {
    ok: res.ok,
    adapter: 'http_json',
    request: {
      method,
      url
    },
    response: {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body
    }
  };
}
