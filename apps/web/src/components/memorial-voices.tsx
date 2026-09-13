'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
type Voice = { voice_id: string; name: string; verified: boolean };
export function MemorialVoices({
  disabled,
  refresh,
  onConnect,
  onRevoke,
}: {
  disabled: boolean;
  refresh: string | null;
  onConnect: (token: string, name: string) => void;
  onRevoke: () => void;
}) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let live = true;
    void api
      .get<{ voices: Voice[] }>('/v1/memorial/voices')
      .then((r) => {
        if (live) setVoices(r.voices);
      })
      .catch(() => {
        if (live) setNote('Saved voices could not load.');
      });
    return () => {
      live = false;
    };
  }, [refresh]);
  async function connect(voice: Voice) {
    setBusy(true);
    try {
      const r = await api.post<{ voiceToken: string }>(
        '/v1/memorial/voices/' + voice.voice_id + '/connect',
        { authorized: confirmed },
      );
      onConnect(r.voiceToken, voice.name);
      setNote('Voice reconnected.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not reconnect.');
    } finally {
      setBusy(false);
    }
  }
  async function revoke(voice: Voice) {
    setBusy(true);
    try {
      await api.del('/v1/memorial/voices/' + voice.voice_id);
      setVoices((previous) => previous.filter((v) => v.voice_id !== voice.voice_id));
      onRevoke();
      setNote('Voice revoked in EverEcho. Delete the provider copy separately in ElevenLabs.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not revoke.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Previously created voices">
      <h3>Previously created voices</h3>
      <p className="small">
        Reconnect without uploading again. Revoking blocks future EverEcho replies; an already
        submitted provider request may finish. Provider copies remain in ElevenLabs.
      </p>
      <label className="memorial-check">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={disabled || busy}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>
          I still have authorization to use this voice and allow checking its status with
          ElevenLabs.
        </span>
      </label>
      {voices.length === 0 ? (
        <p className="small muted">No saved voices yet.</p>
      ) : (
        voices.map((v) => (
          <div key={v.voice_id}>
            <p>
              {v.name} · {v.verified ? 'Ready to reconnect' : 'Verification required'}
            </p>
            <button
              type="button"
              disabled={disabled || busy || !confirmed}
              onClick={() => void connect(v)}
            >
              Reconnect {v.name}
            </button>{' '}
            <button type="button" disabled={disabled || busy} onClick={() => void revoke(v)}>
              Revoke {v.name}
            </button>
          </div>
        ))
      )}
      {note && <p role="status">{note}</p>}
    </section>
  );
}
