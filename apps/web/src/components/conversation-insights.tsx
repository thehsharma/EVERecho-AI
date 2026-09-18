'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
type Stats = {
  turns: number;
  hosted: number;
  failed: number;
  voiceFailed: number;
  averageResponseMs: number;
  speechCharacters: number;
  audioBytes: number;
  helpful: number;
  reported: number;
};
export function ConversationInsights() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      setStats(await api.get<Stats>('/v1/memorial/quality'));
    } catch {
      setError('Measurements are unavailable. Check that the API is running.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function clear() {
    setBusy(true);
    try {
      await api.del('/v1/memorial/quality');
      await refresh();
    } catch {
      setError('Could not delete the measurements.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <p>
        Last 30 days, for your account only. These measurements contain no conversation text, names,
        or recordings. Older records are removed when you next use the studio.
      </p>
      {error && <p role="alert">{error}</p>}
      {stats && (
        <>
          <div className="grid">
            {[
              ['Replies requested', stats.turns],
              ['Hosted requests', stats.hosted],
              ['Failed requests', stats.failed],
              ['Voice failures', stats.voiceFailed],
              ['Helpful ratings', stats.helpful],
              ['Reported replies', stats.reported],
            ].map(([label, value]) => (
              <section className="card" key={label}>
                <h2>{label}</h2>
                <p>{value}</p>
              </section>
            ))}
          </div>
          <p>
            Average successful server response: {(stats.averageResponseMs / 1000).toFixed(2)}{' '}
            seconds. This includes generation and does not measure time to first audible sound.
          </p>
          <p>
            {stats.speechCharacters.toLocaleString()} characters prepared for speech ·{' '}
            {(stats.audioBytes / 1024).toFixed(1)} KB audio returned.
          </p>
        </>
      )}
      <p>
        Counts are measurements, not provider invoices or proof of factual accuracy. Review flagged
        replies during a session; the conversation itself is not saved here.
      </p>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => void refresh()}>
          Refresh measurements
        </button>
        <button className="btn" disabled={busy || !stats?.turns} onClick={() => void clear()}>
          Delete my measurements
        </button>
        <Link href="/memorial">Back to studio</Link>
      </div>
    </div>
  );
}
