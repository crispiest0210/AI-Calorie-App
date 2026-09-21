/**
 * How the client talks to the API. Network errors are typed (spec 2.11) so the
 * UI can show a quiet sync badge instead of a modal alert: a write to SQLite
 * never depended on the network, so a failed sync is never a failed log.
 */
import { problemDetails, pullResponse, pushResponse, type ProblemCode, type PullResponse, type PushRequest, type PushResponse } from '@nt/core';

export type SyncErrorKind = 'offline' | 'timeout' | 'server' | 'auth' | 'validation' | 'cursor_expired' | 'upgrade_required';

export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

export interface Transport {
  push(request: PushRequest, idempotencyKey: string): Promise<PushResponse>;
  pull(cursor: number): Promise<PullResponse>;
}

export interface HttpTransportOptions {
  baseUrl: string;
  /** Read fresh each call: the token is refreshed out from under us. */
  getToken: () => Promise<string | null>;
  appVersion: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const PROBLEM_TO_KIND: Partial<Record<ProblemCode, SyncErrorKind>> = {
  unauthorized: 'auth',
  validation_failed: 'validation',
  sync_cursor_expired: 'cursor_expired',
  upgrade_required: 'upgrade_required',
};

export class HttpTransport implements Transport {
  constructor(private readonly options: HttpTransportOptions) {}

  private async call<T>(path: string, init: RequestInit, parse: (body: unknown) => T): Promise<T> {
    const token = await this.options.getToken();
    if (token === null) throw new SyncError('auth', 'not signed in');

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);

    let response: Response;
    try {
      response = await fetchImpl(`${this.options.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'X-App-Version': this.options.appVersion,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new SyncError(aborted ? 'timeout' : 'offline', aborted ? 'the request timed out' : 'no connection');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const problem = problemDetails.safeParse(body);
      const kind = problem.success ? (PROBLEM_TO_KIND[problem.data.code] ?? 'server') : 'server';
      throw new SyncError(kind, problem.success ? problem.data.title : `server returned ${response.status}`, response.status);
    }
    return parse(await response.json());
  }

  push(request: PushRequest, idempotencyKey: string): Promise<PushResponse> {
    return this.call('/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'idempotency-key': idempotencyKey },
    }, (body) => pushResponse.parse(body));
  }

  pull(cursor: number): Promise<PullResponse> {
    return this.call(`/v1/sync/pull?cursor=${cursor}`, { method: 'GET' }, (body) => pullResponse.parse(body));
  }
}
