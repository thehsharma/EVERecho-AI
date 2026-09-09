'use client';

import { useEffect, useState } from 'react';
import type { InteractionPreference } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Empty, Notice, Tag } from './ui';

/**
 * Everything EverEcho remembers about how you like to use it.
 *
 * The whole list, always. There is nothing else — no hidden profile, no
 * inferred personality — and the point of showing the complete set is that a
 * person can verify that for themselves rather than take our word for it.
 */
const LABELS: Record<string, { label: string; help: string }> = {
  interface_language: { label: 'Interface language', help: 'Which language the screens use.' },
  captions_enabled: { label: 'Captions', help: 'Whether captions show during a conversation.' },
  speaking_rate: { label: 'Speaking pace', help: 'How quickly the assistant speaks.' },
  interview_pace: { label: 'Interview pace', help: 'How long it waits before asking again.' },
  preferred_session_minutes: {
    label: 'Preferred length',
    help: 'How long you like a conversation to be.',
  },
  clarifying_question_frequency: {
    label: 'Clarifying questions',
    help: 'How often it asks you to be more specific.',
  },
};

export function PreferenceManager() {
  const [preferences, setPreferences] = useState<InteractionPreference[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await api.get<{ preferences: InteractionPreference[] }>(
        '/v1/me/interaction-preferences',
      );
      setPreferences(result.preferences);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not load these.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const forget = async (id: string) => {
    setPending(id);
    try {
      await api.send('DELETE', `/v1/me/interaction-preferences/${id}`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not forget that.');
    } finally {
      setPending(null);
    }
  };

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (preferences === null) return <p className="muted">Loading…</p>;

  return (
    <div className="stack-lg">
      <Notice tone="info" title="This is the whole list">
        <p style={{ marginBottom: 0 }}>
          Only these six things can ever be remembered this way, and the database refuses anything
          else. Nothing about anyone’s life is stored here, ever.
        </p>
      </Notice>

      {preferences.length === 0 ? (
        <Empty title="Nothing is remembered yet">
          Preferences appear here once you set one, or once you allow them to be saved
          automatically.
        </Empty>
      ) : (
        <Card>
          <ul className="preference-list">
            {preferences.map((preference) => (
              <li key={preference.id}>
                <div>
                  <strong>{LABELS[preference.key]?.label ?? preference.key}</strong>
                  <div className="muted">{LABELS[preference.key]?.help}</div>
                </div>
                <div className="row">
                  <code>{preference.value}</code>
                  {preference.origin === 'auto_saved' ? (
                    <Tag>saved automatically</Tag>
                  ) : (
                    <Tag kind="ok">you set this</Tag>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void forget(preference.id)}
                    disabled={pending === preference.id}
                  >
                    Forget this
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
