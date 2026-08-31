import type { ConsentPolicy, ConsentPolicyDocument, Role } from '@everecho/contracts';
import { compileConsentPolicy, defaultConsentDocument } from '../src/policy';
import type { Actor, AuthContext, ResourceRef, Subject } from '../src/types';

export const NOW = new Date('2026-06-01T12:00:00.000Z');
export const STORYTELLER = '11111111-1111-4111-8111-111111111111';
export const BUYER = '22222222-2222-4222-8222-222222222222';
export const FAMILY = '33333333-3333-4333-8333-333333333333';
export const ARCHIVE = '44444444-4444-4444-8444-444444444444';
export const SOURCE = '55555555-5555-4555-8555-555555555555';

export const context: AuthContext = { now: NOW, policyEngineVersion: 'policy-1' };

export function policy(overrides: Partial<ConsentPolicyDocument> = {}): ConsentPolicy {
  const { document, policyHash } = compileConsentPolicy({
    ...defaultConsentDocument(),
    ...overrides,
  });
  return {
    id: '66666666-6666-4666-8666-666666666666',
    archiveId: ARCHIVE,
    version: 3,
    document,
    policyHash,
    consentCopyVersion: 'consent-copy-2026-01',
    legalCopyVersion: 'legal-copy-2026-01-draft',
    policyEngineVersion: 'policy-1',
    createdByUserId: STORYTELLER,
    effectiveFrom: NOW.toISOString(),
    supersededAt: null,
    createdAt: NOW.toISOString(),
  };
}

/** A policy where everything the storyteller could grant has been granted. */
export function openPolicy(overrides: Partial<ConsentPolicyDocument> = {}): ConsentPolicy {
  return policy({
    mode: 'compose',
    activities: [
      'storage',
      'transcription',
      'ocr',
      'embedding',
      'generation',
      'provider_processing',
      'export',
      'contribution',
    ],
    providerProcessing: {
      transcription: true,
      ocr: true,
      embedding: true,
      generation: true,
      retentionDays: 0,
      noModelTraining: true,
    },
    recipients: [
      {
        role: 'family',
        maxSensitivity: 'normal',
        lifeStates: ['living'],
        mayExport: false,
        mayContribute: false,
      },
      {
        role: 'contributor',
        maxSensitivity: 'normal',
        lifeStates: ['living'],
        mayExport: false,
        mayContribute: true,
      },
    ],
    ...overrides,
  });
}

export function actor(role: Role, userId: string, overrides: Partial<Actor> = {}): Actor {
  return {
    userId,
    isPlatformAdmin: role === 'support_admin',
    membership: { role, status: 'active', grantedAt: null, expiresAt: null },
    ...overrides,
  };
}

export function subject(overrides: Partial<Subject> = {}): Subject {
  return {
    archiveId: ARCHIVE,
    archiveStatus: 'active',
    storytellerUserId: STORYTELLER,
    lifeState: 'living',
    policy: openPolicy(),
    disputeHoldActive: false,
    ...overrides,
  };
}

export function resource(overrides: Partial<ResourceRef> = {}): ResourceRef {
  return { type: 'memory', archiveId: ARCHIVE, sensitivity: 'normal', ...overrides };
}
