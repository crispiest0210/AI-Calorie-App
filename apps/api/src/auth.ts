/**
 * Supabase Auth issues HS256 JWTs signed with the project's JWT secret, so
 * verification needs no network call. The subject claim is the user id every
 * row-level policy is written against.
 */
import { jwtVerify, SignJWT } from 'jose';
import { ApiError } from './errors';

export interface AuthConfig {
  jwtSecret: string;
  /** Rejects tokens issued for another project. */
  issuer?: string;
  audience?: string;
}

export interface AuthenticatedUser {
  id: string;
  /** Issued-at, used by the "recent re-auth" rule on account deletion (4.2). */
  issuedAt: number;
}

export async function verifyToken(token: string, config: AuthConfig): Promise<AuthenticatedUser> {
  const key = new TextEncoder().encode(config.jwtSecret);
  try {
    const { payload } = await jwtVerify(token, key, {
      ...(config.issuer === undefined ? {} : { issuer: config.issuer }),
      ...(config.audience === undefined ? {} : { audience: config.audience }),
    });
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new ApiError('unauthorized', 'token has no subject');
    }
    return { id: payload.sub, issuedAt: typeof payload.iat === 'number' ? payload.iat : 0 };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('unauthorized', 'token is invalid or expired');
  }
}

export function bearerToken(header: string | undefined): string {
  if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
    throw new ApiError('unauthorized', 'expected an Authorization: Bearer header');
  }
  return header.slice(7).trim();
}

/** Test and local-development helper; production tokens come from Supabase. */
export async function signTestToken(userId: string, config: AuthConfig, issuedAt = Math.floor(Date.now() / 1000)): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(issuedAt)
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(config.jwtSecret));
}
