import type {
  EvidenceClass,
  InteractionPreference,
  LearningPolicy,
  Locator,
  MemoryCandidate,
  RealtimeSession,
  RealtimeTurn,
} from '@everecho/contracts';
import type {
  CandidateEvidenceRow,
  InteractionPreferenceRow,
  LearningPolicyRow,
  MemoryCandidateRow,
  RealtimeSessionRow,
  RealtimeTurnRow,
} from '@everecho/db';
import { toLearningPolicy } from '@everecho/db';
import { ASSISTANT_IDENTITY } from './orchestrator';

export interface RealtimeCitation {
  claimId: string;
  memoryId: string;
  sourceId: string;
  sourceFilename: string;
  sourceKind: string;
  /**
   * Typed as the contract's locator rather than loose JSON, so a citation that
   * cannot actually point at anything fails to compile rather than reaching a
   * reader as an unopenable link.
   */
  locator: Locator;
  quotedText: string;
}

export interface RealtimeClaimView {
  index: number;
  text: string;
  evidenceClass: EvidenceClass;
  confidence: number;
  verified: boolean;
  spoken: boolean;
  citations: RealtimeCitation[];
  contradictionIds: string[];
}

export function toSessionView(row: RealtimeSessionRow): RealtimeSession {
  const caps = row.capabilities ?? {};
  return {
    id: row.id,
    archiveId: row.archive_id,
    mode: row.mode,
    state: row.state,
    language: row.language as RealtimeSession['language'],
    textOnly: row.text_only,
    sequence: row.sequence,
    consentPolicyVersion: row.consent_policy_version,
    learningPolicyVersion: row.learning_policy_version,
    capabilities: {
      mayStoreTranscript: caps.mayStoreTranscript === true,
      mayStoreAudio: caps.mayStoreAudio === true,
      mayExtractCandidates: caps.mayExtractCandidates === true,
      mayUseProviderSpeechToText: caps.mayUseProviderSpeechToText === true,
      mayUseProviderSpeechSynthesis: caps.mayUseProviderSpeechSynthesis === true,
      mayUseProviderComposition: caps.mayUseProviderComposition === true,
      mayAutoSavePreferences: caps.mayAutoSavePreferences === true,
    },
    // Constant, so a person can always tell what they are talking to.
    assistantIdentity: ASSISTANT_IDENTITY,
    ttsVoiceId: row.tts_voice_id ?? 'local-neutral-synthetic-v1',
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    endedReason: row.ended_reason,
  };
}

export function toTurnView(row: RealtimeTurnRow): RealtimeTurn {
  return {
    id: row.id,
    sessionId: row.session_id,
    index: row.idx,
    speaker: row.speaker,
    text: row.text,
    isFinal: row.is_final,
    cancelled: row.cancelled,
    language: row.language,
    claims: (row.claims as RealtimeClaimView[]) ?? [],
    abstained: row.abstained,
    abstentionReason: row.abstention_reason,
    retrievalSnapshotId: row.retrieval_snapshot_id,
    modelName: row.model_name,
    modelVersion: row.model_version,
    promptVersion: row.prompt_version,
    ttsProvider: row.tts_provider,
    ttsVoiceId: row.tts_voice_id,
    audioDurationMs: row.audio_duration_ms,
    latency: row.latency
      ? {
          transcriptMs: row.latency.transcriptMs ?? null,
          retrievalMs: row.latency.retrievalMs ?? null,
          firstTokenMs: row.latency.firstTokenMs ?? null,
          firstAudioMs: row.latency.firstAudioMs ?? null,
          totalMs: row.latency.totalMs ?? null,
        }
      : null,
    createdAt: row.created_at.toISOString(),
  };
}

export function toCandidateView(
  row: MemoryCandidateRow,
  evidence: readonly CandidateEvidenceRow[],
): MemoryCandidate {
  return {
    id: row.id,
    archiveId: row.archive_id,
    sessionId: row.session_id,
    kind: row.kind as MemoryCandidate['kind'],
    status: row.status as MemoryCandidate['status'],
    title: row.title,
    body: row.body,
    occurredOn:
      row.occurred_on_value && row.occurred_on_precision
        ? {
            value: row.occurred_on_value,
            precision: row.occurred_on_precision as 'day' | 'month' | 'year' | 'decade' | 'unknown',
          }
        : null,
    topics: row.topics,
    entityNames: row.entity_names,
    placeName: row.place_name,
    dataCategories: row.data_categories as MemoryCandidate['dataCategories'],
    sensitivity: row.sensitivity as MemoryCandidate['sensitivity'],
    evidenceClass: row.evidence_class as EvidenceClass,
    confidence: row.confidence,
    duplicateOfMemoryId: row.duplicate_of_memory_id,
    duplicateOfCandidateId: row.duplicate_of_candidate_id,
    contradictsMemoryIds: row.contradicts_memory_ids,
    extractorName: row.extractor_name,
    extractorVersion: row.extractor_version,
    promptVersion: row.prompt_version,
    requiresStorytellerReview: row.requires_storyteller_review,
    evidence: evidence
      .filter((e) => e.candidate_id === row.id)
      .map((e) => ({
        id: e.id,
        turnId: e.turn_id,
        sourceAssetId: e.source_asset_id,
        transcriptSegmentId: e.transcript_segment_id,
        locator: e.locator as never,
        quotedText: e.quoted_text,
        firstHand: e.first_hand,
        speakerLabel: e.speaker_label,
      })),
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewNote: row.review_note,
    approvedMemoryId: row.approved_memory_id,
    createdAt: row.created_at.toISOString(),
  };
}

export function toLearningPolicyView(row: LearningPolicyRow): LearningPolicy {
  return toLearningPolicy(row);
}

export function toPreferenceView(row: InteractionPreferenceRow): InteractionPreference {
  return {
    id: row.id,
    key: row.key as InteractionPreference['key'],
    value: row.value,
    origin: row.origin as 'explicit' | 'auto_saved',
    learningPolicyVersion: row.learning_policy_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
