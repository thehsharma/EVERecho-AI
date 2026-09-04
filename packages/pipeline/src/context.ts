import type { AppConfig } from '@everecho/config';
import type { Database, Transaction } from '@everecho/db';
import type { EmailAdapter, ScanAdapter, StorageAdapter, CacheAdapter } from '@everecho/adapters';
import type { EmbeddingAdapter, LlmAdapter, OcrAdapter, SpeechToTextAdapter } from '@everecho/ai';
import { authorize, type Actor, type ResourceRef } from '@everecho/consent';
import type { Action } from '@everecho/contracts';
import {
  findArchive,
  findCurrentLearningPolicy,
  findCurrentPolicy,
  hasActiveDisputeHold,
  toConsentPolicy,
  toLearningPolicy,
} from '@everecho/db';

/**
 * What background work needs. Structurally satisfied by the API's AppContext,
 * so the same handlers run in the worker and in integration tests.
 */
export interface PipelineContext {
  cfg: AppConfig;
  db: Database;
  storage: StorageAdapter;
  scanner: ScanAdapter;
  email: EmailAdapter;
  cache: CacheAdapter;
  llm: LlmAdapter;
  embeddings: EmbeddingAdapter;
  stt: SpeechToTextAdapter;
  ocr: OcrAdapter;
  branding: { policyEngineVersion: string; productName: string; supportEmail: string };
}

export class ConsentRevokedError extends Error {
  constructor(readonly reasonCode: string) {
    super(`Processing stopped: ${reasonCode}`);
    this.name = 'ConsentRevokedError';
  }
}

/**
 * Re-checks consent at execution time.
 *
 * A job authorised when it was enqueued may run after the storyteller has
 * narrowed or withdrawn their consent. Trusting the permission captured at
 * enqueue time is how a system ends up transcribing a recording somebody
 * already asked it not to touch.
 *
 * The check is performed as the storyteller themselves, because the question
 * being asked is "does this archive's current policy permit this processing",
 * not "may some user do this".
 */
export async function assertProcessingAllowed(
  ctx: PipelineContext,
  tx: Transaction,
  input: {
    archiveId: string;
    action: Action;
    resource?: Partial<ResourceRef>;
    /** True when this job will send material to an external provider. */
    usesProvider?: boolean;
  },
): Promise<void> {
  const archive = await findArchive(tx, input.archiveId);
  if (!archive) throw new ConsentRevokedError('archive_deleted');
  if (archive.status === 'deleted' || archive.status === 'deleting') {
    throw new ConsentRevokedError('archive_deleted');
  }

  const policyRow = await findCurrentPolicy(tx, input.archiveId);
  const learningRow = await findCurrentLearningPolicy(tx, input.archiveId);
  const actor: Actor = {
    userId: archive.storyteller_user_id ?? '00000000-0000-4000-8000-000000000000',
    isPlatformAdmin: false,
    membership: { role: 'storyteller', status: 'active', grantedAt: null, expiresAt: null },
  };

  const decision = authorize({
    actor,
    action: input.action,
    resource: { type: 'source_asset', archiveId: input.archiveId, ...input.resource },
    subject: {
      archiveId: archive.id,
      archiveStatus: archive.status,
      storytellerUserId: actor.userId,
      lifeState: archive.life_state,
      policy: policyRow ? toConsentPolicy(policyRow) : null,
      learningPolicy: learningRow ? toLearningPolicy(learningRow) : null,
      disputeHoldActive: await hasActiveDisputeHold(tx, input.archiveId),
    },
    context: {
      now: new Date(),
      policyEngineVersion: ctx.branding.policyEngineVersion,
      usesProvider: input.usesProvider ?? false,
    },
  });

  if (decision.effect === 'DENY') throw new ConsentRevokedError(decision.reasonCode);
}
