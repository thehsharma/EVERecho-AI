import type { Action, Role } from '@everecho/contracts';
import type { ActionRequirement } from './types';

const req = (p: Partial<ActionRequirement> = {}): ActionRequirement => ({
  minMode: null,
  activity: null,
  readsContent: false,
  storytellerOnly: false,
  mutates: false,
  ...p,
});

/**
 * What each action demands of the consent policy. Exhaustive by construction:
 * `Record<Action, …>` means a new action cannot be added without deciding this.
 */
export const ACTION_REQUIREMENTS: Record<Action, ActionRequirement> = {
  'archive.create': req({ mutates: true }),
  'archive.read': req({}),
  'archive.update': req({ mutates: true }),
  'archive.freeze': req({ mutates: true }),
  'archive.delete': req({ storytellerOnly: true, mutates: true }),

  'invitation.create': req({ mutates: true }),
  'invitation.read': req({}),
  'invitation.revoke': req({ mutates: true }),
  'invitation.respond': req({ mutates: true }),
  'membership.read': req({}),
  'membership.revoke': req({ storytellerOnly: true, mutates: true }),
  'membership.update': req({ storytellerOnly: true, mutates: true }),

  'consent.read': req({}),
  'consent.grant': req({ storytellerOnly: true, mutates: true }),
  'consent.update': req({ storytellerOnly: true, mutates: true }),
  'consent.revoke': req({ storytellerOnly: true, mutates: true }),
  'consent.teachback.submit': req({ storytellerOnly: true, mutates: true }),
  'consent.history.read': req({}),
  'succession.read': req({}),
  'succession.update': req({ storytellerOnly: true, mutates: true }),

  'interview.start': req({ minMode: 'preserve', storytellerOnly: true, mutates: true }),
  'interview.answer': req({ minMode: 'preserve', storytellerOnly: true, mutates: true }),
  'interview.read': req({ minMode: 'preserve', readsContent: true }),
  'interview.summary.approve': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),

  'source.upload': req({ minMode: 'preserve', activity: 'storage', mutates: true }),
  'source.read': req({ minMode: 'preserve', readsContent: true }),
  'source.download': req({ minMode: 'preserve', readsContent: true }),
  'source.update_privacy': req({ storytellerOnly: true, mutates: true }),
  'source.delete': req({ storytellerOnly: true, mutates: true }),
  'transcript.read': req({ minMode: 'organise', readsContent: true }),
  'transcript.correct': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),

  'processing.transcribe': req({ minMode: 'organise', activity: 'transcription', mutates: true }),
  'processing.ocr': req({ minMode: 'organise', activity: 'ocr', mutates: true }),
  'processing.embed': req({ minMode: 'explore', activity: 'embedding', mutates: true }),
  'processing.extract_candidates': req({ minMode: 'organise', activity: 'transcription', mutates: true }),

  'memory.read': req({ minMode: 'organise', readsContent: true }),
  'memory.create': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'memory.update': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'memory.review': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'memory.delete': req({ storytellerOnly: true, mutates: true }),
  'entity.read': req({ minMode: 'organise', readsContent: true }),
  'entity.update': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'relationship.read': req({ minMode: 'organise', readsContent: true }),
  'relationship.update': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'event.read': req({ minMode: 'organise', readsContent: true }),
  'timeline.read': req({ minMode: 'explore', readsContent: true }),
  'biography.read': req({ minMode: 'compose', readsContent: true }),
  'biography.generate': req({ minMode: 'compose', activity: 'generation', mutates: true }),
  'biography.update': req({ minMode: 'compose', storytellerOnly: true, mutates: true }),
  'contradiction.read': req({ minMode: 'organise', readsContent: true }),
  'contradiction.resolve': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'correction.propose': req({ minMode: 'organise', activity: 'contribution', mutates: true }),
  'correction.read': req({ minMode: 'organise', readsContent: true }),

  'search.query': req({ minMode: 'explore', readsContent: true }),
  'question.ask': req({ minMode: 'compose', activity: 'generation', readsContent: true }),
  'response.read': req({ minMode: 'compose', readsContent: true }),
  'citation.open': req({ minMode: 'explore', readsContent: true }),

  'export.create': req({ minMode: 'preserve', activity: 'export', mutates: true }),
  'export.read': req({}),
  'export.download': req({ minMode: 'preserve', activity: 'export', readsContent: true }),
  'deletion.request': req({ mutates: true }),
  'deletion.read': req({}),
  'audit.read': req({}),

  'billing.read': req({}),
  'billing.manage': req({ mutates: true }),

  'admin.incident.read': req({}),
  'admin.incident.manage': req({ mutates: true }),
  'admin.archive.metadata.read': req({}),
  'admin.breakglass.request': req({ mutates: true }),
  'admin.worker.read': req({}),

  'perform.synthesise_voice': req({}),
  'perform.synthesise_likeness': req({}),
  'perform.persona_chat': req({}),
};

/**
 * Which actions each role may even attempt. Authority is not a ladder: a buyer
 * who paid for the archive appears here with *fewer* content rights than the
 * family member the storyteller later invited, and that is deliberate.
 */
const STORYTELLER_ACTIONS: readonly Action[] = (
  Object.keys(ACTION_REQUIREMENTS) as Action[]
).filter((a) => !a.startsWith('admin.') && !a.startsWith('perform.') && a !== 'archive.create');

/** Read-only consumption of approved material. */
const READER_ACTIONS: readonly Action[] = [
  'archive.read',
  'consent.read',
  'membership.read',
  'memory.read',
  'entity.read',
  'relationship.read',
  'event.read',
  'timeline.read',
  'biography.read',
  'source.read',
  'source.download',
  'transcript.read',
  'contradiction.read',
  'correction.read',
  'search.query',
  'question.ask',
  'response.read',
  'citation.open',
  'interview.read',
  'deletion.read',
  // Attempting an export is permitted by role; whether it succeeds is decided
  // by the storyteller's `mayExport` grant, not by the role table.
  'export.create',
  'export.read',
  'export.download',
];

export const ROLE_ACTIONS: Record<Role, readonly Action[]> = {
  storyteller: STORYTELLER_ACTIONS,

  /**
   * A buyer funds an archive and gets it started. They may not consent for the
   * storyteller, may not read memories unless the storyteller later names them
   * as a recipient, and do not become the owner by paying.
   */
  buyer: [
    'archive.read',
    'archive.update',
    'invitation.create',
    'invitation.read',
    'invitation.revoke',
    'membership.read',
    'consent.read',
    'billing.read',
    'billing.manage',
    'export.read',
    'deletion.read',
    'succession.read',
    // Content actions appear here so that a storyteller who *chooses* to name
    // the buyer as a recipient can grant them; consent still decides.
    'memory.read',
    'timeline.read',
    'biography.read',
    'search.query',
    'question.ask',
    'response.read',
    'citation.open',
    'source.read',
    'entity.read',
    'event.read',
    'relationship.read',
  ],

  family: READER_ACTIONS,

  contributor: [
    ...READER_ACTIONS,
    'source.upload',
    'correction.propose',
  ],

  /** Narrowly delegated continuity tasks. Not the executor. Not the owner. */
  steward: [
    'archive.read',
    'membership.read',
    'consent.read',
    'succession.read',
    'export.read',
    'deletion.read',
    'audit.read',
  ],

  support_admin: [
    'admin.incident.read',
    'admin.incident.manage',
    'admin.archive.metadata.read',
    'admin.breakglass.request',
    'admin.worker.read',
  ],
};

/** Actions the storyteller performs that a member's own consent grant cannot cover. */
export const MODE_RANK = {
  preserve: 0,
  organise: 1,
  explore: 2,
  compose: 3,
  perform: 4,
} as const;

export const SENSITIVITY_RANK = {
  normal: 0,
  sensitive: 1,
  restricted: 2,
  embargoed: 3,
} as const;
