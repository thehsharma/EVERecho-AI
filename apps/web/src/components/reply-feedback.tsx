'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
export function ReplyFeedback({ turnId }: { turnId: string }) {
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send(value: string) {
    setBusy(true);
    setError('');
    try {
      await api.post('/v1/memorial/quality/' + turnId + '/feedback', { feedback: value });
      setSaved(value);
    } catch {
      setError('Feedback could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="small">
      <label>
        How was this reply?{' '}
        <select
          aria-label="Rate this reply"
          value={saved}
          disabled={busy}
          onChange={(e) => void send(e.target.value)}
        >
          <option value="" disabled>
            Choose feedback
          </option>
          <option value="helpful">Helpful</option>
          <option value="wrong_tone">Wrong tone</option>
          <option value="invented_detail">Invented detail</option>
          <option value="unfamiliar_style">Does not sound like them</option>
        </select>
      </label>
      {saved && <span role="status"> Feedback saved.</span>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
