// Thin fetch wrapper: one place for base URL, JSON handling and error normalisation.

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, { status = 0, fields = {} } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields; // field name -> message, for 422 validation errors
  }
}

export function apiUrl(path) {
  return `${BASE_URL}/api${path}`;
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const init = { method, signal };
  if (body instanceof FormData) {
    init.body = body; // the browser sets the multipart boundary header itself
  } else if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }

  let response;
  try {
    response = await fetch(apiUrl(path), init);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the HR service. Please check that it is running.');
  }

  if (!response.ok) {
    let detail = 'The HR service could not complete the request. Please try again.';
    let fields = {};
    try {
      const data = await response.json();
      if (typeof data.detail === 'string') detail = data.detail;
      if (data.fields) fields = data.fields;
    } catch {
      /* non-JSON error body: keep the generic message */
    }
    throw new ApiError(detail, { status: response.status, fields });
  }
  return response.status === 204 ? null : response.json();
}

export const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};
