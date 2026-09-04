'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiRequestError } from '@/lib/api';

export function AuthForm({
  mode,
  legalCopyVersion,
  productName,
}: {
  mode: 'sign-in' | 'sign-up';
  legalCopyVersion: string;
  productName: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/archives';

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    try {
      if (mode === 'sign-up') {
        await api.post('/v1/auth/sign-up', {
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
          displayName: String(form.get('displayName') ?? ''),
          acceptedLegalCopyVersion: legalCopyVersion,
        });
      } else {
        await api.post('/v1/auth/sign-in', {
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
        });
      }
      router.push(next);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.message);
        setFieldErrors(
          Object.fromEntries(
            (caught.fieldErrors ?? []).map((f) => [f.path.split('.').pop() ?? f.path, f.message]),
          ),
        );
      } else {
        setError('We could not reach the server. Please check your connection and try again.');
      }
      setPending(false);
    }
  }

  const describe = (field: string) => (fieldErrors[field] ? `${field}-error` : undefined);

  return (
    <form onSubmit={onSubmit} className="stack" noValidate>
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      ) : null}

      {mode === 'sign-up' ? (
        <div>
          <label htmlFor="displayName">Your name</label>
          <input
            id="displayName"
            name="displayName"
            autoComplete="name"
            required
            aria-invalid={Boolean(fieldErrors.displayName)}
            aria-describedby={describe('displayName')}
          />
          {fieldErrors.displayName ? (
            <p id="displayName-error" className="small" style={{ color: 'var(--danger)' }}>
              {fieldErrors.displayName}
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={describe('email')}
        />
        {fieldErrors.email ? (
          <p id="email-error" className="small" style={{ color: 'var(--danger)' }}>
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="password">Password</label>
        {mode === 'sign-up' ? (
          <p className="hint" id="password-hint">
            At least 12 characters. A short phrase you will remember works better than something
            complicated you will not.
          </p>
        ) : null}
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          required
          minLength={mode === 'sign-up' ? 12 : undefined}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={
            [mode === 'sign-up' ? 'password-hint' : null, describe('password')]
              .filter(Boolean)
              .join(' ') || undefined
          }
        />
        {fieldErrors.password ? (
          <p id="password-error" className="small" style={{ color: 'var(--danger)' }}>
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

      {mode === 'sign-up' ? (
        <p className="small muted">
          Creating an account means you accept the {productName} terms, version {legalCopyVersion}.
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary btn-lg" disabled={pending}>
        {pending ? (
          <span className="spinner-text">
            {mode === 'sign-up' ? 'Creating your account' : 'Signing you in'}
          </span>
        ) : mode === 'sign-up' ? (
          'Create account'
        ) : (
          'Sign in'
        )}
      </button>

      <p className="small">
        {mode === 'sign-up' ? (
          <>
            Already have an account? <Link href="/sign-in">Sign in</Link>
          </>
        ) : (
          <>
            No account yet? <Link href="/sign-up">Create one</Link>
          </>
        )}
      </p>
    </form>
  );
}
