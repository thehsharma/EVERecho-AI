import { randomUUID, scryptSync, randomBytes } from 'node:crypto';
import {
  compileConsentPolicy,
  compileLearningPolicy,
  defaultConsentDocument,
  defaultLearningDocument,
} from '@everecho/consent';
import type { ConsentPolicyDocument } from '@everecho/contracts';
import { enqueueJob } from '@everecho/db';
import { drainQueue } from './runner';
import type { PipelineContext } from './context';

/**
 * A synthetic demonstration archive.
 *
 * Every person, place and story below is invented. No real personal data is
 * bundled with this repository, and nothing here is drawn from a real family.
 * The recordings are short text files standing in for audio, carrying the same
 * "text captured alongside the recording" that a browser interview produces —
 * so the demo exercises the real ingestion, provenance and abstention paths
 * rather than a happy path around them.
 */

const DEMO_PASSWORD = 'demo-passphrase-2026';

export interface SeedResult {
  archiveId: string;
  users: { role: string; email: string; password: string }[];
  counts: { sources: number; memories: number; approved: number };
}

interface SeedRecording {
  filename: string;
  kind: 'audio' | 'document';
  mimeType: string;
  text: string;
  sensitivity?: 'normal' | 'sensitive';
}

const RECORDINGS: readonly SeedRecording[] = [
  {
    filename: 'session-01-childhood.webm',
    kind: 'audio',
    mimeType: 'audio/webm',
    text: [
      'I was born in Nagpur in 1948, in a house with a courtyard in the middle.',
      'We moved to Pune in 1962 because my father took a job on the railways.',
      'The kitchen in that house always smelled of cardamom and frying onions.',
      'My mother Sushila cooked for eleven people every evening and never once complained about it.',
    ].join(' '),
  },
  {
    filename: 'session-02-school.webm',
    kind: 'audio',
    mimeType: 'audio/webm',
    text: [
      'My brother Ramesh taught me to ride a bicycle in the lane behind the house.',
      'I studied at Fergusson College and I was good at mathematics, though I never told anyone that I liked it.',
      'There was a teacher called Mr Joshi who lent me his own textbooks because we could not afford them.',
      'I have thought about him often since.',
    ].join(' '),
  },
  {
    filename: 'session-03-work.webm',
    kind: 'audio',
    mimeType: 'audio/webm',
    text: [
      'I started teaching in 1971, at a school near the cantonment.',
      'The first class I ever taught had fifty-three children in it and one blackboard.',
      'I taught for thirty-one years and I can still name most of them.',
      'What I would tell anyone starting out is that children forget what you told them and remember how you treated them.',
    ].join(' '),
  },
  {
    filename: 'letter-1974-transfer.txt',
    kind: 'document',
    mimeType: 'text/plain',
    text: [
      'Office of the District Education Officer',
      '',
      'This is to record that Smt. Kamala Deshpande was transferred to the Model High School, Pune, with effect from June 1974.',
      '',
      'Her service since 1971 has been satisfactory in every respect.',
    ].join('\n\n'),
  },
  {
    filename: 'session-05-money.webm',
    kind: 'audio',
    mimeType: 'audio/webm',
    text: [
      'There were years when money was very tight and we counted every rupee.',
      'I did not want the children to know, so I never said it in front of them.',
      'We managed, and I would rather the family did not dwell on it.',
    ].join(' '),
    sensitivity: 'sensitive',
  },
  {
    // People do not narrate with footnotes. This session leaves several things
    // genuinely unexplained — an unnamed "he", a date given as a feeling, a
    // place called "back there", a story referred to and not told — so the
    // coverage radar has real material rather than a contrived example.
    filename: 'session-06-leaving.webm',
    kind: 'audio',
    mimeType: 'audio/webm',
    text: [
      'He told us to leave before the monsoon, and we did, with two trunks between us.',
      'My cousin sent word from Nagpur a few years later, when things had settled down.',
      'We went back there every summer until the house was sold.',
      'The neighbour kept our things safe the whole time we were away.',
      'There was a woman on the platform who sat with the children the whole way, but that is another story.',
    ].join(' '),
  },
  {
    // A second one, later in life and on a different subject. Two sessions
    // rather than one long list: five unexplained things in a single sitting
    // reads as a contrivance, and the demonstration archive is meant to look
    // like somebody talking.
    filename: 'session-07-after.webm',
    kind: 'audio',
    mimeType: 'audio/webm',
    text: [
      'My friend drove down from Nashik the week after the funeral and stayed with me.',
      'That man from the bank came twice about the papers and I never did understand what he wanted.',
      'We had lived at the old house for so long that the new one did not feel like anywhere for years.',
      'Somebody left flowers at the gate every Thursday and never once knocked.',
    ].join(' '),
  },
  {
    filename: 'session-04-family.webm',
    kind: 'audio',
    mimeType: 'audio/webm',
    text: [
      'I met Vijay at a wedding in 1969 and we were married two years later.',
      'He was quiet in a way I mistook for coldness for about a month, and then I understood him.',
      'We moved to Pune in 1968, before we were married, when his work brought him there.',
      'Our daughter Anjali was born in 1975.',
    ].join(' '),
    // Deliberately contradicts session-01 on the year of the move to Pune, so
    // the demo has a real contradiction for the storyteller to resolve.
  },
];

export async function seedDemoArchive(ctx: PipelineContext): Promise<SeedResult> {
  const buyer = await upsertUser(ctx, 'anil@everecho.example', 'Anil Deshpande');
  const storyteller = await upsertUser(ctx, 'kamala@everecho.example', 'Kamala Deshpande');
  const familyMember = await upsertUser(ctx, 'anjali@everecho.example', 'Anjali Deshpande');
  const contributor = await upsertUser(ctx, 'ravi@everecho.example', 'Ravi Deshpande');
  // Created so the restricted admin surface has an account to demonstrate.
  await upsertUser(ctx, 'support@everecho.example', 'Support', { admin: true });

  const archiveId = await ctx.db.transaction(async (tx) => {
    const person = await tx.one<{ id: string }>(
      `INSERT INTO person (display_name, given_name, family_name, birth_year)
       VALUES ('Kamala Deshpande', 'Kamala', 'Deshpande', 1948) RETURNING id`,
    );
    const household = await tx.one<{ id: string }>(
      `INSERT INTO household (name, created_by_user_id) VALUES ('The Deshpande family', $1) RETURNING id`,
      [buyer],
    );
    const archive = await tx.one<{ id: string }>(
      `INSERT INTO archive (household_id, subject_person_id, name, status, buyer_user_id,
                            storyteller_user_id, created_by_user_id, data_region)
       VALUES ($1, $2, 'Kamala’s stories', 'active', $3, $4, $3, $5) RETURNING id`,
      [household.id, person.id, buyer, storyteller, ctx.cfg.env.DATA_REGION],
    );

    for (const [userId, role, name] of [
      [storyteller, 'storyteller', 'Kamala Deshpande'],
      [buyer, 'buyer', 'Anil Deshpande'],
      [familyMember, 'family', 'Anjali Deshpande'],
      [contributor, 'contributor', 'Ravi Deshpande'],
    ] as const) {
      await tx.query(
        `INSERT INTO membership (archive_id, user_id, email, display_name, role, status, granted_at)
         VALUES ($1, $2, $3, $4, $5, 'active', now())`,
        [archive.id, userId, `${name.split(' ')[0]!.toLowerCase()}@everecho.example`, name, role],
      );
    }

    return archive.id;
  });

  // Consent rows are under row-level security, so they are written inside an
  // archive scope — the same path the API uses. The seed gets no exemption.
  await ctx.db.withArchiveScope(archiveId, async (tx) => {
    await tx.query(
      `INSERT INTO teach_back_result (archive_id, user_id, attempt, answers, passed, consent_copy_version)
       VALUES ($1, $2, 1, '[]'::jsonb, true, $3)`,
      [archiveId, storyteller, ctx.cfg.env.CONSENT_COPY_VERSION],
    );

    const { document, policyHash } = compileConsentPolicy(demoConsentDocument());
    const policy = await tx.one<{ id: string }>(
      `INSERT INTO consent_policy (archive_id, version, mode, document, policy_hash,
                                   consent_copy_version, legal_copy_version, policy_engine_version,
                                   created_by_user_id)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        archiveId,
        document.mode,
        JSON.stringify(document),
        policyHash,
        ctx.cfg.env.CONSENT_COPY_VERSION,
        ctx.cfg.env.LEGAL_COPY_VERSION,
        ctx.branding.policyEngineVersion,
        storyteller,
      ],
    );
    await tx.query(`UPDATE archive SET current_consent_policy_id = $2 WHERE id = $1`, [
      archiveId,
      policy.id,
    ]);
    await tx.query(
      `INSERT INTO consent_record (archive_id, consent_policy_id, actor_user_id, action, summary)
       VALUES ($1, $2, $3, 'granted', 'Demonstration archive seeded with full consent.')`,
      [archiveId, policy.id, storyteller],
    );

    // A learning policy, so the demonstration archive can hold a conversation
    // immediately. Everything stays local and everything waits for review —
    // the defaults, plus a transcript that is kept so a demonstration can be
    // looked at afterwards.
    const learning = compileLearningPolicy({
      ...defaultLearningDocument(),
      transcriptRetention: 'until_deleted',
    });
    await tx.query(
      `INSERT INTO learning_policy (archive_id, version, document, policy_hash,
                                    policy_engine_version, created_by_user_id)
       VALUES ($1, 1, $2, $3, $4, $5)`,
      [
        archiveId,
        JSON.stringify(learning.document),
        learning.policyHash,
        ctx.branding.policyEngineVersion,
        storyteller,
      ],
    );
  });

  // Each recording goes through the real ingestion path: quarantine, scan,
  // promote to an immutable original, transcribe, extract candidates.
  for (const recording of RECORDINGS) {
    const bytes =
      recording.kind === 'audio'
        ? Buffer.concat([
            Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
            Buffer.from(recording.text, 'utf8'),
          ])
        : Buffer.from(recording.text, 'utf8');

    await ctx.db.withArchiveScope(archiveId, async (tx) => {
      const source = await tx.one<{ id: string }>(
        `INSERT INTO source_asset (archive_id, kind, status, original_filename, mime_type, byte_size,
                                   storage_key, quarantine_key, privacy, sensitivity,
                                   uploaded_by_user_id, processing_stage, checksum_sha256)
         VALUES ($1,$2,'quarantined',$3,$4,$5,'','',$6,$7,$8,'scanning',$9) RETURNING id`,
        [
          archiveId,
          recording.kind,
          recording.filename,
          recording.mimeType,
          bytes.length,
          JSON.stringify({
            allowTranscription: true,
            allowOcr: true,
            allowEmbedding: true,
            allowGeneration: true,
            allowExport: true,
            sensitivity: recording.sensitivity ?? 'normal',
            dataCategories: [recording.kind === 'audio' ? 'audio' : 'document'],
          }),
          recording.sensitivity ?? 'normal',
          storyteller,
          randomBytes(32).toString('hex'),
        ],
      );
      const key = `archives/${archiveId}/quarantine/${source.id}`;
      await ctx.storage.put(key, bytes, recording.mimeType);
      await tx.query(`UPDATE source_asset SET quarantine_key = $2 WHERE id = $1`, [source.id, key]);

      if (recording.kind === 'audio') {
        await tx.query(
          `INSERT INTO provenance_record (archive_id, subject_type, subject_id, record)
           VALUES ($1, 'sidecar_text', $2, $3)`,
          [
            archiveId,
            source.id,
            JSON.stringify({ text: recording.text, durationMs: 60_000, capturedBy: 'browser' }),
          ],
        );
      }
      await enqueueJob(tx, {
        archiveId,
        type: 'scan_source',
        payload: { sourceId: source.id },
        idempotencyKey: `scan:${source.id}`,
      });
    });
  }

  await drainQueue(ctx, { workerId: 'seed' });

  /**
   * Questions the family has already asked.
   *
   * Demo mode opens on a loop that is already turning, not on an empty inbox:
   * one waiting, one answered, one declined — the three shapes a storyteller
   * needs to see to understand that saying no is a normal outcome rather than
   * a failure. All invented, like everything else here.
   */
  await ctx.db.withArchiveScope(archiveId, async (tx) => {
    const questions = [
      {
        body: 'What did the kitchen in Pune smell like in the mornings?',
        topic: 'home',
        status: 'pending' as const,
      },
      {
        body: 'Who taught you to ride a bicycle?',
        topic: 'childhood',
        status: 'pending' as const,
      },
      {
        body: 'Why did you and your brother stop speaking for so long?',
        topic: 'family',
        status: 'declined' as const,
      },
    ];

    for (const question of questions) {
      const row = await tx.one<{ id: string }>(
        `INSERT INTO family_question
           (archive_id, asked_by_user_id, body, topic, status, decided_at, decline_reason)
         VALUES ($1,$2,$3,$4,$5,
                 CASE WHEN $5 = 'pending' THEN NULL ELSE now() END,
                 CASE WHEN $5 = 'declined' THEN $6 ELSE NULL END)
         RETURNING id`,
        [
          archiveId,
          familyMember,
          question.body,
          question.topic,
          question.status,
          'Still too raw. Maybe one day, but not in writing.',
        ],
      );
      if (question.status === 'declined') {
        await tx.query(
          `INSERT INTO family_question_response
             (archive_id, question_id, responded_by_user_id, kind, visibility)
           VALUES ($1,$2,$3,'decline','private')`,
          [archiveId, row.id, storyteller],
        );
      }
    }
  });

  /**
   * Two suggestions from the contributor, waiting.
   *
   * One ordinary and one awkward: a correction, and a relative who remembers
   * it differently. The second is the case the review screen exists for, and a
   * demo that only shows the easy one teaches the wrong thing about what this
   * product does with disagreement.
   */
  await ctx.db.withArchiveScope(archiveId, async (tx) => {
    const target = await tx.maybeOne<{ id: string }>(
      `SELECT id FROM memory WHERE archive_id = $1 AND status = 'candidate' LIMIT 1`,
      [archiveId],
    );
    const proposals = [
      {
        kind: 'note',
        title: 'The neighbours on the left',
        body: 'The Kulkarnis lived next door and their son taught me to ride a bicycle in 1971.',
        firstHand: true,
        target: null as string | null,
      },
      {
        kind: 'alternate_account',
        title: 'I remember the move being later',
        body: 'My uncle always said the family moved after the monsoon, not before it.',
        firstHand: false,
        target: target?.id ?? null,
      },
    ];

    for (const proposal of proposals) {
      if (proposal.kind === 'alternate_account' && !proposal.target) continue;
      const row = await tx.one<{ id: string }>(
        `INSERT INTO contributor_proposal
           (archive_id, proposed_by_user_id, kind, target_type, target_id, title, body,
            contradicts_memory_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          archiveId,
          contributor,
          proposal.kind,
          proposal.target ? 'memory' : null,
          proposal.target,
          proposal.title,
          proposal.body,
          proposal.target ? [proposal.target] : [],
        ],
      );
      await tx.query(
        `INSERT INTO proposal_evidence (archive_id, proposal_id, first_hand, note)
         VALUES ($1,$2,$3,$4)`,
        [
          archiveId,
          row.id,
          proposal.firstHand,
          proposal.firstHand ? 'I was there.' : 'What my uncle told me.',
        ],
      );
    }
  });

  /**
   * The storyteller approves everything except the last interview, so demo mode
   * opens on a real review queue rather than a finished archive with nothing
   * left to do. Chosen by which recording the material came from, not by
   * position: jobs drain in batches, so ordering is not something to rely on.
   */
  const UNAPPROVED_SOURCE = 'session-04-family.webm';
  const approved = await ctx.db.withArchiveScope(archiveId, async (tx) => {
    const rows = await tx.query<{ id: string }>(
      `UPDATE memory SET status = 'approved', approved_at = now(), approved_by_user_id = $2
       WHERE archive_id = $1 AND status = 'candidate'
         AND id NOT IN (
           SELECT c.memory_id FROM claim c
           JOIN claim_evidence e ON e.claim_id = c.id
           JOIN source_asset s ON s.id = e.source_asset_id
           WHERE s.original_filename = $3 AND c.memory_id IS NOT NULL
         )
       RETURNING id`,
      [archiveId, storyteller, UNAPPROVED_SOURCE],
    );
    for (const memory of rows) {
      await tx.query(`UPDATE claim SET status = 'approved' WHERE memory_id = $1`, [memory.id]);
      await enqueueJob(tx, {
        archiveId,
        type: 'embed_memory',
        payload: { memoryId: memory.id },
        idempotencyKey: `embed:${memory.id}:seed`,
      });
    }
    await enqueueJob(tx, { archiveId, type: 'build_timeline', payload: {} });
    await enqueueJob(tx, { archiveId, type: 'compose_biography', payload: {} });
    return rows.length;
  });

  await drainQueue(ctx, { workerId: 'seed' });

  const counts = await ctx.db.withArchiveScope(archiveId, async (tx) =>
    tx.one<{ sources: number; memories: number }>(
      `SELECT (SELECT count(*) FROM source_asset WHERE archive_id = $1)::int AS sources,
              (SELECT count(*) FROM memory WHERE archive_id = $1)::int AS memories`,
      [archiveId],
    ),
  );

  // One open incident so the restricted admin view has something real in it.
  await ctx.db.query(
    `INSERT INTO incident (kind, severity, summary, archive_id)
     VALUES ('accuracy', 'low', 'Two recordings disagree about a date; awaiting storyteller review', $1)`,
    [archiveId],
  );

  return {
    archiveId,
    users: [
      { role: 'storyteller', email: 'kamala@everecho.example', password: DEMO_PASSWORD },
      { role: 'buyer', email: 'anil@everecho.example', password: DEMO_PASSWORD },
      { role: 'family', email: 'anjali@everecho.example', password: DEMO_PASSWORD },
      { role: 'contributor', email: 'ravi@everecho.example', password: DEMO_PASSWORD },
      { role: 'support admin', email: 'support@everecho.example', password: DEMO_PASSWORD },
    ],
    counts: { sources: counts.sources, memories: counts.memories, approved },
  };
}

function demoConsentDocument(): ConsentPolicyDocument {
  return {
    ...defaultConsentDocument(),
    mode: 'compose',
    activities: [
      'storage',
      'export',
      'transcription',
      'ocr',
      'embedding',
      'generation',
      'provider_processing',
      'contribution',
    ],
    recipients: [
      {
        role: 'family',
        maxSensitivity: 'normal',
        lifeStates: ['living'],
        mayExport: false,
        mayContribute: false,
      },
      {
        role: 'contributor',
        maxSensitivity: 'normal',
        lifeStates: ['living'],
        mayExport: false,
        mayContribute: true,
      },
    ],
    // A real restricted topic, so the demo can show an honest refusal.
    restrictedTopics: ['money'],
    providerProcessing: {
      transcription: true,
      ocr: true,
      embedding: true,
      generation: true,
      retentionDays: 0,
      noModelTraining: true,
    },
    note: 'Happy for the family to read these. Nothing about money, please.',
  };
}

/** Mirrors the API's scrypt format so seeded accounts can actually sign in. */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$1$${salt.toString('base64')}$${scryptSync(password, salt, 64).toString('base64')}`;
}

async function upsertUser(
  ctx: PipelineContext,
  email: string,
  displayName: string,
  options: { admin?: boolean } = {},
): Promise<string> {
  const row = await ctx.db.one<{ id: string }>(
    `INSERT INTO app_user (id, email, display_name, password_hash, is_platform_admin,
                           accepted_legal_copy_version)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [
      randomUUID(),
      email,
      displayName,
      hashPassword(DEMO_PASSWORD),
      options.admin ?? false,
      ctx.cfg.env.LEGAL_COPY_VERSION,
    ],
  );
  return row.id;
}

export { DEMO_PASSWORD };
