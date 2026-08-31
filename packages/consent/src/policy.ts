import { createHash } from 'node:crypto';
import {
  consentPolicyDocumentSchema,
  type ConsentPolicyDocument,
  type ProcessingActivity,
  type Role,
} from '@everecho/contracts';

export class ConsentPolicyError extends Error {
  constructor(
    summary: string,
    readonly issues: readonly string[],
  ) {
    // The reasons belong in the message: anything that logs or displays this
    // error should show *why* it was refused, not just that it was.
    super(issues.length > 0 ? `${summary}:\n  - ${issues.join('\n  - ')}` : summary);
    this.name = 'ConsentPolicyError';
    this.summary = summary;
  }

  readonly summary: string;
}

/**
 * Activities the storyteller can never lose, whatever else the policy says.
 * Data portability is not a feature the product may take away, and an archive
 * that cannot store anything is not an archive.
 */
const INALIENABLE_ACTIVITIES: readonly ProcessingActivity[] = ['storage', 'export'];

/**
 * Canonical JSON: keys sorted at every depth, arrays sorted where order carries
 * no meaning. Two policies that mean the same thing must hash the same, or the
 * hash proves nothing.
 */
export function canonicalise(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const mapped = v.map(walk);
      const allPrimitive = mapped.every((m) => typeof m === 'string' || typeof m === 'number');
      return allPrimitive ? [...mapped].sort() : mapped;
    }
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, val]) => val !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, walk(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export function hashPolicy(document: ConsentPolicyDocument): string {
  return createHash('sha256').update(canonicalise(document), 'utf8').digest('hex');
}

/** Reads a possibly-malformed input for the shapes v0.1 refuses outright. */
function prohibitedShapeIssues(input: unknown): string[] {
  const issues: string[] = [];
  if (!input || typeof input !== 'object') return issues;
  const raw = input as Record<string, unknown>;

  if (raw.mode === 'perform') {
    issues.push(
      'consent mode "perform" is prohibited in v0.1: EverEcho does not synthesise voice, likeness or persona',
    );
  }
  const vl = raw.voiceAndLikeness;
  if (vl && typeof vl === 'object') {
    const v = vl as Record<string, unknown>;
    if (v.syntheticVoice === true || v.syntheticLikeness === true || v.personaSimulation === true) {
      issues.push('voice and likeness rights are denied by default and cannot be granted in v0.1');
    }
  }
  const pp = raw.providerProcessing;
  if (pp && typeof pp === 'object' && (pp as Record<string, unknown>).noModelTraining === false) {
    issues.push('training shared or foundation models on private memory data is prohibited');
  }
  return issues;
}

/**
 * Validates and normalises a consent document before it may be stored.
 * Refuses anything the product constitution prohibits, regardless of what the
 * caller asked for — a UI bug must not be able to record a prohibited consent.
 */
export function compileConsentPolicy(input: unknown): {
  document: ConsentPolicyDocument;
  policyHash: string;
} {
  // Checked before schema parsing so a prohibited request is refused by name.
  // The schema would also reject these, but "not valid" tells an operator
  // nothing about *why* the product will not record this consent.
  const prohibitions = prohibitedShapeIssues(input);
  if (prohibitions.length > 0) {
    throw new ConsentPolicyError('Consent policy is not permitted', prohibitions);
  }

  const parsed = consentPolicyDocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConsentPolicyError(
      'Consent policy is not valid',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const doc = parsed.data;
  const issues: string[] = [];

  if (doc.providerProcessing.retentionDays > 0 && !doc.activities.includes('provider_processing')) {
    issues.push('provider retention requires provider_processing to be consented');
  }
  if (issues.length > 0) {
    throw new ConsentPolicyError('Consent policy is not permitted', issues);
  }

  /**
   * Mode is a *ceiling* on capability; each activity is an independent grant.
   * A storyteller may enable composition yet refuse OCR, and documents then
   * simply go un-processed. Deriving activities from the mode would quietly
   * collapse that granularity, which is exactly what consent must not do.
   */
  const activities = new Set<ProcessingActivity>([...doc.activities, ...INALIENABLE_ACTIVITIES]);

  const normalised: ConsentPolicyDocument = {
    ...doc,
    activities: [...activities].sort(),
    dataCategories: [...new Set(doc.dataCategories)].sort(),
    restrictedTopics: [...new Set(doc.restrictedTopics.map((t) => t.trim()).filter(Boolean))].sort(),
    excludedSourceIds: [...new Set(doc.excludedSourceIds)].sort(),
    recipients: [...doc.recipients].sort((a, b) =>
      `${a.role}:${a.userId ?? ''}` < `${b.role}:${b.userId ?? ''}` ? -1 : 1,
    ),
    voiceAndLikeness: {
      syntheticVoice: false,
      syntheticLikeness: false,
      personaSimulation: false,
    },
    providerProcessing: {
      ...doc.providerProcessing,
      noModelTraining: true,
      // Provider flags cannot exceed the activities that were granted.
      transcription: doc.providerProcessing.transcription && activities.has('transcription'),
      ocr: doc.providerProcessing.ocr && activities.has('ocr'),
      embedding: doc.providerProcessing.embedding && activities.has('embedding'),
      generation: doc.providerProcessing.generation && activities.has('generation'),
    },
  };

  return { document: normalised, policyHash: hashPolicy(normalised) };
}

/**
 * The starting point a storyteller is shown at teach-back: private, minimal,
 * and granting nothing to anyone. Every expansion is a decision they make.
 */
export function defaultConsentDocument(): ConsentPolicyDocument {
  return {
    mode: 'preserve',
    dataCategories: ['audio', 'photo', 'document', 'text'],
    activities: ['storage', 'export'],
    recipients: [],
    restrictedTopics: [],
    excludedSourceIds: [],
    providerProcessing: {
      transcription: false,
      ocr: false,
      embedding: false,
      generation: false,
      retentionDays: 0,
      noModelTraining: true,
    },
    voiceAndLikeness: {
      syntheticVoice: false,
      syntheticLikeness: false,
      personaSimulation: false,
    },
    allowFutureChangesWithoutTeachBack: true,
  };
}

/** A ready-made grant for a family member, used by the permission centre. */
export function familyRecipientGrant(role: Role = 'family') {
  return {
    role,
    maxSensitivity: 'normal' as const,
    lifeStates: ['living' as const],
    mayExport: false,
    mayContribute: false,
  };
}

/** Describes a policy change in plain English, for the audit trail and the UI. */
export function diffPolicies(
  previous: ConsentPolicyDocument | null,
  next: ConsentPolicyDocument,
): string[] {
  if (!previous) return [`Consent set up with mode "${next.mode}".`];
  const changes: string[] = [];
  if (previous.mode !== next.mode) changes.push(`Mode changed from "${previous.mode}" to "${next.mode}".`);

  const added = next.activities.filter((a) => !previous.activities.includes(a));
  const removed = previous.activities.filter((a) => !next.activities.includes(a));
  if (added.length) changes.push(`Permitted: ${added.join(', ')}.`);
  if (removed.length) changes.push(`Withdrawn: ${removed.join(', ')}.`);

  const key = (r: ConsentPolicyDocument['recipients'][number]) => `${r.role}:${r.userId ?? 'all'}`;
  const prevKeys = new Set(previous.recipients.map(key));
  const nextKeys = new Set(next.recipients.map(key));
  for (const k of nextKeys) if (!prevKeys.has(k)) changes.push(`Access granted to ${k}.`);
  for (const k of prevKeys) if (!nextKeys.has(k)) changes.push(`Access removed from ${k}.`);

  const topicsAdded = next.restrictedTopics.filter((t) => !previous.restrictedTopics.includes(t));
  const topicsRemoved = previous.restrictedTopics.filter((t) => !next.restrictedTopics.includes(t));
  if (topicsAdded.length) changes.push(`Topics restricted: ${topicsAdded.join(', ')}.`);
  if (topicsRemoved.length) changes.push(`Topic restrictions lifted: ${topicsRemoved.join(', ')}.`);

  const srcAdded = next.excludedSourceIds.filter((s) => !previous.excludedSourceIds.includes(s));
  if (srcAdded.length) changes.push(`${srcAdded.length} source(s) excluded from processing.`);

  return changes.length > 0 ? changes : ['No effective change.'];
}
