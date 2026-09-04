'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/api';

export function NewArchiveForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const birthYear = String(form.get('birthYear') ?? '').trim();

    try {
      const created = await api.post<{ id: string }>('/v1/archives', {
        name: String(form.get('name') ?? ''),
        subject: {
          displayName: String(form.get('subjectName') ?? ''),
          ...(birthYear ? { birthYear: Number(birthYear) } : {}),
        },
        subjectIsAdult: true,
      });
      router.push(`/archives/${created.id}/members?invite=storyteller`);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'We could not reach the server. Please try again.',
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack" noValidate>
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      ) : null}

      <div>
        <label htmlFor="subjectName">Whose stories are these?</label>
        <p className="hint" id="subjectName-hint">
          The person the archive is about. Usually not you.
        </p>
        <input id="subjectName" name="subjectName" required aria-describedby="subjectName-hint" />
      </div>

      <div>
        <label htmlFor="name">What should the archive be called?</label>
        <input id="name" name="name" required defaultValue="" placeholder="Ma’s stories" />
      </div>

      <div>
        <label htmlFor="birthYear">Year of birth (optional)</label>
        <p className="hint" id="birthYear-hint">
          Helps place stories on a timeline. {/* v0.1 creates no archives for minors. */}
          Archives are only for adults in this version.
        </p>
        <input
          id="birthYear"
          name="birthYear"
          type="number"
          min={1850}
          max={new Date().getFullYear()}
          aria-describedby="birthYear-hint"
        />
      </div>

      <button type="submit" className="btn btn-primary btn-lg" disabled={pending}>
        {pending ? <span className="spinner-text">Creating</span> : 'Create the archive'}
      </button>
    </form>
  );
}
