import {
  PROHIBITED_ACTIONS,
  type Action,
  type DenyReason,
  type Sensitivity,
} from '@everecho/contracts';
import { ACTION_REQUIREMENTS, MODE_RANK, ROLE_ACTIONS, SENSITIVITY_RANK } from './matrix';
import { deniedLearningObligations, resolveLearningObligations } from './learning';
import type {
  AuthorizeInput,
  Decision,
  LearningGate,
  LearningObligations,
  Obligations,
} from './types';

const EXPLANATIONS: Record<DenyReason, string> = {
  not_a_member: 'You do not have access to this archive.',
  membership_revoked: 'Your access to this archive was withdrawn.',
  membership_expired: 'Your access to this archive has ended.',
  membership_pending: 'Your invitation has not been accepted yet.',
  role_not_permitted: 'Your role in this archive does not include this action.',
  consent_missing: 'The storyteller has not set up consent for this archive yet.',
  consent_mode_insufficient: 'The storyteller has not enabled this capability for this archive.',
  activity_not_consented: 'The storyteller has not permitted this kind of processing.',
  data_category_not_consented: 'The storyteller has not permitted this category of material.',
  recipient_not_permitted: 'The storyteller has not shared this material with you.',
  sensitivity_above_grant: 'This material is more private than what you have been given access to.',
  restricted_topic: 'The storyteller has restricted this topic.',
  source_excluded: 'The storyteller excluded this source from processing and sharing.',
  source_embargoed: 'The storyteller has held this material back until a later date.',
  access_window_not_started: 'Your access to this archive has not started yet.',
  access_window_ended: 'Your access to this archive has ended.',
  life_state_not_permitted: 'This access was granted for a different circumstance.',
  export_not_permitted: 'You have not been given permission to export from this archive.',
  contribution_not_permitted: 'You have not been given permission to contribute to this archive.',
  provider_processing_not_consented:
    'The storyteller has not permitted an external provider to process this material.',
  archive_frozen: 'This archive is frozen and cannot be changed right now.',
  archive_deleted: 'This archive has been deleted.',
  dispute_hold_active: 'Sharing from this archive is paused while a family dispute is reviewed.',
  buyer_cannot_consent_for_storyteller:
    'Only the storyteller can make consent decisions about their own memories.',
  storyteller_only: 'Only the storyteller can do this.',
  capability_prohibited_in_v0_1:
    'This capability is prohibited: EverEcho does not synthesise a person’s voice, likeness or persona.',
  admin_scope_metadata_only: 'Support access is limited to operational metadata.',
  breakglass_required: 'Support access to this archive requires an approved, time-limited grant.',
  breakglass_expired: 'This support access grant has expired.',
  not_authenticated: 'Please sign in.',
  learning_policy_missing:
    'The storyteller has not yet decided what a conversation may be used for.',
  session_context_not_permitted:
    'The storyteller has not permitted conversations to be held in this archive.',
  transcript_retention_not_permitted:
    'The storyteller has not permitted conversation transcripts to be kept.',
  audio_retention_not_permitted: 'The storyteller has not permitted recordings to be stored.',
  candidate_extraction_not_permitted:
    'The storyteller has not permitted conversations to produce suggested memories.',
  candidate_category_not_permitted:
    'The storyteller has not permitted this category of material to be suggested.',
  correction_learning_not_permitted:
    'The storyteller has not permitted corrections to update the archive.',
  preference_not_low_risk:
    'Only interface preferences can be remembered this way. Anything about the storyteller’s ' +
    'life needs their review.',
  preference_auto_save_not_permitted:
    'The storyteller has asked to be consulted before anything is remembered.',
  provider_speech_not_consented:
    'The storyteller has not permitted an external provider to hear or speak this material.',
  learning_policy_expired: 'The storyteller’s learning policy has expired and needs renewing.',
  realtime_session_not_live: 'This conversation has already ended.',
  cross_archive_learning_denied: 'Learning never crosses between archives.',
  question_not_yours: 'You can only see questions you asked.',
  question_already_decided: 'This question has already been answered or closed.',
  // Deliberately says nothing about who *can* see it, or that a narrower
  // answer exists: "not for you" is the whole message.
  answer_not_for_you: 'This answer was shared with someone else.',
};

/** Which refusal a failed learning gate produces. Exhaustive by construction. */
const LEARNING_DENIALS: Record<LearningGate, DenyReason> = {
  sessionContext: 'session_context_not_permitted',
  transcriptRetention: 'transcript_retention_not_permitted',
  audioRetention: 'audio_retention_not_permitted',
  candidateExtraction: 'candidate_extraction_not_permitted',
  correctionLearning: 'correction_learning_not_permitted',
  speechToText: 'provider_speech_not_consented',
  speechSynthesis: 'provider_speech_not_consented',
  composition: 'provider_speech_not_consented',
};

/**
 * Whether the resolved learning obligations satisfy a gate.
 *
 * `speechToText`, `speechSynthesis` and `composition` gate only *provider* use.
 * A session running entirely on local adapters never consults them, because no
 * third party hears anything — which is why the local demonstration path works
 * under the default policy.
 */
function learningGateSatisfied(
  gate: LearningGate,
  learning: LearningObligations,
  usesProvider: boolean,
): boolean {
  switch (gate) {
    case 'sessionContext':
      return true;
    case 'transcriptRetention':
      return learning.mayStoreTranscript;
    case 'audioRetention':
      return learning.mayStoreAudio;
    case 'candidateExtraction':
      return learning.mayExtractCandidates;
    case 'correctionLearning':
      return learning.mayLearnFromCorrections;
    case 'speechToText':
      return !usesProvider || learning.mayUseProviderSpeechToText;
    case 'speechSynthesis':
      return !usesProvider || learning.mayUseProviderSpeechSynthesis;
    case 'composition':
      return !usesProvider || learning.mayUseProviderComposition;
  }
}

function deny(reasonCode: DenyReason, policyVersion: string): Decision {
  return { effect: 'DENY', reasonCode, policyVersion, explanation: EXPLANATIONS[reasonCode] };
}

/** Actions that remain readable after deletion begins, so a user can watch it finish. */
const READABLE_WHILE_DELETING: readonly Action[] = [
  'deletion.read',
  'audit.read',
  'archive.read',
  'export.read',
];

function isProhibited(action: Action): boolean {
  return (PROHIBITED_ACTIONS as readonly string[]).includes(action);
}

function withinWindow(
  now: Date,
  from?: string | null,
  to?: string | null,
): 'ok' | 'early' | 'late' {
  if (from && now.getTime() < Date.parse(from)) return 'early';
  if (to && now.getTime() > Date.parse(to)) return 'late';
  return 'ok';
}

function topicIsRestricted(topic: string, restricted: readonly string[]): boolean {
  const t = topic.toLowerCase().trim();
  return restricted.some((r) => {
    const needle = r.toLowerCase().trim();
    return needle.length > 0 && (t === needle || t.includes(needle) || needle.includes(t));
  });
}

/**
 * The single decision point for the entire product.
 *
 * Pure: no I/O, no clock, no database. Everything it needs arrives as an
 * argument, which is why the whole permission matrix can be exercised in unit
 * tests and why a caller cannot accidentally authorise against stale state.
 *
 * Called *before* database reads, source retrieval, search, signed-link
 * generation, prompts, generation, exports, background processing and admin
 * actions. Hiding a control in the frontend is not authorisation.
 */
export function authorize(input: AuthorizeInput): Decision {
  const { actor, action, resource, subject, context } = input;
  const policyVersion = subject.policy
    ? `${context.policyEngineVersion}/archive-policy-v${subject.policy.version}`
    : `${context.policyEngineVersion}/no-policy`;

  // 1. Prohibited capabilities are refused for everyone, including the
  //    storyteller. Consent cannot authorise what the product will not build.
  if (isProhibited(action)) return deny('capability_prohibited_in_v0_1', policyVersion);

  if (!actor.userId) return deny('not_authenticated', policyVersion);

  const requirement = ACTION_REQUIREMENTS[action];
  const isStoryteller =
    subject.storytellerUserId !== null && actor.userId === subject.storytellerUserId;

  // Resolved once. Consent is the ceiling: a learning policy that permits
  // provider transcription cannot enable it if consent forbids provider
  // processing, which is why the consent document is an input here.
  const consentDoc = subject.policy?.document ?? null;
  const learningExpired =
    subject.learningPolicy?.document.expiresAt != null &&
    context.now.getTime() > Date.parse(subject.learningPolicy.document.expiresAt);
  const learning = resolveLearningObligations({
    document: subject.learningPolicy?.document ?? null,
    expired: learningExpired,
    consentAllowsProviderTranscription: consentDoc?.providerProcessing.transcription ?? false,
    consentAllowsProviderGeneration: consentDoc?.providerProcessing.generation ?? false,
    consentAllowsEmbedding: consentDoc?.activities.includes('embedding') ?? false,
    consentDataCategories: consentDoc?.dataCategories ?? [],
  });

  // 2. Platform administration is a separate world from archive membership.
  if (action.startsWith('admin.')) {
    if (!actor.isPlatformAdmin) return deny('role_not_permitted', policyVersion);
    if (action === 'admin.archive.metadata.read') {
      const grant = actor.breakGlass;
      if (!grant || grant.archiveId !== subject.archiveId) {
        return deny('breakglass_required', policyVersion);
      }
      if (context.now.getTime() > Date.parse(grant.expiresAt)) {
        return deny('breakglass_expired', policyVersion);
      }
    }
    return allow(policyVersion, obligationsForAdmin());
  }
  // An administrator has no standing path to memory content.
  if (actor.isPlatformAdmin && !actor.membership && requirement.readsContent) {
    return deny('admin_scope_metadata_only', policyVersion);
  }

  // 3. Archive lifecycle gates.
  if (subject.archiveStatus === 'deleted') {
    if (!READABLE_WHILE_DELETING.includes(action)) return deny('archive_deleted', policyVersion);
  }
  if (
    subject.archiveStatus === 'deleting' &&
    requirement.mutates &&
    action !== 'deletion.request'
  ) {
    return deny('archive_deleted', policyVersion);
  }
  if (
    (subject.archiveStatus === 'frozen' || subject.archiveStatus === 'export_only') &&
    requirement.mutates &&
    !['deletion.request', 'export.create', 'consent.revoke', 'membership.revoke'].includes(action)
  ) {
    return deny('archive_frozen', policyVersion);
  }

  // 4. Membership must exist and be live right now.
  const membership = actor.membership;
  if (!membership) return deny('not_a_member', policyVersion);
  switch (membership.status) {
    case 'revoked':
      return deny('membership_revoked', policyVersion);
    case 'expired':
      return deny('membership_expired', policyVersion);
    case 'pending':
      if (action !== 'invitation.respond') return deny('membership_pending', policyVersion);
      break;
    case 'active':
      break;
  }
  const membershipWindow = withinWindow(context.now, membership.grantedAt, membership.expiresAt);
  if (membershipWindow === 'early') return deny('access_window_not_started', policyVersion);
  if (membershipWindow === 'late') return deny('membership_expired', policyVersion);

  // 5. A buyer attempting to consent is refused *before* the generic role
  //    table, because "your role does not permit this" is not the thing they
  //    need to hear. They need to hear that this decision is not theirs to make.
  if (
    requirement.storytellerOnly &&
    !isStoryteller &&
    membership.role === 'buyer' &&
    action.startsWith('consent.')
  ) {
    return deny('buyer_cannot_consent_for_storyteller', policyVersion);
  }

  // 6. Role must include the action at all.
  if (!ROLE_ACTIONS[membership.role].includes(action)) {
    return deny('role_not_permitted', policyVersion);
  }

  // 7. Storyteller-only actions.
  if (requirement.storytellerOnly && !isStoryteller) {
    return deny('storyteller_only', policyVersion);
  }

  // 8. A dispute freezes distribution without touching the storyteller's sources.
  if (
    subject.disputeHoldActive &&
    !isStoryteller &&
    (requirement.readsContent || action === 'export.create' || action === 'export.download')
  ) {
    return deny('dispute_hold_active', policyVersion);
  }

  // 9. Consent.
  if (requirement.minMode !== null) {
    const policy = subject.policy;
    if (!policy) return deny('consent_missing', policyVersion);
    const doc = policy.document;

    if (MODE_RANK[doc.mode] < MODE_RANK[requirement.minMode]) {
      return deny('consent_mode_insufficient', policyVersion);
    }

    if (requirement.activity && !doc.activities.includes(requirement.activity)) {
      return deny('activity_not_consented', policyVersion);
    }

    // Provider processing is consented separately from the activity itself:
    // "you may transcribe this" and "a third party may see it" are two questions.
    const providerGate: Partial<Record<Action, boolean>> = {
      'processing.transcribe': doc.providerProcessing.transcription,
      'processing.ocr': doc.providerProcessing.ocr,
      'processing.embed': doc.providerProcessing.embedding,
      'biography.generate': doc.providerProcessing.generation,
      'question.ask': doc.providerProcessing.generation,
    };
    if (providerGate[action] === false) {
      return deny('provider_processing_not_consented', policyVersion);
    }

    for (const category of resource.dataCategories ?? []) {
      if (!doc.dataCategories.includes(category)) {
        return deny('data_category_not_consented', policyVersion);
      }
    }

    // Excluded sources are never processed, not even at the storyteller's own
    // request: the exclusion is the instruction.
    if (resource.sourceId && doc.excludedSourceIds.includes(resource.sourceId)) {
      if (action.startsWith('processing.') || !isStoryteller) {
        return deny('source_excluded', policyVersion);
      }
    }

    if (!isStoryteller) {
      if (resource.embargoUntil && context.now.getTime() < Date.parse(resource.embargoUntil)) {
        return deny('source_embargoed', policyVersion);
      }
      for (const topic of resource.topics ?? []) {
        if (topicIsRestricted(topic, doc.restrictedTopics)) {
          return deny('restricted_topic', policyVersion);
        }
      }
    }

    // The learning gate. Deliberately after the consent checks above: if the
    // storyteller has not consented to transcription at all, "you have not
    // permitted transcripts to be kept" is the wrong thing to tell them.
    if (requirement.learning !== null) {
      if (!subject.learningPolicy) return deny('learning_policy_missing', policyVersion);
      if (learningExpired) return deny('learning_policy_expired', policyVersion);
      if (!learningGateSatisfied(requirement.learning, learning, context.usesProvider === true)) {
        return deny(LEARNING_DENIALS[requirement.learning], policyVersion);
      }
    }

    // Export and contribution consult the recipient grant even though they do
    // not themselves read content: `mayExport` and `mayContribute` live there.
    const needsRecipientGrant =
      requirement.readsContent ||
      action === 'export.create' ||
      action === 'export.download' ||
      action === 'correction.propose';

    if (needsRecipientGrant && !isStoryteller) {
      // Most specific grant wins: one addressed to this user, else one for the role.
      const grant =
        doc.recipients.find((r) => r.userId === actor.userId) ??
        doc.recipients.find((r) => r.userId === undefined && r.role === membership.role);
      if (!grant) return deny('recipient_not_permitted', policyVersion);

      if (!grant.lifeStates.includes(subject.lifeState)) {
        return deny('life_state_not_permitted', policyVersion);
      }
      const grantWindow = withinWindow(context.now, grant.accessStartsAt, grant.accessEndsAt);
      if (grantWindow === 'early') return deny('access_window_not_started', policyVersion);
      if (grantWindow === 'late') return deny('access_window_ended', policyVersion);

      const resourceSensitivity: Sensitivity = resource.sensitivity ?? 'normal';
      if (SENSITIVITY_RANK[resourceSensitivity] > SENSITIVITY_RANK[grant.maxSensitivity]) {
        return deny('sensitivity_above_grant', policyVersion);
      }
      if ((action === 'export.download' || action === 'export.create') && !grant.mayExport) {
        return deny('export_not_permitted', policyVersion);
      }
      if (action === 'correction.propose' && !grant.mayContribute) {
        return deny('contribution_not_permitted', policyVersion);
      }

      return allow(policyVersion, {
        maxSensitivity: grant.maxSensitivity,
        excludedSourceIds: doc.excludedSourceIds,
        restrictedTopics: doc.restrictedTopics,
        mustAudit: true,
        mustLogAccess: action === 'source.download' || action === 'export.download',
        learning,
      });
    }

    return allow(policyVersion, {
      // The storyteller reaches everything in their own archive.
      maxSensitivity: isStoryteller ? 'embargoed' : 'normal',
      excludedSourceIds: doc.excludedSourceIds,
      restrictedTopics: isStoryteller ? [] : doc.restrictedTopics,
      mustAudit: true,
      mustLogAccess: action === 'source.download' || action === 'export.download',
      learning,
    });
  }

  // Actions with no consent-mode requirement can still be learning-gated:
  // `learning.preference.write` needs no mode but does need an auto-save policy.
  if (requirement.learning !== null) {
    if (!subject.learningPolicy) return deny('learning_policy_missing', policyVersion);
    if (learningExpired) return deny('learning_policy_expired', policyVersion);
    if (!learningGateSatisfied(requirement.learning, learning, context.usesProvider === true)) {
      return deny(LEARNING_DENIALS[requirement.learning], policyVersion);
    }
  }

  return allow(policyVersion, {
    maxSensitivity: isStoryteller ? 'embargoed' : 'normal',
    excludedSourceIds: subject.policy?.document.excludedSourceIds ?? [],
    restrictedTopics: isStoryteller ? [] : (subject.policy?.document.restrictedTopics ?? []),
    mustAudit: requirement.mutates,
    mustLogAccess: false,
    learning,
  });
}

function allow(policyVersion: string, obligations: Obligations): Decision {
  return {
    effect: 'ALLOW',
    reasonCode: 'allowed',
    policyVersion,
    explanation: 'Permitted by the storyteller’s current consent policy.',
    obligations,
  };
}

function obligationsForAdmin(): Obligations {
  return {
    maxSensitivity: 'normal',
    excludedSourceIds: [],
    restrictedTopics: [],
    mustAudit: true,
    mustLogAccess: true,
    // Support access never learns anything. There is no path from an
    // administrator's session to a candidate memory.
    learning: deniedLearningObligations(),
  };
}

/** Convenience for call sites that only branch on the outcome. */
export function isAllowed(decision: Decision): decision is Extract<Decision, { effect: 'ALLOW' }> {
  return decision.effect === 'ALLOW';
}
