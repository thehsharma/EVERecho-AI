import { z } from 'zod';

/**
 * The complete set of analytics events. Adding one requires adding it here,
 * which is the point: it makes "we accidentally logged a memory" impossible to
 * do quietly. Properties are counts, enums and durations — never content.
 */
export const analyticsEventNameSchema = z.enum([
  'landing_cta_clicked',
  'pilot_application_started',
  'reservation_started',
  'deposit_completed',
  'invitation_sent',
  'invitation_accepted',
  'invitation_declined',
  'consent_teachback_completed',
  'consent_updated',
  'interview_started',
  'interview_completed',
  'source_uploaded',
  'source_processed',
  'memory_approved',
  'family_member_invited',
  'question_asked',
  'cited_answer_viewed',
  'citation_opened',
  'answer_abstained',
  'export_requested',
  'deletion_requested',
  'deletion_completed',
  'access_revoked',
  'safety_incident',
  'accuracy_incident',
  'consent_incident',
  'delivery_labour_recorded',
  'provider_cost_recorded',
  // Real-time conversation. Counts and modes only — never a word of what was
  // said, never a question, never a title.
  'realtime_session_started',
  'realtime_session_ended',
  'realtime_turn_completed',
  'realtime_turn_interrupted',
  'realtime_answer_abstained',
  'realtime_candidate_proposed',
  'realtime_candidate_approved',
  'realtime_candidate_rejected',
  'learning_policy_updated',
  'preference_auto_saved',
  // v0.3 — the family growth funnel. Every one of these carries counts,
  // booleans and enums only; the schema below refuses strings.
  'family_question_asked',
  'family_question_decided',
  'family_question_answer_read',
  'family_question_candidate_approved',
  'contribution_proposed',
  'contribution_decided',
  'capsule_created',
  'capsule_opened',
  'capsule_revoked',
  'memory_gap_offered',
  'memory_gap_answered',
  'memory_gap_dismissed',
  'remembrance_directive_saved',
  'remembrance_directive_affirmed',
  'remembrance_clause_added',
  'remembrance_activated',
]);
export type AnalyticsEventName = z.infer<typeof analyticsEventNameSchema>;

/** Only these property value types may be recorded. Strings are enums, not prose. */
export const analyticsPropsSchema = z.record(
  z.string(),
  z.union([z.number(), z.boolean(), z.enum(['low', 'medium', 'high']), z.null()]),
);

export const analyticsEventSchema = z.object({
  name: analyticsEventNameSchema,
  /** Salted hashes. Never a raw user id, email, archive id or filename. */
  opaqueActorId: z.string().nullable(),
  opaqueArchiveId: z.string().nullable(),
  props: analyticsPropsSchema,
  occurredAt: z.iso.datetime(),
});
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
