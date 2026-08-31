import { describe, expect, it } from 'vitest';
import { PROHIBITED_ACTIONS, type Action } from '@everecho/contracts';
import { authorize } from '../src/authorize';
import { ACTION_REQUIREMENTS, ROLE_ACTIONS } from '../src/matrix';
import { ARCHIVE, BUYER, FAMILY, SOURCE, STORYTELLER, actor, context, openPolicy, policy, resource, subject } from './helpers';

const ask = (a: Partial<Parameters<typeof authorize>[0]>) =>
  authorize({
    actor: actor('storyteller', STORYTELLER),
    action: 'memory.read',
    resource: resource(),
    subject: subject(),
    context,
    ...a,
  });

describe('prohibited capabilities', () => {
  it.each(PROHIBITED_ACTIONS)('refuses %s even for the storyteller', (action) => {
    const d = ask({ action });
    expect(d.effect).toBe('DENY');
    expect(d.reasonCode).toBe('capability_prohibited_in_v0_1');
  });

  it('refuses prohibited capabilities for a platform admin too', () => {
    const d = ask({
      actor: { userId: BUYER, isPlatformAdmin: true, membership: null },
      action: 'perform.persona_chat',
    });
    expect(d.reasonCode).toBe('capability_prohibited_in_v0_1');
  });

  it('gives no role the prohibited actions', () => {
    for (const actions of Object.values(ROLE_ACTIONS)) {
      for (const prohibited of PROHIBITED_ACTIONS) {
        expect(actions).not.toContain(prohibited);
      }
    }
  });
});

describe('authentication and membership', () => {
  it('denies an anonymous caller', () => {
    const d = ask({ actor: { userId: null, isPlatformAdmin: false, membership: null } });
    expect(d.reasonCode).toBe('not_authenticated');
  });

  it('denies a signed-in stranger without disclosing that the archive exists', () => {
    const d = ask({ actor: { userId: FAMILY, isPlatformAdmin: false, membership: null } });
    expect(d.effect).toBe('DENY');
    expect(d.reasonCode).toBe('not_a_member');
    expect(d.explanation).not.toMatch(/exists|deleted|frozen/i);
  });

  it.each([
    ['revoked', 'membership_revoked'],
    ['expired', 'membership_expired'],
    ['pending', 'membership_pending'],
  ] as const)('denies a %s membership', (status, reason) => {
    const d = ask({
      actor: { userId: FAMILY, isPlatformAdmin: false, membership: { role: 'family', status, grantedAt: null, expiresAt: null } },
    });
    expect(d.reasonCode).toBe(reason);
  });

  it('denies once an access window has closed', () => {
    const d = ask({
      actor: {
        userId: FAMILY,
        isPlatformAdmin: false,
        membership: { role: 'family', status: 'active', grantedAt: null, expiresAt: '2026-01-01T00:00:00.000Z' },
      },
    });
    expect(d.reasonCode).toBe('membership_expired');
  });

  it('denies before an access window opens', () => {
    const d = ask({
      actor: {
        userId: FAMILY,
        isPlatformAdmin: false,
        membership: { role: 'family', status: 'active', grantedAt: '2027-01-01T00:00:00.000Z', expiresAt: null },
      },
    });
    expect(d.reasonCode).toBe('access_window_not_started');
  });
});

describe('the buyer cannot consent for the storyteller', () => {
  it.each(['consent.grant', 'consent.update', 'consent.revoke', 'consent.teachback.submit'] as Action[])(
    'refuses %s',
    (action) => {
      const d = ask({ actor: actor('buyer', BUYER), action });
      expect(d.effect).toBe('DENY');
      expect(d.reasonCode).toBe('buyer_cannot_consent_for_storyteller');
    },
  );

  it('refuses a buyer who is not a named recipient any memory content', () => {
    const d = ask({ actor: actor('buyer', BUYER), action: 'memory.read' });
    expect(d.reasonCode).toBe('recipient_not_permitted');
  });

  it('allows a buyer the storyteller deliberately named as a recipient', () => {
    const p = openPolicy({
      recipients: [
        { role: 'buyer', userId: BUYER, maxSensitivity: 'normal', lifeStates: ['living'], mayExport: false, mayContribute: false },
      ],
    });
    const d = ask({ actor: actor('buyer', BUYER), action: 'memory.read', subject: subject({ policy: p }) });
    expect(d.effect).toBe('ALLOW');
  });

  it('does not let paying make the buyer the archive owner', () => {
    const d = ask({ actor: actor('buyer', BUYER), action: 'membership.revoke' });
    expect(d.effect).toBe('DENY');
    expect(d.reasonCode).toBe('role_not_permitted');
  });

  it('refuses a buyer the ability to delete the archive', () => {
    const d = ask({ actor: actor('buyer', BUYER), action: 'archive.delete' });
    expect(d.effect).toBe('DENY');
  });
});

describe('consent modes gate capability', () => {
  const modes = ['preserve', 'organise', 'explore', 'compose'] as const;
  const cases: [Action, (typeof modes)[number]][] = [
    ['source.upload', 'preserve'],
    ['memory.read', 'organise'],
    ['transcript.read', 'organise'],
    ['timeline.read', 'explore'],
    ['search.query', 'explore'],
    ['question.ask', 'compose'],
    ['biography.read', 'compose'],
  ];

  it.each(cases)('%s requires at least mode %s', (action, needed) => {
    for (const mode of modes) {
      const p = openPolicy({ mode });
      const d = ask({ action, subject: subject({ policy: p }) });
      const sufficient = modes.indexOf(mode) >= modes.indexOf(needed);
      if (sufficient) expect(d.effect, `${action}@${mode}`).toBe('ALLOW');
      else expect(d.reasonCode, `${action}@${mode}`).toBe('consent_mode_insufficient');
    }
  });

  it('denies every content action when no consent policy exists at all', () => {
    const contentActions = (Object.keys(ACTION_REQUIREMENTS) as Action[]).filter(
      (a) => ACTION_REQUIREMENTS[a].minMode !== null,
    );
    for (const action of contentActions) {
      const d = ask({ action, subject: subject({ policy: null }) });
      expect(d.effect, action).toBe('DENY');
      expect(d.reasonCode, action).toBe('consent_missing');
    }
  });
});

describe('activities and provider processing are consented separately', () => {
  it('refuses transcription when the activity was not granted', () => {
    const p = openPolicy({ activities: ['storage', 'export', 'embedding', 'generation', 'ocr'] });
    const d = ask({ action: 'processing.transcribe', subject: subject({ policy: p }) });
    expect(d.reasonCode).toBe('activity_not_consented');
  });

  it('refuses transcription when the activity is granted but the provider is not', () => {
    const p = openPolicy({
      providerProcessing: { transcription: false, ocr: true, embedding: true, generation: true, retentionDays: 0, noModelTraining: true },
    });
    const d = ask({ action: 'processing.transcribe', subject: subject({ policy: p }) });
    expect(d.reasonCode).toBe('provider_processing_not_consented');
  });

  it('refuses a question when generation may not reach a provider', () => {
    const p = openPolicy({
      providerProcessing: { transcription: true, ocr: true, embedding: true, generation: false, retentionDays: 0, noModelTraining: true },
    });
    const d = ask({ action: 'question.ask', subject: subject({ policy: p }) });
    expect(d.reasonCode).toBe('provider_processing_not_consented');
  });

  it('refuses material in a category the storyteller did not permit', () => {
    const d = ask({
      action: 'memory.read',
      resource: resource({ dataCategories: ['health'] }),
    });
    expect(d.reasonCode).toBe('data_category_not_consented');
  });
});

describe('per-source and per-topic control', () => {
  it('never processes a source the storyteller excluded, even for the storyteller', () => {
    const p = openPolicy({ excludedSourceIds: [SOURCE] });
    const d = ask({
      action: 'processing.transcribe',
      resource: resource({ type: 'source_asset', sourceId: SOURCE }),
      subject: subject({ policy: p }),
    });
    expect(d.reasonCode).toBe('source_excluded');
  });

  it('lets the storyteller still read their own excluded source', () => {
    const p = openPolicy({ excludedSourceIds: [SOURCE] });
    const d = ask({
      action: 'source.read',
      resource: resource({ type: 'source_asset', sourceId: SOURCE }),
      subject: subject({ policy: p }),
    });
    expect(d.effect).toBe('ALLOW');
  });

  it('hides an excluded source from family', () => {
    const p = openPolicy({ excludedSourceIds: [SOURCE] });
    const d = ask({
      actor: actor('family', FAMILY),
      action: 'source.read',
      resource: resource({ type: 'source_asset', sourceId: SOURCE }),
      subject: subject({ policy: p }),
    });
    expect(d.reasonCode).toBe('source_excluded');
  });

  it('refuses a restricted topic to family but not to the storyteller', () => {
    const p = openPolicy({ restrictedTopics: ['divorce'] });
    const denied = ask({
      actor: actor('family', FAMILY),
      action: 'question.ask',
      resource: resource({ type: 'question', topics: ['divorce'] }),
      subject: subject({ policy: p }),
    });
    expect(denied.reasonCode).toBe('restricted_topic');

    const allowed = ask({
      action: 'question.ask',
      resource: resource({ type: 'question', topics: ['divorce'] }),
      subject: subject({ policy: p }),
    });
    expect(allowed.effect).toBe('ALLOW');
  });

  it('matches restricted topics loosely enough to survive paraphrase', () => {
    const p = openPolicy({ restrictedTopics: ['money'] });
    const d = ask({
      actor: actor('family', FAMILY),
      action: 'search.query',
      resource: resource({ type: 'search', topics: ['money troubles'] }),
      subject: subject({ policy: p }),
    });
    expect(d.reasonCode).toBe('restricted_topic');
  });

  it('withholds embargoed material from family until the date passes', () => {
    const embargoed = ask({
      actor: actor('family', FAMILY),
      action: 'source.read',
      resource: resource({ type: 'source_asset', embargoUntil: '2030-01-01T00:00:00.000Z' }),
    });
    expect(embargoed.reasonCode).toBe('source_embargoed');

    const lifted = ask({
      actor: actor('family', FAMILY),
      action: 'source.read',
      resource: resource({ type: 'source_asset', embargoUntil: '2020-01-01T00:00:00.000Z' }),
    });
    expect(lifted.effect).toBe('ALLOW');
  });
});

describe('recipient grants', () => {
  it('refuses material more sensitive than the grant allows', () => {
    const d = ask({
      actor: actor('family', FAMILY),
      action: 'memory.read',
      resource: resource({ sensitivity: 'restricted' }),
    });
    expect(d.reasonCode).toBe('sensitivity_above_grant');
  });

  it('reports the grant ceiling as an obligation so retrieval filters identically', () => {
    const d = ask({ actor: actor('family', FAMILY), action: 'search.query', resource: resource({ type: 'search' }) });
    expect(d.effect).toBe('ALLOW');
    if (d.effect === 'ALLOW') expect(d.obligations.maxSensitivity).toBe('normal');
  });

  it('gives the storyteller an unrestricted ceiling in their own archive', () => {
    const d = ask({ action: 'search.query', resource: resource({ type: 'search' }) });
    if (d.effect === 'ALLOW') expect(d.obligations.maxSensitivity).toBe('embargoed');
  });

  it('honours a grant that only applies after death', () => {
    const p = openPolicy({
      recipients: [
        { role: 'family', maxSensitivity: 'normal', lifeStates: ['posthumous'], mayExport: false, mayContribute: false },
      ],
    });
    const living = ask({ actor: actor('family', FAMILY), action: 'memory.read', subject: subject({ policy: p }) });
    expect(living.reasonCode).toBe('life_state_not_permitted');

    const posthumous = ask({
      actor: actor('family', FAMILY),
      action: 'memory.read',
      subject: subject({ policy: p, lifeState: 'posthumous' }),
    });
    expect(posthumous.effect).toBe('ALLOW');
  });

  it('refuses export to a recipient who was not granted it', () => {
    const d = ask({ actor: actor('family', FAMILY), action: 'export.create', resource: resource({ type: 'export_job' }) });
    expect(d.reasonCode).toBe('export_not_permitted');
  });

  it('refuses a contribution from a family member but allows it from a contributor', () => {
    const CONTRIB = '77777777-7777-4777-8777-777777777777';
    const denied = ask({
      actor: actor('family', FAMILY),
      action: 'correction.propose',
      resource: resource({ type: 'correction' }),
    });
    expect(denied.effect).toBe('DENY');

    const allowed = ask({
      actor: actor('contributor', CONTRIB),
      action: 'correction.propose',
      resource: resource({ type: 'correction' }),
    });
    expect(allowed.effect).toBe('ALLOW');
  });

  it('prefers a grant addressed to the user over the role default', () => {
    const p = openPolicy({
      recipients: [
        { role: 'family', maxSensitivity: 'normal', lifeStates: ['living'], mayExport: false, mayContribute: false },
        { role: 'family', userId: FAMILY, maxSensitivity: 'restricted', lifeStates: ['living'], mayExport: true, mayContribute: false },
      ],
    });
    const d = ask({
      actor: actor('family', FAMILY),
      action: 'memory.read',
      resource: resource({ sensitivity: 'restricted' }),
      subject: subject({ policy: p }),
    });
    expect(d.effect).toBe('ALLOW');
  });
});

describe('revocation takes effect immediately', () => {
  it('turns an allow into a deny the moment the recipient is removed', () => {
    const before = ask({ actor: actor('family', FAMILY), action: 'memory.read' });
    expect(before.effect).toBe('ALLOW');

    const after = ask({
      actor: actor('family', FAMILY),
      action: 'memory.read',
      subject: subject({ policy: openPolicy({ recipients: [] }) }),
    });
    expect(after.reasonCode).toBe('recipient_not_permitted');
  });

  it('blocks downloads as well as reads', () => {
    const d = ask({
      actor: actor('family', FAMILY),
      action: 'source.download',
      resource: resource({ type: 'source_asset' }),
      subject: subject({ policy: openPolicy({ recipients: [] }) }),
    });
    expect(d.effect).toBe('DENY');
  });
});

describe('archive lifecycle', () => {
  it('refuses writes to a frozen archive but still allows reads', () => {
    const s = subject({ archiveStatus: 'frozen' });
    expect(ask({ action: 'memory.update', subject: s }).reasonCode).toBe('archive_frozen');
    expect(ask({ action: 'memory.read', subject: s }).effect).toBe('ALLOW');
  });

  it('still permits export and deletion from a frozen archive', () => {
    const s = subject({ archiveStatus: 'frozen' });
    expect(ask({ action: 'export.create', resource: resource({ type: 'export_job' }), subject: s }).effect).toBe('ALLOW');
    expect(ask({ action: 'deletion.request', resource: resource({ type: 'deletion_request' }), subject: s }).effect).toBe('ALLOW');
  });

  it('lets a user watch deletion finish but not read content once deleted', () => {
    const s = subject({ archiveStatus: 'deleted' });
    expect(ask({ action: 'deletion.read', resource: resource({ type: 'deletion_request' }), subject: s }).effect).toBe('ALLOW');
    expect(ask({ action: 'memory.read', subject: s }).reasonCode).toBe('archive_deleted');
  });

  it('pauses sharing during a dispute without touching the storyteller', () => {
    const s = subject({ disputeHoldActive: true });
    expect(ask({ actor: actor('family', FAMILY), action: 'memory.read', subject: s }).reasonCode).toBe('dispute_hold_active');
    expect(ask({ action: 'memory.read', subject: s }).effect).toBe('ALLOW');
    expect(ask({ action: 'source.read', resource: resource({ type: 'source_asset' }), subject: s }).effect).toBe('ALLOW');
  });
});

describe('administrators have no path to memories', () => {
  const admin = { userId: '88888888-8888-4888-8888-888888888888', isPlatformAdmin: true, membership: null };

  it('refuses content reads outright', () => {
    const d = ask({ actor: admin, action: 'memory.read' });
    expect(d.reasonCode).toBe('admin_scope_metadata_only');
  });

  it('refuses archive metadata without a break-glass grant', () => {
    const d = ask({ actor: admin, action: 'admin.archive.metadata.read', resource: resource({ type: 'archive' }) });
    expect(d.reasonCode).toBe('breakglass_required');
  });

  it('allows metadata under a live grant and refuses it once expired', () => {
    const live = ask({
      actor: { ...admin, breakGlass: { archiveId: ARCHIVE, expiresAt: '2026-06-01T13:00:00.000Z', scope: 'metadata_only' } },
      action: 'admin.archive.metadata.read',
      resource: resource({ type: 'archive' }),
    });
    expect(live.effect).toBe('ALLOW');

    const expired = ask({
      actor: { ...admin, breakGlass: { archiveId: ARCHIVE, expiresAt: '2026-06-01T11:00:00.000Z', scope: 'metadata_only' } },
      action: 'admin.archive.metadata.read',
      resource: resource({ type: 'archive' }),
    });
    expect(expired.reasonCode).toBe('breakglass_expired');
  });

  it('refuses a break-glass grant issued for a different archive', () => {
    const d = ask({
      actor: { ...admin, breakGlass: { archiveId: SOURCE, expiresAt: '2026-06-01T13:00:00.000Z', scope: 'metadata_only' } },
      action: 'admin.archive.metadata.read',
      resource: resource({ type: 'archive' }),
    });
    expect(d.reasonCode).toBe('breakglass_required');
  });

  it('refuses admin routes to a non-admin', () => {
    const d = ask({ actor: actor('family', FAMILY), action: 'admin.incident.read', resource: resource({ type: 'incident' }) });
    expect(d.reasonCode).toBe('role_not_permitted');
  });
});

describe('the steward is not the owner', () => {
  const STEWARD = '99999999-9999-4999-8999-999999999999';

  it('may read continuity information', () => {
    expect(ask({ actor: actor('steward', STEWARD), action: 'succession.read', resource: resource({ type: 'succession_directive' }) }).effect).toBe('ALLOW');
  });

  it.each(['memory.read', 'question.ask', 'consent.update', 'export.create', 'archive.delete'] as Action[])(
    'may not %s',
    (action) => {
      const d = ask({ actor: actor('steward', STEWARD), action, resource: resource({ type: 'archive' }) });
      expect(d.effect).toBe('DENY');
    },
  );
});

describe('decision shape', () => {
  it('always carries a policy version, allow or deny', () => {
    const allowDecision = ask({});
    const denyDecision = ask({ actor: { userId: FAMILY, isPlatformAdmin: false, membership: null } });
    expect(allowDecision.policyVersion).toMatch(/^policy-1\//);
    expect(denyDecision.policyVersion).toMatch(/^policy-1\//);
  });

  it('is a pure function of its inputs', () => {
    const args = { action: 'memory.read' as const };
    expect(ask(args)).toEqual(ask(args));
  });

  it('covers every action in the requirement table', () => {
    const actions = Object.keys(ACTION_REQUIREMENTS) as Action[];
    for (const action of actions) {
      const d = ask({ action, resource: resource({ type: 'archive' }) });
      expect(['ALLOW', 'DENY']).toContain(d.effect);
    }
  });
});
