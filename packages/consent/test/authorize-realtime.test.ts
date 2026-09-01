import { describe, expect, it } from 'vitest';
import type { Action } from '@everecho/contracts';
import { authorize } from '../src/authorize';
import { ACTION_REQUIREMENTS, ROLE_ACTIONS } from '../src/matrix';
import {
  ARCHIVE,
  BUYER,
  FAMILY,
  NOW,
  STORYTELLER,
  actor,
  context,
  openLearningPolicy,
  openPolicy,
  subject,
} from './helpers';

const ask = (input: {
  action: Action;
  who?: 'storyteller' | 'buyer' | 'family' | 'contributor';
  usesProvider?: boolean;
  subjectOverrides?: Parameters<typeof subject>[0];
}) => {
  const who = input.who ?? 'storyteller';
  const userId =
    who === 'storyteller' ? STORYTELLER : who === 'buyer' ? BUYER : FAMILY;
  return authorize({
    actor: actor(who === 'contributor' ? 'contributor' : who, userId),
    action: input.action,
    resource: { type: 'realtime_session', archiveId: ARCHIVE },
    subject: subject(input.subjectOverrides),
    context: { ...context, usesProvider: input.usesProvider ?? false },
  });
};

const REALTIME_ACTIONS = (Object.keys(ACTION_REQUIREMENTS) as Action[]).filter(
  (a) => a.startsWith('realtime.') || a.startsWith('learning.'),
);

describe('realtime and learning actions are wired into the matrix', () => {
  it('every new action has a requirement, by construction', () => {
    expect(REALTIME_ACTIONS.length).toBeGreaterThan(20);
    for (const action of REALTIME_ACTIONS) {
      expect(ACTION_REQUIREMENTS[action]).toBeDefined();
    }
  });

  it('the storyteller may attempt every one of them', () => {
    for (const action of REALTIME_ACTIONS) {
      expect(ROLE_ACTIONS.storyteller, action).toContain(action);
    }
  });

  it('no support admin may reach any of them', () => {
    for (const action of REALTIME_ACTIONS) {
      expect(ROLE_ACTIONS.support_admin, action).not.toContain(action);
    }
  });
});

describe('who may start a conversation', () => {
  it('lets the storyteller start an interview', () => {
    expect(ask({ action: 'realtime.interview.start' })).toMatchObject({ effect: 'ALLOW' });
  });

  it('refuses an interview to anyone who is not the storyteller', () => {
    // Being interviewed is not something anyone can arrange on another
    // competent adult's behalf.
    expect(ask({ action: 'realtime.interview.start', who: 'family' })).toMatchObject({
      effect: 'DENY',
    });
    expect(ask({ action: 'realtime.interview.start', who: 'buyer' })).toMatchObject({
      effect: 'DENY',
    });
  });

  it('lets an authorised family member start an assistant session', () => {
    expect(ask({ action: 'realtime.assistant.start', who: 'family' })).toMatchObject({
      effect: 'ALLOW',
    });
  });

  it('refuses an assistant session when no recipient grant covers the reader', () => {
    const noGrants = subject({ policy: openPolicy({ recipients: [] }) });
    const decision = authorize({
      actor: actor('family', FAMILY),
      action: 'realtime.assistant.start',
      resource: { type: 'realtime_session', archiveId: ARCHIVE },
      subject: noGrants,
      context,
    });
    expect(decision).toMatchObject({ effect: 'DENY', reasonCode: 'recipient_not_permitted' });
  });

  it('refuses an assistant session below compose mode', () => {
    expect(
      ask({
        action: 'realtime.assistant.start',
        who: 'family',
        subjectOverrides: { policy: openPolicy({ mode: 'explore' }) },
      }),
    ).toMatchObject({ effect: 'DENY', reasonCode: 'consent_mode_insufficient' });
  });
});

describe('the learning gate', () => {
  it('refuses candidate extraction when there is no learning policy at all', () => {
    expect(
      ask({ action: 'learning.candidate.create', subjectOverrides: { learningPolicy: null } }),
    ).toMatchObject({ effect: 'DENY', reasonCode: 'learning_policy_missing' });
  });

  it('refuses candidate extraction when the policy switches it off', () => {
    expect(
      ask({
        action: 'learning.candidate.create',
        subjectOverrides: { learningPolicy: openLearningPolicy({ candidateExtraction: false }) },
      }),
    ).toMatchObject({ effect: 'DENY', reasonCode: 'candidate_extraction_not_permitted' });
  });

  it('refuses everything once the learning policy has expired', () => {
    const expired = openLearningPolicy({
      expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
    });
    expect(
      ask({ action: 'learning.candidate.create', subjectOverrides: { learningPolicy: expired } }),
    ).toMatchObject({ effect: 'DENY', reasonCode: 'learning_policy_expired' });
  });

  it('refuses audio storage when retention is "never"', () => {
    expect(
      ask({
        action: 'realtime.audio.store',
        subjectOverrides: { learningPolicy: openLearningPolicy({ audioRetention: 'never' }) },
      }),
    ).toMatchObject({ effect: 'DENY', reasonCode: 'audio_retention_not_permitted' });
  });

  it('permits audio storage when the storyteller asked for it', () => {
    expect(ask({ action: 'realtime.audio.store' })).toMatchObject({ effect: 'ALLOW' });
  });

  it('reports a consent refusal before a learning refusal', () => {
    // "You have not permitted transcripts to be kept" is the wrong thing to
    // say to someone who never consented to transcription at all.
    const noTranscription = subject({
      policy: openPolicy({ activities: ['storage'] }),
      learningPolicy: openLearningPolicy({ transcriptRetention: 'ephemeral' }),
    });
    const decision = authorize({
      actor: actor('storyteller', STORYTELLER),
      action: 'realtime.session.transcribe',
      resource: { type: 'realtime_session', archiveId: ARCHIVE },
      subject: noTranscription,
      context,
    });
    expect(decision).toMatchObject({ effect: 'DENY', reasonCode: 'activity_not_consented' });
  });
});

describe('provider gates apply only when a provider is actually involved', () => {
  const localOnly = openLearningPolicy({
    providerProcessing: {
      mode: 'local_only',
      speechToText: false,
      speechSynthesis: false,
      composition: false,
      namedProviders: [],
      retentionDays: 0,
    },
  });

  it('permits local transcription under a local-only policy', () => {
    // The whole demonstration path depends on this: nothing leaves the host,
    // so no third party hears anything, so no provider gate applies.
    expect(
      ask({
        action: 'realtime.session.transcribe',
        usesProvider: false,
        subjectOverrides: { learningPolicy: localOnly },
      }),
    ).toMatchObject({ effect: 'ALLOW' });
  });

  it('refuses provider transcription under a local-only policy', () => {
    expect(
      ask({
        action: 'realtime.session.transcribe',
        usesProvider: true,
        subjectOverrides: { learningPolicy: localOnly },
      }),
    ).toMatchObject({ effect: 'DENY', reasonCode: 'provider_speech_not_consented' });
  });

  it('refuses provider speech synthesis under a local-only policy', () => {
    expect(
      ask({
        action: 'realtime.session.speak',
        usesProvider: true,
        subjectOverrides: { learningPolicy: localOnly },
      }),
    ).toMatchObject({ effect: 'DENY', reasonCode: 'provider_speech_not_consented' });
  });

  it('permits provider use once the storyteller has named providers', () => {
    expect(
      ask({ action: 'realtime.session.transcribe', usesProvider: true }),
    ).toMatchObject({ effect: 'ALLOW' });
  });
});

describe('approval is the storyteller’s alone', () => {
  for (const action of [
    'learning.candidate.approve',
    'learning.candidate.reject',
    'learning.candidate.edit',
    'learning.candidate.read',
  ] as const) {
    it(`refuses ${action} to a family member`, () => {
      expect(ask({ action, who: 'family' })).toMatchObject({ effect: 'DENY' });
    });

    it(`refuses ${action} to the buyer`, () => {
      expect(ask({ action, who: 'buyer' })).toMatchObject({ effect: 'DENY' });
    });

    it(`permits ${action} to the storyteller`, () => {
      expect(ask({ action })).toMatchObject({ effect: 'ALLOW' });
    });
  }

  it('refuses the buyer’s attempt to change the learning policy, naming why', () => {
    const decision = ask({ action: 'learning.policy.update', who: 'buyer' });
    expect(decision).toMatchObject({ effect: 'DENY' });
    // The buyer needs to hear that this decision is not theirs to make, not
    // that their role lacks a capability.
    if (decision.effect === 'DENY') {
      expect(['storyteller_only', 'role_not_permitted']).toContain(decision.reasonCode);
    }
  });
});

describe('obligations carry the resolved learning policy', () => {
  it('an ALLOW reports what the session may do, so it is resolved once', () => {
    const decision = ask({ action: 'realtime.interview.start' });
    expect(decision.effect).toBe('ALLOW');
    if (decision.effect === 'ALLOW') {
      expect(decision.obligations.learning.mayExtractCandidates).toBe(true);
      expect(decision.obligations.learning.mayStoreTranscript).toBe(true);
      expect(decision.obligations.learning.allowedCandidateCategories.length).toBeGreaterThan(0);
    }
  });

  it('an administrator’s ALLOW learns nothing', () => {
    const decision = authorize({
      actor: { ...actor('support_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), membership: null },
      action: 'admin.worker.read',
      resource: { type: 'worker', archiveId: ARCHIVE },
      subject: subject(),
      context,
    });
    expect(decision.effect).toBe('ALLOW');
    if (decision.effect === 'ALLOW') {
      expect(decision.obligations.learning.mayExtractCandidates).toBe(false);
      expect(decision.obligations.learning.mayStoreTranscript).toBe(false);
      expect(decision.obligations.learning.mayStoreAudio).toBe(false);
    }
  });
});

describe('prohibited capabilities are still prohibited during a conversation', () => {
  for (const action of [
    'perform.synthesise_voice',
    'perform.synthesise_likeness',
    'perform.persona_chat',
  ] as const) {
    it(`refuses ${action} even to the storyteller with every policy wide open`, () => {
      expect(ask({ action })).toMatchObject({
        effect: 'DENY',
        reasonCode: 'capability_prohibited_in_v0_1',
      });
    });
  }
});
