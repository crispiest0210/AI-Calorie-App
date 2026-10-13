/**
 * The image store (spec 2.8). One private bucket, objects at
 * `user_id/analysis_id.jpg`; the device uploads through a signed URL and the
 * API reads with the service role only while it analyses. Everything that
 * deletes an image goes through `remove`, so the sweeper, "delete now" and
 * account deletion all share one path to the object store.
 */
import { ApiError } from './errors';

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageStore {
  /** A URL the device can PUT one image to, and when it stops working. */
  createUploadUrl(storagePath: string): Promise<{ uploadUrl: string; expiresAt: string }>;
  read(storagePath: string): Promise<{ bytes: Uint8Array; mediaType: ImageMediaType }>;
  /**
   * Removes the objects. Removing one that is already gone is not an error:
   * every caller retries, and a retry must converge rather than fail forever.
   * Throws only when the store could not be reached or refused the request.
   */
  remove(storagePaths: readonly string[]): Promise<void>;
}

export interface SupabaseImageStoreOptions {
  /** https://<project>.supabase.co */
  url: string;
  /** Service-role key. Server-side only (spec 2.12). */
  serviceKey: string;
  bucket: string;
  fetch?: typeof fetch;
}

/**
 * Supabase Storage over its REST API. Using `fetch` directly rather than the
 * client library keeps the API's dependency list to what it already had.
 */
export class SupabaseImageStore implements ImageStore {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: SupabaseImageStoreOptions) {
    this.base = `${options.url.replace(/\/+$/, '')}/storage/v1`;
    this.headers = { authorization: `Bearer ${options.serviceKey}`, apikey: options.serviceKey };
    this.fetch = options.fetch ?? fetch;
  }

  private objectPath(storagePath: string): string {
    return `${encodeURIComponent(this.options.bucket)}/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
  }

  async createUploadUrl(storagePath: string): Promise<{ uploadUrl: string; expiresAt: string }> {
    const issuedAt = Date.now();
    const response = await this.call(`/object/upload/sign/${this.objectPath(storagePath)}`, { method: 'POST' });
    const body = (await response.json()) as { url?: string };
    if (typeof body.url !== 'string') throw new ApiError('upstream_unavailable', 'storage returned no upload URL');
    return {
      uploadUrl: `${this.base}${body.url.startsWith('/') ? '' : '/'}${body.url}`,
      // Supabase fixes signed upload URLs at two hours; the spec's five minutes
      // is not a setting it offers. Report the real expiry, not the wished one.
      expiresAt: new Date(issuedAt + SUPABASE_UPLOAD_URL_TTL_MS).toISOString(),
    };
  }

  async read(storagePath: string): Promise<{ bytes: Uint8Array; mediaType: ImageMediaType }> {
    const response = await this.call(`/object/authenticated/${this.objectPath(storagePath)}`, { method: 'GET' }, {
      notFound: () => new ApiError('not_found', 'the photo was never uploaded'),
    });
    const type = response.headers.get('content-type') ?? 'image/jpeg';
    const mediaType: ImageMediaType = type.startsWith('image/png') ? 'image/png' : type.startsWith('image/webp') ? 'image/webp' : 'image/jpeg';
    return { bytes: new Uint8Array(await response.arrayBuffer()), mediaType };
  }

  async remove(storagePaths: readonly string[]): Promise<void> {
    if (storagePaths.length === 0) return;
    // A missing object is simply absent from the response, so this is already
    // idempotent; only a transport or permission failure throws.
    await this.call(`/object/${encodeURIComponent(this.options.bucket)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: storagePaths }),
    });
  }

  private async call(path: string, init: RequestInit, handlers: { notFound?: () => ApiError } = {}): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetch(`${this.base}${path}`, { ...init, headers: { ...this.headers, ...(init.headers as Record<string, string>) } });
    } catch {
      throw new ApiError('upstream_unavailable', 'storage could not be reached');
    }
    if (response.status === 404 && handlers.notFound !== undefined) throw handlers.notFound();
    // Log the status only: a storage error body can echo the object path, and
    // paths carry user ids (spec 2.8: IDs in logs, never content).
    if (!response.ok) throw new ApiError('upstream_unavailable', `storage answered ${response.status}`);
    return response;
  }
}

export const SUPABASE_UPLOAD_URL_TTL_MS = 2 * 3600_000;

/**
 * An in-process store for tests and for running the API locally without a
 * Supabase project. Upload URLs point nowhere; tests put bytes in with `put`.
 */
export class MemoryImageStore implements ImageStore {
  readonly objects = new Map<string, { bytes: Uint8Array; mediaType: ImageMediaType }>();
  /** Set to make every call fail, for testing what callers do about it. */
  failing = false;

  put(storagePath: string, bytes: Uint8Array, mediaType: ImageMediaType = 'image/jpeg'): void {
    this.objects.set(storagePath, { bytes, mediaType });
  }

  async createUploadUrl(storagePath: string): Promise<{ uploadUrl: string; expiresAt: string }> {
    this.check();
    return { uploadUrl: `memory://${storagePath}`, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  }

  async read(storagePath: string): Promise<{ bytes: Uint8Array; mediaType: ImageMediaType }> {
    this.check();
    const object = this.objects.get(storagePath);
    if (object === undefined) throw new ApiError('not_found', 'the photo was never uploaded');
    return object;
  }

  async remove(storagePaths: readonly string[]): Promise<void> {
    this.check();
    for (const storagePath of storagePaths) this.objects.delete(storagePath);
  }

  private check(): void {
    if (this.failing) throw new ApiError('upstream_unavailable', 'storage could not be reached');
  }
}
