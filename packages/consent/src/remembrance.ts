/**
 * What may be heard after the storyteller has died.
 *
 * Pure, like `authorize()`, and for the same reason: this decides whether a
 * bereaved family member hears their mother's voice or is told they may not,
 * and a decision that important should be testable without a database, a
 * network, or a running application.
 *
 * It answers two questions separately, because they are two decisions and
 * people make them differently. Whether the *words* may be read, and whether
 * the *recording* may be played. Somebody may be entirely happy to be quoted
 * and not want their voice in the room.
 *
 * This never widens anything. It runs after `authorize()` has already decided
 * that this person may see this archive at all; a directive can only narrow
 * what consent already permitted, or withhold it entirely.
 */

export type ClauseEffect = 'permit' | 'withhold';
export type ClauseScope = 'archive' | 'topic' | 'memory' | 'source';

export interface RemembranceClause {
  effect: ClauseEffect;
  scope: ClauseScope;
  topic: string | null;
  memoryId: string | null;
  sourceAssetId: string | null;
  /** NULL means everyone the archive already permits. It never widens beyond that. */
  audienceUserId: string | null;
  notBefore: Date | null;
  allowAudio: boolean;
}

export interface RemembranceDirective {
  status: 'draft' | 'affirmed' | 'superseded' | 'activated';
  /** What silence means. The storyteller chose it; nothing here assumes one. */
  defaultEffect: ClauseEffect;
  clauses: readonly RemembranceClause[];
}

export interface RemembranceSubject {
  memoryId?: string | null;
  sourceAssetId?: string | null;
  topics?: readonly string[];
}

export interface RemembranceDecision {
  /** Whether the words may be read at all. */
  mayRead: boolean;
  /** Whether the actual recording may be played. False whenever mayRead is false. */
  mayHearVoice: boolean;
  /**
   * Why, as a code. Never prose, and never the storyteller's note: this
   * travels into audit rows and API responses, and the reason somebody was
   * refused is not itself a place to put private material.
   */
  reasonCode:
    | 'not_activated'
    | 'permitted_by_clause'
    | 'permitted_by_default'
    | 'withheld_by_clause'
    | 'withheld_by_default'
    | 'not_yet'
    | 'audio_withheld';
}

/**
 * Whether a clause is about this thing.
 *
 * An archive-scoped clause is about everything. A topic clause matches on the
 * exact topic, case-insensitively — not on a substring, because "money" would
 * otherwise match "harmony" and seal a story about a wedding.
 */
function matchesSubject(clause: RemembranceClause, subject: RemembranceSubject): boolean {
  switch (clause.scope) {
    case 'archive':
      return true;
    case 'topic': {
      const wanted = clause.topic?.trim().toLowerCase();
      if (!wanted) return false;
      return (subject.topics ?? []).some((t) => t.trim().toLowerCase() === wanted);
    }
    case 'memory':
      return clause.memoryId !== null && clause.memoryId === subject.memoryId;
    case 'source':
      return clause.sourceAssetId !== null && clause.sourceAssetId === subject.sourceAssetId;
  }
}

/** Whether a clause is addressed to this person, or to everybody. */
function matchesAudience(clause: RemembranceClause, viewerUserId: string): boolean {
  return clause.audienceUserId === null || clause.audienceUserId === viewerUserId;
}

export function resolveRemembrance(input: {
  directive: RemembranceDirective | null;
  subject: RemembranceSubject;
  viewerUserId: string;
  now: Date;
}): RemembranceDecision {
  const { directive, subject, viewerUserId, now } = input;

  // While the storyteller is alive, the directive says nothing. It is a
  // statement about after, and treating it as a live permission would mean a
  // person losing access to their own archive by planning ahead.
  if (!directive || directive.status !== 'activated') {
    return { mayRead: true, mayHearVoice: true, reasonCode: 'not_activated' };
  }

  const relevant = directive.clauses.filter(
    (c) => matchesSubject(c, subject) && matchesAudience(c, viewerUserId),
  );

  // A refusal anywhere wins, at any scope, regardless of what else is said.
  // Deliberately not "narrowest clause wins": if the storyteller sealed the
  // whole archive to one person and separately permitted one memory to
  // everybody, the specific permission must not reopen what they closed. The
  // asymmetry is the point — refusals are absolute, permissions are not.
  if (relevant.some((c) => c.effect === 'withhold')) {
    return { mayRead: false, mayHearVoice: false, reasonCode: 'withheld_by_clause' };
  }

  const permits = relevant.filter((c) => c.effect === 'permit');

  if (permits.length === 0) {
    return directive.defaultEffect === 'permit'
      ? { mayRead: true, mayHearVoice: true, reasonCode: 'permitted_by_default' }
      : { mayRead: false, mayHearVoice: false, reasonCode: 'withheld_by_default' };
  }

  // "Not yet" is a permission that has not arrived. It is only reached when a
  // clause permits, because a refusal already returned above.
  const open = permits.filter((c) => c.notBefore === null || c.notBefore <= now);
  if (open.length === 0) {
    return { mayRead: false, mayHearVoice: false, reasonCode: 'not_yet' };
  }

  // The words are permitted. The voice is a second decision, and the cautious
  // reading wins: if any open clause about this thing withholds the audio,
  // the audio is withheld. Somebody who said "quote me but do not play me"
  // about one topic meant it.
  const mayHearVoice = open.every((c) => c.allowAudio);
  return {
    mayRead: true,
    mayHearVoice,
    reasonCode: mayHearVoice ? 'permitted_by_clause' : 'audio_withheld',
  };
}
