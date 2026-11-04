/** The Supabase Storage adapter, against a recorded fake of its REST API. */
import { describe, expect, it } from 'vitest';
import { SUPABASE_UPLOAD_URL_TTL_MS, SupabaseImageStore } from '../src/storage';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body as string | undefined,
    };
    calls.push(call);
    return respond(call);
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const OPTIONS = { url: 'https://proj.supabase.co/', serviceKey: 'service-key', bucket: 'meal-photos' };
const PATH = 'user-1/analysis-1.jpg';

describe('SupabaseImageStore', () => {
  it('asks for a signed upload URL with the service key and returns an absolute one', async () => {
    const { calls, fetch } = fakeFetch(() => Response.json({ url: '/object/upload/sign/meal-photos/user-1/analysis-1.jpg?token=t' }));
    const before = Date.now();
    const signed = await new SupabaseImageStore({ ...OPTIONS, fetch }).createUploadUrl(PATH);

    expect(calls[0]).toMatchObject({
      url: 'https://proj.supabase.co/storage/v1/object/upload/sign/meal-photos/user-1/analysis-1.jpg',
      method: 'POST',
      headers: { authorization: 'Bearer service-key', apikey: 'service-key' },
    });
    expect(signed.uploadUrl).toBe('https://proj.supabase.co/storage/v1/object/upload/sign/meal-photos/user-1/analysis-1.jpg?token=t');
    expect(Date.parse(signed.expiresAt) - before).toBeGreaterThanOrEqual(SUPABASE_UPLOAD_URL_TTL_MS - 1000);
  });

  it('reads an object back with its media type', async () => {
    const { calls, fetch } = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
    const image = await new SupabaseImageStore({ ...OPTIONS, fetch }).read(PATH);
    expect(calls[0]!.url).toBe('https://proj.supabase.co/storage/v1/object/authenticated/meal-photos/user-1/analysis-1.jpg');
    expect(image.mediaType).toBe('image/png');
    expect([...image.bytes]).toEqual([1, 2, 3]);
  });

  it('treats a missing object as not found rather than an outage', async () => {
    const { fetch } = fakeFetch(() => new Response('{}', { status: 404 }));
    await expect(new SupabaseImageStore({ ...OPTIONS, fetch }).read(PATH)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('removes many objects in one call', async () => {
    const { calls, fetch } = fakeFetch(() => Response.json([]));
    await new SupabaseImageStore({ ...OPTIONS, fetch }).remove([PATH, 'user-1/analysis-2.jpg']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: 'https://proj.supabase.co/storage/v1/object/meal-photos', method: 'DELETE' });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ prefixes: [PATH, 'user-1/analysis-2.jpg'] });
  });

  it('makes no call for nothing to remove', async () => {
    const { calls, fetch } = fakeFetch(() => Response.json([]));
    await new SupabaseImageStore({ ...OPTIONS, fetch }).remove([]);
    expect(calls).toHaveLength(0);
  });

  it('reports a refusal or an unreachable store as upstream_unavailable, without echoing the body', async () => {
    const refused = fakeFetch(() => new Response(`no access to ${PATH}`, { status: 403 }));
    const error = await new SupabaseImageStore({ ...OPTIONS, fetch: refused.fetch }).remove([PATH]).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'upstream_unavailable' });
    expect(String((error as Error).message)).not.toContain(PATH);

    const down = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(new SupabaseImageStore({ ...OPTIONS, fetch: down.fetch }).remove([PATH])).rejects.toMatchObject({
      code: 'upstream_unavailable',
    });
  });
});
