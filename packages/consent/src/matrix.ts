import type { Action, Role } from '@everecho/contracts';
import type { ActionRequirement } from './types';

const req = (p: Partial<ActionRequirement> = {}): ActionRequirement => ({
  minMode: null,
  activity: null,
  readsContent: false,
  storytellerOnly: false,
  mutates: false,
  learning: null,
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

  // What may be heard after they have died. Readable by anyone with access to
  // the archive — a family member is entitled to know what was decided about
  // them — but writable only by the person it speaks for.
  // Hearing the actual recording, as distinct from reading what was said.
  // It needs the same mode as opening a citation because that is what it is —
  // the original source, played rather than read.
  'voice.listen': req({ minMode: 'explore', readsContent: true }),
  'remembrance.read': req({}),
  'remembrance.update': req({ storytellerOnly: true, mutates: true }),
  'remembrance.affirm': req({ storytellerOnly: true, mutates: true }),

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
  'processing.extract_candidates': req({
    minMode: 'organise',
    activity: 'transcription',
    mutates: true,
  }),

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

  // Establishing that somebody has died is not a product action, which is why
  // it carries the admin prefix: that prefix is what excludes it from every
  // archive role, storyteller included. It requires documentary evidence and is
  // recorded against a named human — see the remembrance_activation table.
  'admin.remembrance.activate': req({ mutates: true }),
  'admin.incident.read': req({}),
  'admin.incident.manage': req({ mutates: true }),
  'admin.archive.metadata.read': req({}),
  'admin.breakglass.request': req({ mutates: true }),
  'admin.worker.read': req({}),

  // Real-time conversation.
  //
  // `realtime.interview.start` is storyteller-only because being interviewed is
  // not something anyone can arrange on another adult's behalf. Every later
  // action in a session is shared between modes: the storyteller reaching their
  // own archive short-circuits the recipient-grant check anyway, so one
  // requirement serves both modes correctly.
  'realtime.interview.start': req({
    minMode: 'organise',
    storytellerOnly: true,
    mutates: true,
    learning: 'sessionContext',
  }),
  'realtime.assistant.start': req({
    minMode: 'compose',
    activity: 'generation',
    readsContent: true,
    mutates: true,
    learning: 'sessionContext',
  }),
  'realtime.session.read': req({}),
  'realtime.session.connect': req({ minMode: 'preserve', mutates: true }),
  'realtime.session.listen': req({ minMode: 'preserve', mutates: true }),
  'realtime.session.transcribe': req({
    minMode: 'organise',
    activity: 'transcription',
    mutates: true,
    learning: 'speechToText',
  }),
  'realtime.session.retrieve': req({ minMode: 'explore', readsContent: true }),
  'realtime.session.generate': req({
    minMode: 'compose',
    activity: 'generation',
    readsContent: true,
    learning: 'composition',
  }),
  'realtime.session.speak': req({
    minMode: 'compose',
    activity: 'generation',
    learning: 'speechSynthesis',
  }),
  'realtime.session.end': req({ mutates: true }),
  'realtime.turn.read': req({ minMode: 'preserve', readsContent: true }),
  'realtime.turn.correct': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'realtime.audio.store': req({
    minMode: 'preserve',
    activity: 'storage',
    mutates: true,
    learning: 'audioRetention',
  }),
  'realtime.audio.delete': req({ storytellerOnly: true, mutates: true }),

  // Consent-controlled learning.
  'learning.policy.read': req({}),
  'learning.policy.update': req({ storytellerOnly: true, mutates: true }),
  'learning.candidate.create': req({
    minMode: 'organise',
    activity: 'transcription',
    mutates: true,
    learning: 'candidateExtraction',
  }),
  'learning.candidate.read': req({
    minMode: 'organise',
    storytellerOnly: true,
    readsContent: true,
  }),
  'learning.candidate.edit': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  // Approval is the moment a conversation becomes family history. Only the
  // storyteller, always, with no delegation path in v0.2.
  'learning.candidate.approve': req({
    minMode: 'organise',
    storytellerOnly: true,
    mutates: true,
  }),
  'learning.candidate.reject': req({
    minMode: 'organise',
    storytellerOnly: true,
    mutates: true,
  }),
  'learning.preference.read': req({}),
  'learning.preference.write': req({ mutates: true }),
  'learning.preference.delete': req({ mutates: true }),

  // The family growth loop (v0.3).
  //
  // Asking reads no content — a question is the asker's own words — but it does
  // require a recipient grant, because somebody with no relationship to the
  // archive has no standing to put a question in front of the storyteller.
  // `readsContent` is true so that the recipient grant, the sensitivity ceiling
  // and the restricted-topic list are all applied by the same code that governs
  // everything else.
  'familyQuestion.create': req({ minMode: 'organise', readsContent: true, mutates: true }),
  'familyQuestion.read': req({ minMode: 'organise', readsContent: true }),
  // Answering is the storyteller's alone. A steward or a buyer answering a
  // question about somebody else's life would be putting words in their mouth,
  // which is the one thing this product exists not to do.
  'familyQuestion.respond': req({
    minMode: 'organise',
    activity: 'transcription',
    storytellerOnly: true,
    mutates: true,
  }),
  'familyQuestion.decline': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'familyQuestion.restrict': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  // The asker may take back their own question. Not storyteller-only: it is
  // their question, and withdrawing it is not a claim about anybody's life.
  'familyQuestion.withdraw': req({ minMode: 'organise', mutates: true }),

  // Contributions (v0.3).
  //
  // Proposing requires the `mayContribute` grant, which `authorize()` applies
  // through `contribution_not_permitted` — being a family member is not the
  // same as being invited to add to somebody's life story.
  'contribution.create': req({ minMode: 'organise', readsContent: true, mutates: true }),
  'contribution.read': req({ minMode: 'organise', readsContent: true }),
  'contribution.edit': req({ minMode: 'organise', mutates: true }),
  // Approval is the storyteller's alone. A contributor who could approve their
  // own proposal would be an editor of somebody else's memory.
  'contribution.approve': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'contribution.reject': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'contribution.withdraw': req({ minMode: 'organise', mutates: true }),

  // Capsules (v0.3).
  //
  // Making one is the storyteller's; opening one requires the recipient grant
  // that governs everything else, because a capsule narrows what consent
  // permits and can never widen it.
  'capsule.create': req({ minMode: 'explore', storytellerOnly: true, mutates: true }),
  'capsule.update': req({ minMode: 'explore', storytellerOnly: true, mutates: true }),
  'capsule.revoke': req({ minMode: 'explore', storytellerOnly: true, mutates: true }),
  'capsule.read': req({ minMode: 'explore', readsContent: true }),
  'capsule.open': req({ minMode: 'explore', readsContent: true }),
  // Taking a copy is governed by the same `export` activity and `mayExport`
  // grant as any other export, *and* by the capsule's own download setting. A
  // copy outlives every revocation, so both have to say yes.
  'capsule.download': req({ minMode: 'explore', activity: 'export', readsContent: true }),

  // Coverage (v0.3). The storyteller's alone: what an archive does not say
  // about somebody is nobody else's business, and offering the list to family
  // would turn it into a to-do list they could chase somebody about.
  'memoryGap.read': req({ minMode: 'organise', storytellerOnly: true, readsContent: true }),
  // Answering matches reading rather than `interview.answer`'s `preserve`:
  // a question that cannot be seen cannot be answered, so a lower bound here
  // would be one that is never reachable.
  'memoryGap.answer': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'memoryGap.dismiss': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'storyMission.read': req({ minMode: 'organise', storytellerOnly: true, readsContent: true }),
  'storyMission.complete': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),
  'storyMission.dismiss': req({ minMode: 'organise', storytellerOnly: true, mutates: true }),

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
  // A family member is entitled to know what was decided about them, including
  // that something was withheld. Being refused without being told a decision
  // exists is how people conclude the software is hiding something.
  'remembrance.read',
  'voice.listen',
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
  // Live conversation with the archive. Listed here so that *consent* decides
  // whether a reader may hold one, rather than the role table quietly deciding
  // it for the storyteller. Starting an interview is deliberately absent:
  // being interviewed is not something anyone arranges on another adult's
  // behalf.
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
  'learning.policy.read',
  // Interface preferences are facts about the person using the software, not
  // about the archive, so every role may manage their own.
  'learning.preference.read',
  'learning.preference.write',
  'learning.preference.delete',
  // Asking the storyteller a question, and reading the answer they chose to
  // give. Listed here so consent decides who may ask, not the role table.
  'familyQuestion.create',
  'familyQuestion.read',
  'familyQuestion.withdraw',
  // Every reader may see what has been proposed and what became of it: the
  // review trail is part of trusting the archive, not a private queue.
  'contribution.read',
  // Opening a capsule somebody made for you. Whether this particular capsule
  // is yours is decided per capsule, not by the role table.
  'capsule.read',
  'capsule.open',
  'capsule.download',
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
    'remembrance.read',
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
    // As with the content actions above: present so a storyteller who chooses
    // to name the buyer as a recipient can grant them. Consent still decides.
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
    'learning.policy.read',
    'learning.preference.read',
    'learning.preference.write',
    'learning.preference.delete',
  ],

  family: READER_ACTIONS,

  contributor: [
    ...READER_ACTIONS,
    'source.upload',
    'correction.propose',
    'contribution.create',
    'contribution.edit',
    'contribution.withdraw',
  ],

  /** Narrowly delegated continuity tasks. Not the executor. Not the owner. */
  steward: [
    'archive.read',
    'membership.read',
    'consent.read',
    'succession.read',
    'remembrance.read',
    'export.read',
    'deletion.read',
    'audit.read',
    'learning.policy.read',
    'learning.preference.read',
    'learning.preference.write',
    'learning.preference.delete',
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
