import { assertThirdPerson, splitSentences } from '@everecho/ai';
import type { JobArgs } from './ingest';
import { assertProcessingAllowed } from '../context';

/**
 * Builds the life timeline from approved events and dated memories.
 *
 * Undated material is kept separate rather than being placed at a guessed year.
 * The gaps are reported honestly, because a decade with nothing in it is the
 * most useful thing the next interview could know.
 */
export async function buildTimeline({ ctx, tx, archiveId }: JobArgs): Promise<void> {
  await assertProcessingAllowed(ctx, tx, {
    archiveId,
    action: 'timeline.read',
    resource: { type: 'timeline' },
  });

  const rows = await tx.query<{
    id: string;
    kind: string;
    title: string;
    body: string;
    occurred_on: string | null;
    occurred_precision: string | null;
    place_name: string | null;
    evidence_class: string;
    memory_id: string | null;
    source_ids: string[];
  }>(
    `SELECT m.id, 'memory' AS kind, m.title, m.body, m.occurred_on, m.occurred_precision,
            p.name AS place_name, m.evidence_class, m.id AS memory_id,
            coalesce(array_agg(DISTINCT e.source_asset_id) FILTER (WHERE e.id IS NOT NULL), '{}') AS source_ids
     FROM memory m
     LEFT JOIN place p ON p.id = m.place_id
     LEFT JOIN claim c ON c.memory_id = m.id
     LEFT JOIN claim_evidence e ON e.claim_id = c.id
     WHERE m.archive_id = $1 AND m.status = 'approved' AND m.deleted_at IS NULL
     GROUP BY m.id, p.name
     ORDER BY m.occurred_on NULLS LAST, m.created_at`,
    [archiveId],
  );

  const entries = rows.map((row) => ({
    id: row.id,
    kind: 'memory' as const,
    title: row.title,
    summary: splitSentences(row.body)[0] ?? row.body.slice(0, 200),
    date: row.occurred_on
      ? { value: row.occurred_on, precision: (row.occurred_precision ?? 'year') as 'year' }
      : null,
    placeName: row.place_name,
    evidenceClass: row.evidence_class,
    sourceIds: row.source_ids,
    memoryId: row.memory_id,
  }));

  const dated = entries.filter((e) => e.date !== null);
  const years = dated.map((e) => Number(e.date!.value.slice(0, 4))).filter(Number.isFinite);
  const decades = [...new Set(years.map((y) => Math.floor(y / 10) * 10))].sort();
  const gaps: number[] = [];
  for (let d = decades[0] ?? 0; d < (decades.at(-1) ?? 0); d += 10) {
    if (!decades.includes(d)) gaps.push(d);
  }

  await tx.query(
    `INSERT INTO generated_artifact (archive_id, kind, content, status, model_version, prompt_version, policy_version)
     VALUES ($1, 'timeline', $2, 'draft', $3, 'timeline-2026-01', $4)
     ON CONFLICT (archive_id, kind) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [
      archiveId,
      JSON.stringify({
        entries: dated,
        undatedEntries: entries.filter((e) => e.date === null),
        coverage: {
          earliestYear: years.length > 0 ? Math.min(...years) : null,
          latestYear: years.length > 0 ? Math.max(...years) : null,
          decadesCovered: decades,
          decadeGaps: gaps,
        },
        generatedAt: new Date().toISOString(),
      }),
      'deterministic-timeline',
      await policyVersion(tx, archiveId),
    ],
  );
}

/**
 * Composes a short third-person biography from approved memories only.
 *
 * Every sentence is checked before it is stored: first-person composition about
 * the storyteller throws rather than being saved, which is the technical form
 * of "this product does not impersonate anyone".
 */
export async function composeBiography({ ctx, tx, archiveId }: JobArgs): Promise<void> {
  await assertProcessingAllowed(ctx, tx, {
    archiveId,
    action: 'biography.generate',
    resource: { type: 'biography' },
  });

  const archive = await tx.one<{ subject_display_name: string }>(
    `SELECT p.display_name AS subject_display_name FROM archive a
     JOIN person p ON p.id = a.subject_person_id WHERE a.id = $1`,
    [archiveId],
  );

  const memories = await tx.query<{
    id: string;
    title: string;
    body: string;
    occurred_on: string | null;
    topics: string[];
    source_ids: string[];
    claim_ids: string[];
  }>(
    `SELECT m.id, m.title, m.body, m.occurred_on, m.topics,
            coalesce(array_agg(DISTINCT e.source_asset_id) FILTER (WHERE e.id IS NOT NULL), '{}') AS source_ids,
            coalesce(array_agg(DISTINCT c.id) FILTER (WHERE c.id IS NOT NULL), '{}') AS claim_ids
     FROM memory m
     LEFT JOIN claim c ON c.memory_id = m.id AND c.status = 'approved'
     LEFT JOIN claim_evidence e ON e.claim_id = c.id
     WHERE m.archive_id = $1 AND m.status = 'approved' AND m.deleted_at IS NULL
     GROUP BY m.id ORDER BY m.occurred_on NULLS LAST`,
    [archiveId],
  );
  if (memories.length === 0) return;

  const sections = await ctx.llm.composeBiography({
    subjectName: archive.subject_display_name,
    memories: memories.map((m) => ({
      id: m.id,
      title: m.title,
      body: m.body,
      occurredOn: m.occurred_on,
      topics: m.topics,
      sourceIds: m.source_ids,
      claimIds: m.claim_ids,
    })),
  });

  for (const section of sections) assertThirdPerson(section.text);

  await tx.query(
    `INSERT INTO generated_artifact (archive_id, kind, content, status, model_version, prompt_version, policy_version)
     VALUES ($1, 'biography', $2, 'draft', $3, 'biography-2026-01', $4)
     ON CONFLICT (archive_id, kind) DO UPDATE SET
       content = EXCLUDED.content, model_version = EXCLUDED.model_version, updated_at = now()`,
    [
      archiveId,
      JSON.stringify({
        sections: sections.map((s) => ({ ...s, edited: false })),
        wordCount: sections.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0),
        generatedAt: new Date().toISOString(),
      }),
      ctx.llm.modelVersion,
      await policyVersion(tx, archiveId),
    ],
  );
}

async function policyVersion(tx: JobArgs['tx'], archiveId: string): Promise<string> {
  const row = await tx.maybeOne<{ version: number }>(
    `SELECT version FROM consent_policy WHERE archive_id = $1 AND superseded_at IS NULL`,
    [archiveId],
  );
  return `archive-policy-v${row?.version ?? 0}`;
}
