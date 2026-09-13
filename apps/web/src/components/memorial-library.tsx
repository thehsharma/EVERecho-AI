'use client';

import { useEffect, useState } from 'react';
import type { MemorialProfile, SavedMemorial } from '@everecho/contracts';
import { api } from '@/lib/api';

export function MemorialLibrary({
  profile,
  onLoad,
  disabled,
  acknowledged,
}: {
  profile: MemorialProfile;
  onLoad: (profile: MemorialProfile) => void;
  disabled: boolean;
  acknowledged: boolean;
}) {
  const [items, setItems] = useState<SavedMemorial[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number; resetsAt: string } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    void api
      .get<{ profiles: SavedMemorial[] }>('/v1/memorial/profiles')
      .then((r) => {
        if (live) setItems(r.profiles);
      })
      .catch(() => {
        if (live) setNotice('Saved profiles could not load. You can still use the studio.');
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (disabled) return;
    let live = true;
    void api
      .get<{ used: number; limit: number; resetsAt: string }>('/v1/memorial/usage')
      .then((r) => {
        if (live) setUsage(r);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [disabled]);
  async function save(copy = false) {
    setBusy(true);
    setNotice('');
    try {
      const item = await api.post<SavedMemorial>('/v1/memorial/profiles', {
        ...(selected && !copy ? { id: selected } : {}),
        profile,
        acknowledged,
      });
      setItems((previous) => [item, ...previous.filter((p) => p.id !== item.id)]);
      setSelected(item.id);
      setNotice('Profile saved privately to your account.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save the profile.');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api.del(`/v1/memorial/profiles/${selected}`);
      setItems((previous) => previous.filter((p) => p.id !== selected));
      setSelected('');
      setConfirmDelete(false);
      setNotice(
        'Saved copy deleted. The current form remains until you reload or clear it. Provider voices are managed separately in ElevenLabs.',
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not delete the profile.');
    } finally {
      setBusy(false);
    }
  }
  function exportProfile() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: 'everecho-memorial-v1',
            disclosure: 'Supplied reference notes for an AI simulation; not generated evidence.',
            profile,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'everecho-memorial-profile.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="memorial-library" aria-labelledby="library-title">
      <h2 id="library-title">Your saved profiles</h2>
      <p>
        Save reference notes privately to this account. Conversation audio and dialogue are not
        saved with the profile.
      </p>
      <fieldset disabled={disabled || busy}>
        <label htmlFor="saved-memorial">Choose a saved profile</label>
        <select
          id="saved-memorial"
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            setConfirmDelete(false);
            setNotice('');
            const item = items.find((p) => p.id === event.target.value);
            if (item) onLoad(item.profile);
          }}
        >
          <option value="">Unsaved profile</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.profile.name}
            </option>
          ))}
        </select>
        <div className="memorial-actions">
          <button
            type="button"
            disabled={!acknowledged || !profile.name.trim() || !profile.memories.trim()}
            onClick={() => void save()}
          >
            Save profile
          </button>
          {selected && (
            <button
              type="button"
              disabled={!acknowledged || !profile.name.trim() || !profile.memories.trim()}
              onClick={() => void save(true)}
            >
              Save as new profile
            </button>
          )}
          <button type="button" disabled={!profile.name.trim()} onClick={exportProfile}>
            Export notes
          </button>
          {selected && (
            <button type="button" onClick={() => setConfirmDelete(true)}>
              Delete saved profile
            </button>
          )}
        </div>
        {confirmDelete && (
          <div role="group" aria-label="Confirm profile deletion">
            <p>Delete this saved profile permanently? Export it first if you want a copy.</p>
            <button type="button" onClick={() => void remove()}>
              Confirm deletion
            </button>{' '}
            <button type="button" onClick={() => setConfirmDelete(false)}>
              Keep profile
            </button>
          </div>
        )}
      </fieldset>
      {notice && <p role="status">{notice}</p>}
      {usage && (
        <p className="small muted">
          Hosted AI requests today: {usage.used} / {usage.limit}. Resets{' '}
          {new Date(usage.resetsAt).toLocaleString()}. Failed provider requests also count; local
          preview is not metered.
        </p>
      )}
    </section>
  );
}
