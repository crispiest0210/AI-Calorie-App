import { describe, expect, it, vi } from 'vitest';
import { HttpTransport, SyncError } from '../src/sync/transport';

function problem(status: number, code: string, title = 'nope'): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title, status, code }), { status });
}

function transport(fetchImpl: typeof fetch, token: string | null = 'tok') {
  return new HttpTransport({
    baseUrl: 'https://api.test',
    getToken: async () => token,
    appVersion: '1.2.3',
    timeoutMs: 20,
    fetchImpl,
  });
}

async function kindOf(promise: Promise<unknown>): Promise<SyncError> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(SyncError);
  return error as SyncError;
}

describe('HttpTransport', () => {
  it('fails with an auth error before any request when signed out', async () => {
    const fetchImpl = vi.fn();
    const error = await kindOf(transport(fetchImpl as unknown as typeof fetch, null).pull(0));
    expect(error.kind).toBe('auth');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the bearer token, app version and cursor, and parses the response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ changes: [], nextCursor: 7, hasMore: false })));
    const result = await transport(fetchImpl as unknown as typeof fetch).pull(5);
    expect(result).toEqual({ changes: [], nextCursor: 7, hasMore: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/sync/pull?cursor=5');
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok', 'X-App-Version': '1.2.3' });
  });

  it.each([
    [401, 'unauthorized', 'auth'],
    [422, 'validation_failed', 'validation'],
    [410, 'sync_cursor_expired', 'cursor_expired'],
    [426, 'upgrade_required', 'upgrade_required'],
    [429, 'rate_limited', 'server'],
  ])('maps %i %s to %s', async (status, code, kind) => {
    const error = await kindOf(transport((async () => problem(status, code, 'why')) as typeof fetch).pull(0));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.message).toBe('why');
  });

  it('treats a non-problem error body as a generic server error', async () => {
    const error = await kindOf(transport((async () => new Response('<html>', { status: 502 })) as typeof fetch).pull(0));
    expect(error).toMatchObject({ kind: 'server', status: 502, message: 'server returned 502' });
  });

  it('reports offline for network failures and timeout for aborts', async () => {
    const offline = await kindOf(transport((async () => { throw new TypeError('fail'); }) as typeof fetch).pull(0));
    expect(offline.kind).toBe('offline');

    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as unknown as typeof fetch;
    const timeout = await kindOf(transport(hang).pull(0));
    expect(timeout.kind).toBe('timeout');
  });
});
