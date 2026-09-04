import { z } from 'zod';

/**
 * The complete vocabulary of things anyone can attempt. `authorize()` switches
 * exhaustively over this union, so adding a capability without deciding who may
 * use it is a compile error rather than an accidental grant.
 */
export const actionSchema = z.enum([
  // Archive lifecycle
  'archive.create',
  'archive.read',
  'archive.update',
  'archive.freeze',
  'archive.delete',

  // Membership and invitations
  'invitation.create',
  'invitation.read',
  'invitation.revoke',
  'invitation.respond',
  'membership.read',
  'membership.revoke',
  'membership.update',

  // Consent
  'consent.read',
  'consent.grant',
  'consent.update',
  'consent.revoke',
  'consent.teachback.submit',
  'consent.history.read',
  'succession.read',
  'succession.update',
  'remembrance.read',
  'remembrance.update',
  'remembrance.affirm',

  // Capture
  'interview.start',
  'interview.answer',
  'interview.read',
  'interview.summary.approve',

  // Sources
  'source.upload',
  'source.read',
  'source.download',
  'source.update_privacy',
  'source.delete',
  'transcript.read',
  'transcript.correct',

  // Processing (worker-side capabilities, checked again at execution time)
  'processing.transcribe',
  'processing.ocr',
  'processing.embed',
  'processing.extract_candidates',

  // Memory product
  'memory.read',
  'memory.create',
  'memory.update',
  'memory.review',
  'memory.delete',
  'entity.read',
  'entity.update',
  'relationship.read',
  'relationship.update',
  'event.read',
  'timeline.read',
  'biography.read',
  'biography.generate',
  'biography.update',
  'contradiction.read',
  'contradiction.resolve',
  'correction.propose',
  'correction.read',

  // Retrieval and generation
  'search.query',
  'question.ask',
  'response.read',
  'citation.open',

  // Lifecycle
  'export.create',
  'export.read',
  'export.download',
  'deletion.request',
  'deletion.read',
  'audit.read',

  // Billing
  'billing.read',
  'billing.manage',

  // Administration
  'admin.remembrance.activate',
  'admin.incident.read',
  'admin.incident.manage',
  'admin.archive.metadata.read',
  'admin.breakglass.request',
  'admin.worker.read',

  // Real-time conversation (v0.2). Interview and assistant start separately
  // because the two modes differ in who may begin one at all; every later
  // action in a session is shared, and consent decides what it may reach.
  'realtime.interview.start',
  'realtime.assistant.start',
  'realtime.session.read',
  'realtime.session.connect',
  'realtime.session.listen',
  'realtime.session.transcribe',
  'realtime.session.retrieve',
  'realtime.session.generate',
  'realtime.session.speak',
  'realtime.session.end',
  'realtime.turn.read',
  'realtime.turn.correct',
  'realtime.audio.store',
  'realtime.audio.delete',

  // Consent-controlled learning (v0.2)
  'learning.policy.read',
  'learning.policy.update',
  'learning.candidate.create',
  'learning.candidate.read',
  'learning.candidate.edit',
  'learning.candidate.approve',
  'learning.candidate.reject',
  'learning.preference.read',
  'learning.preference.write',
  'learning.preference.delete',

  // The family growth loop (v0.3)
  'familyQuestion.create',
  'familyQuestion.read',
  'familyQuestion.respond',
  'familyQuestion.decline',
  'familyQuestion.restrict',
  'familyQuestion.withdraw',
  'contribution.create',
  'contribution.read',
  'contribution.edit',
  'contribution.approve',
  'contribution.reject',
  'contribution.withdraw',
  'capsule.create',
  'capsule.read',
  'capsule.update',
  'capsule.revoke',
  'capsule.open',
  'capsule.download',
  'memoryGap.read',
  'memoryGap.answer',
  'memoryGap.dismiss',
  'storyMission.read',
  'storyMission.complete',
  'storyMission.dismiss',

  // Prohibited in v0.1 — present so refusal is explicit and testable
  'perform.synthesise_voice',
  'perform.synthesise_likeness',
  'perform.persona_chat',
]);
export type Action = z.infer<typeof actionSchema>;

export const PROHIBITED_ACTIONS = [
  'perform.synthesise_voice',
  'perform.synthesise_likeness',
  'perform.persona_chat',
] as const satisfies readonly Action[];

export const resourceTypeSchema = z.enum([
  'archive',
  'invitation',
  'membership',
  'consent_policy',
  'succession_directive',
  'remembrance_directive',
  'interview_session',
  'source_asset',
  'transcript',
  'memory',
  'entity',
  'relationship',
  'event',
  'timeline',
  'biography',
  'contradiction',
  'correction',
  'search',
  'question',
  'generated_response',
  'export_job',
  'deletion_request',
  'audit_event',
  'billing',
  'incident',
  'worker',
  'realtime_session',
  'realtime_turn',
  'realtime_audio',
  'learning_policy',
  'memory_candidate',
  'interaction_preference',
  'family_question',
  'contributor_proposal',
  'story_capsule',
  'memory_gap',
]);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

/**
 * Deny reasons are a closed set so the frontend can explain a refusal precisely
 * ("your access ended on 3 March") instead of a generic "forbidden".
 */
export const denyReasonSchema = z.enum([
  'not_a_member',
  'membership_revoked',
  'membership_expired',
  'membership_pending',
  'role_not_permitted',
  'consent_missing',
  'consent_mode_insufficient',
  'activity_not_consented',
  'data_category_not_consented',
  'recipient_not_permitted',
  'sensitivity_above_grant',
  'restricted_topic',
  'source_excluded',
  'source_embargoed',
  'access_window_not_started',
  'access_window_ended',
  'life_state_not_permitted',
  'export_not_permitted',
  'contribution_not_permitted',
  'provider_processing_not_consented',
  'archive_frozen',
  'archive_deleted',
  'dispute_hold_active',
  'buyer_cannot_consent_for_storyteller',
  'storyteller_only',
  'capability_prohibited_in_v0_1',
  'admin_scope_metadata_only',
  'breakglass_required',
  'breakglass_expired',
  'not_authenticated',
  // v0.2 — realtime and learning
  'learning_policy_missing',
  'session_context_not_permitted',
  'transcript_retention_not_permitted',
  'audio_retention_not_permitted',
  'candidate_extraction_not_permitted',
  'candidate_category_not_permitted',
  'correction_learning_not_permitted',
  'preference_not_low_risk',
  'preference_auto_save_not_permitted',
  'provider_speech_not_consented',
  'learning_policy_expired',
  'realtime_session_not_live',
  'cross_archive_learning_denied',
  // v0.3 — the family growth loop
  'question_not_yours',
  'question_already_decided',
  'answer_not_for_you',
  'proposal_not_yours',
  'proposal_already_decided',
  'proposal_target_missing',
  'capsule_not_yours',
  'capsule_revoked',
  'capsule_embargoed',
  'capsule_expired',
  'capsule_download_not_permitted',
]);
export type DenyReason = z.infer<typeof denyReasonSchema>;
