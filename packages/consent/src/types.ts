import type {
  Action,
  LearningPolicy,
  ArchiveStatus,
  ConsentPolicy,
  DataCategory,
  DenyReason,
  LifeState,
  MembershipStatus,
  ProcessingActivity,
  ResourceType,
  Role,
  Sensitivity,
} from '@everecho/contracts';

/** Who is asking. Assembled from the session; never from client-supplied fields. */
export interface Actor {
  userId: string | null;
  isPlatformAdmin: boolean;
  /** Membership in the archive being reached. `null` means no relationship at all. */
  membership: {
    role: Role;
    status: MembershipStatus;
    grantedAt: string | null;
    expiresAt: string | null;
  } | null;
  /** Time-bound, purpose-limited support access. Metadata scope only. */
  breakGlass?: {
    archiveId: string;
    expiresAt: string;
    scope: 'metadata_only';
  } | null;
}

/** What is being reached. */
export interface ResourceRef {
  type: ResourceType;
  id?: string | null;
  archiveId: string;
  sensitivity?: Sensitivity;
  /** The source this resource derives from, so per-source exclusions apply. */
  sourceId?: string | null;
  dataCategories?: readonly DataCategory[];
  /** Topic labels checked against the storyteller's restricted list. */
  topics?: readonly string[];
  embargoUntil?: string | null;
}

/** The archive and the person it is about. */
export interface Subject {
  archiveId: string;
  archiveStatus: ArchiveStatus;
  storytellerUserId: string | null;
  lifeState: LifeState;
  /** Current consent policy. `null` means the storyteller has not consented yet. */
  policy: ConsentPolicy | null;
  /**
   * Current learning policy. `null` means the storyteller has not decided what
   * a conversation may become, so nothing that depends on it is permitted.
   */
  learningPolicy: LearningPolicy | null;
  disputeHoldActive: boolean;
}

export interface AuthContext {
  now: Date;
  policyEngineVersion: string;
  requestId?: string;
  /**
   * Whether this particular operation will send material to an external
   * provider. Set by the caller from the configured adapter, because whether a
   * third party hears anything is a fact about the deployment, not about the
   * resource. A session running entirely on local adapters never trips the
   * provider gates.
   */
  usesProvider?: boolean;
}

/**
 * Obligations travel with an ALLOW. Retrieval reads `maxSensitivity` to build
 * its `WHERE` clause, so the filter and the decision cannot drift apart.
 */
export interface Obligations {
  maxSensitivity: Sensitivity;
  excludedSourceIds: readonly string[];
  restrictedTopics: readonly string[];
  mustAudit: boolean;
  /** Present on ALLOW for download/export so the caller records the access. */
  mustLogAccess: boolean;
  /**
   * What the learning policy permits, resolved once so a live session does not
   * have to re-read the document at every decision point.
   */
  learning: LearningObligations;
}

export interface LearningObligations {
  mayStoreTranscript: boolean;
  mayStoreAudio: boolean;
  mayExtractCandidates: boolean;
  mayUseProviderSpeechToText: boolean;
  mayUseProviderSpeechSynthesis: boolean;
  mayUseProviderComposition: boolean;
  mayAutoSavePreferences: boolean;
  mayLearnFromCorrections: boolean;
  /** Candidate categories permitted. Anything outside is dropped, not stored. */
  allowedCandidateCategories: readonly string[];
}

export type Decision =
  | {
      effect: 'ALLOW';
      reasonCode: 'allowed';
      policyVersion: string;
      explanation: string;
      obligations: Obligations;
    }
  | {
      effect: 'DENY';
      reasonCode: DenyReason;
      policyVersion: string;
      explanation: string;
    };

export interface AuthorizeInput {
  actor: Actor;
  action: Action;
  resource: ResourceRef;
  subject: Subject;
  context: AuthContext;
}

/** Requirements an action places on consent, independent of who is asking. */
export interface ActionRequirement {
  /** Minimum consent mode. `null` = no consent policy needed (e.g. invitation.respond). */
  minMode: 'preserve' | 'organise' | 'explore' | 'compose' | null;
  activity: ProcessingActivity | null;
  /** Reads archive content, so recipient grants and sensitivity limits apply. */
  readsContent: boolean;
  /** Only the storyteller may ever do this. */
  storytellerOnly: boolean;
  /** Writes; refused while an archive is frozen. */
  mutates: boolean;
  /**
   * The learning-policy setting this action requires. `null` means the action
   * does not depend on the learning policy at all. The consent mode remains a
   * ceiling above whatever the learning policy says: a learning policy can
   * narrow what consent permits and can never widen it.
   */
  learning: LearningGate | null;
}

/** Settings in the learning policy that an action can be gated on. */
export type LearningGate =
  | 'sessionContext'
  | 'transcriptRetention'
  | 'audioRetention'
  | 'candidateExtraction'
  | 'correctionLearning'
  | 'speechToText'
  | 'speechSynthesis'
  | 'composition';
