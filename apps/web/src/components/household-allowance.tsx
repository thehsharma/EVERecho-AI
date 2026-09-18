'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
type Group = {
  id: string;
  name: string;
  isOwner: boolean;
  members: { id: string; label: string; pending: boolean; self: boolean }[];
};
export function HouseholdAllowance() {
  const [group, setGroup] = useState<Group | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('Our family');
  const [code, setCode] = useState('');
  const [invitation, setInvitation] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    const r = await api.get<{ household: Group | null }>('/v1/memorial/household');
    setGroup(r.household);
    setLoaded(true);
  }
  useEffect(() => {
    void load().catch(() => setError('Household details are unavailable.'));
  }, []);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack">
      <h2>Share your conversation allowance</h2>
      <p>
        Up to ten people share the owner’s daily hosted-request allowance, including any active paid
        upgrade. Joining does not share profiles, recordings, voices, or archive access. The owner
        sees your display name and the pool’s total usage. Each person’s conversation measurements
        remain private.
      </p>
      {error && <p role="alert">{error}</p>}
      {loaded && !group && (
        <>
          <label htmlFor="household-name">Household name</label>
          <input
            id="household-name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn"
            disabled={busy || !name.trim()}
            onClick={() => void run(() => api.post('/v1/memorial/household', { name }))}
          >
            Create household
          </button>
          <label htmlFor="household-code">Or enter an invitation code</label>
          <input
            id="household-code"
            value={code}
            maxLength={100}
            onChange={(e) => setCode(e.target.value)}
          />
          <label>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I
            agree to share this household’s allowance and my display name with its owner.
          </label>
          <button
            className="btn"
            disabled={busy || !ack || code.length < 40}
            onClick={() =>
              void run(() => api.post('/v1/memorial/household/join', { code, acknowledged: ack }))
            }
          >
            Join household
          </button>
        </>
      )}
      {group && (
        <>
          <h3>{group.name}</h3>
          {group.isOwner && (
            <>
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await api.post<{ code: string; expiresAt: string }>(
                      '/v1/memorial/household/invite',
                    );
                    setInvitation(r.code);
                  })
                }
              >
                Create invitation code
              </button>
              {invitation && (
                <>
                  <p className="small">
                    Share this single-use code privately. It expires in seven days; no message has
                    been sent.
                  </p>
                  <input aria-label="Invitation code to share" readOnly value={invitation} />
                </>
              )}
              <ul>
                {group.members.map((m) => (
                  <li key={m.id}>
                    {m.label}
                    {m.self ? ' (you)' : ''}
                    {m.pending ? ' (pending)' : ''}{' '}
                    {!m.self && (
                      <button
                        className="btn btn-quiet"
                        disabled={busy}
                        onClick={() =>
                          void run(() => api.del('/v1/memorial/household/seats/' + m.id))
                        }
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button
            className="btn"
            disabled={busy}
            onClick={() => void run(() => api.del('/v1/memorial/household'))}
          >
            {group.isOwner ? 'Close household sharing' : 'Leave household'}
          </button>
          <p className="small muted">
            Closing or leaving changes future allowance use. It does not cancel subscriptions or
            delete memories. Already submitted requests may finish.
          </p>
        </>
      )}
    </section>
  );
}
