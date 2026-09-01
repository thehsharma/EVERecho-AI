import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { MeResponse } from '@everecho/contracts';
import { API_URL, ApiRequestError } from './api';

/**
 * Server-side fetch with the caller's cookies forwarded.
 *
 * Route protection happens here, on the server, before any page renders. The
 * client-side guards elsewhere are a courtesy to the reader, not the control:
 * manipulating a URL, an id or local state changes nothing, because every API
 * route re-checks the consent policy independently.
 */
export async function serverFetch<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(`${API_URL}${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: 'no-store',
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string; reasonCode?: string } }).error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'internal_error',
      error?.message ?? 'Something went wrong.',
      error?.reasonCode,
    );
  }
  return body as T;
}

/** Returns the signed-in account, or sends the visitor to sign in. */
export async function requireUser(returnTo?: string): Promise<MeResponse> {
  try {
    return await serverFetch<MeResponse>('/v1/me');
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
      redirect(`/sign-in${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ''}`);
    }
    throw error;
  }
}

export async function optionalUser(): Promise<MeResponse | null> {
  try {
    return await serverFetch<MeResponse>('/v1/me');
  } catch {
    return null;
  }
}

export interface ProductMeta {
  productName: string;
  supportEmail: string;
  dataRegion: string;
  jurisdiction: string;
  legalCopyVersion: string;
  consentCopyVersion: string;
  trademarkStatus: string;
  features: { performMode: false; successionExecution: false; demoMode: boolean; billing: boolean };
  limits: { uploadMaxBytes: number; allowedMimeTypes: string[] };
  providers: { composition: string; transcription: string; ocr: string; compositionIsExtractive: boolean };
}

export async function productMeta(): Promise<ProductMeta> {
  try {
    return await serverFetch<ProductMeta>('/v1/meta');
  } catch {
    // The marketing pages must render even if the API is unreachable.
    return {
      productName: 'EverEcho',
      supportEmail: 'support@everecho.example',
      dataRegion: 'local',
      jurisdiction: 'IN',
      legalCopyVersion: 'legal-copy-2026-01-draft',
      consentCopyVersion: 'consent-copy-2026-01',
      trademarkStatus: 'working-codename-pending-clearance',
      features: { performMode: false, successionExecution: false, demoMode: true, billing: true },
      limits: { uploadMaxBytes: 524_288_000, allowedMimeTypes: [] },
      providers: {
        composition: 'unavailable',
        transcription: 'unavailable',
        ocr: 'unavailable',
        compositionIsExtractive: true,
      },
    };
  }
}
