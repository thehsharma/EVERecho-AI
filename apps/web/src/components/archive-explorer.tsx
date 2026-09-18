'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Archive, Memory, Entity, Relationship } from '@everecho/contracts';
import { api } from '@/lib/api';
export function ArchiveExplorer({
  archive,
  memories,
  entities,
  relationships,
}: {
  archive: Archive;
  memories: Memory[];
  entities: Entity[];
  relationships: Relationship[];
}) {
  const [search, setSearch] = useState('');
  const [person, setPerson] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState(archive.subjectDisplayName + ' — family stories');
  const [dedication, setDedication] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const canExport = archive.viewerCapabilities.includes('export.create');
  const shown = useMemo(
    () =>
      memories.filter(
        (m) =>
          (!person || m.entityIds.includes(person)) &&
          (!search.trim() ||
            [m.title, m.body, m.placeName, m.occurredAt?.value]
              .filter(Boolean)
              .join(' ')
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase())),
      ),
    [memories, person, search],
  );
  const base = '/archives/' + archive.id;
  async function download() {
    setBusy(true);
    setNotice('');
    try {
      const r = await api.post<{ html: string; count: number }>(
        '/v1/archives/' + archive.id + '/keepsake',
        { title, dedication, memoryIds: selected },
      );
      const url = URL.createObjectURL(new Blob([r.html], { type: 'text/html;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'family-stories.html';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setNotice(
        'Downloaded ' + r.count + ' approved stories. Open the file and use Print to save a PDF.',
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'The keepsake could not be created.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="grid">
        <div>
          <label htmlFor="memory-search">Find a story, place, or date</label>
          <input
            id="memory-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Try a place or a familiar phrase"
          />
        </div>
        <div>
          <label htmlFor="memory-person">Stories mentioning</label>
          <select id="memory-person" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p role="status">
        {shown.length} matching stories from the {memories.length} loaded. Up to 100 approved
        stories are shown here.
      </p>
      {relationships.length > 0 && (
        <details>
          <summary>Family connections recorded in this archive</summary>
          <ul>
            {relationships.map((r) => (
              <li key={r.id}>
                {r.fromEntityName} — {r.kind} — {r.toEntityName}
                {r.status !== 'approved' ? ' (awaiting review)' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!shown.length && (
        <section className="card">
          <h2>No matching story yet</h2>
          <p>Try another phrase or ask the storyteller. No missing details will be invented.</p>
          <Link href={base + '/questions'}>Ask the storyteller</Link>
        </section>
      )}
      {shown.map((m) => (
        <article className="card" key={m.id}>
          <h2>
            <Link href={base + '/memories/' + m.id}>{m.title}</Link>
          </h2>
          <p className="small muted">
            {m.occurredAt
              ? m.occurredAt.value + ' (' + m.occurredAt.precision + ')'
              : 'Date not recorded'}
            {m.placeName ? ' · ' + m.placeName : ''}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
          <p className="small muted">
            {m.claims.filter((c) => c.status === 'approved').length} approved claims ·{' '}
            {new Set(m.claims.flatMap((c) => c.evidence.map((e) => e.sourceAssetId))).size} attached
            sources
          </p>
          {m.claims.some((c) => c.contradictionIds.length > 0) && (
            <p className="notice">
              This story has differing accounts. Open it to review the evidence.
            </p>
          )}
          <div className="row">
            <Link href={base + '/memories/' + m.id}>Read sources and corrections</Link>
            {archive.viewerCapabilities.includes('voice.listen') && (
              <Link href={base + '/listen'}>Listen to original recordings</Link>
            )}
          </div>
          {canExport && (
            <label>
              <input
                type="checkbox"
                checked={selected.includes(m.id)}
                disabled={busy || (!selected.includes(m.id) && selected.length >= 20)}
                onChange={(e) =>
                  setSelected((ids) =>
                    e.target.checked ? [...ids, m.id] : ids.filter((id) => id !== m.id),
                  )
                }
              />{' '}
              Include in my keepsake
            </label>
          )}
        </article>
      ))}
      {canExport && (
        <section className="card stack">
          <h2>Make a family keepsake</h2>
          <p>
            Choose up to 20 approved stories. Export permissions are checked again before download.
            This creates a private text collection with source references.
          </p>
          <label htmlFor="keepsake-title">Collection title</label>
          <input
            id="keepsake-title"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label htmlFor="keepsake-dedication">Dedication (optional)</label>
          <textarea
            id="keepsake-dedication"
            rows={3}
            maxLength={500}
            value={dedication}
            onChange={(e) => setDedication(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={busy || !selected.length || !title.trim()}
            onClick={() => void download()}
          >
            Download keepsake ({selected.length} stories)
          </button>
          {notice && <p role="status">{notice}</p>}
          <Link href={base + '/export'}>Export the complete archive, including original files</Link>
        </section>
      )}
    </div>
  );
}
