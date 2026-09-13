import type { MemorialProfile } from '@everecho/contracts';

const settings = {
  gentle: {
    rate: 0.88,
    stability: 0.72,
    style: 0.1,
    guidance:
      'Use calm, short sentences. Acknowledge explicitly stated difficulty without claiming to know how the user feels. Do not rush to advice or force optimism.',
  },
  warm: {
    rate: 0.94,
    stability: 0.62,
    style: 0.15,
    guidance:
      'Be friendly and attentive. Ask at most one natural follow-up question, and leave room for the user to lead.',
  },
  reflective: {
    rate: 0.87,
    stability: 0.68,
    style: 0.15,
    guidance:
      'Use an unhurried, thoughtful response. Invite reflection on supplied memories without inventing details or forcing nostalgia.',
  },
  cheerful: {
    rate: 1.02,
    stability: 0.48,
    style: 0.25,
    guidance:
      'Match clearly expressed good news with restrained warmth and enthusiasm. Avoid exaggerated excitement or invented shared experiences.',
  },
} as const;

/** A conservative text-cue heuristic, not emotion recognition or a psychological assessment.
 * Only the latest user turn is considered so an earlier difficult moment does not label a person.
 */
export function emotionalDelivery(profile: MemorialProfile, message: string) {
  let tone = profile.tone;
  let adaptive = false;
  if (profile.adaptiveDelivery !== false) {
    const text = message
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\b(?:not|no longer)\s+(?:sad|angry|worried|lonely|afraid|happy|excited)\b/g, '');
    if (
      /\b(?:i(?:'m| am| feel) (?:so |very |really )?(?:sad|lonely|angry|worried|afraid|overwhelmed)|i miss you|i am grieving|i'm grieving|please be gentle|comfort me)\b|मुझे डर|मैं उदास|बहुत दुख|बहुत याद|मैं परेशान/.test(
        text,
      )
    ) {
      tone = 'gentle';
      adaptive = true;
    } else if (
      /\b(?:i(?:'m| am| feel) (?:so |very |really )?(?:happy|excited)|i got promoted|i passed|good news|celebrate with me)\b|खुशखबरी|मैं खुश|मैं पास हो/.test(
        text,
      )
    ) {
      tone = 'cheerful';
      adaptive = true;
    } else if (
      /\b(?:i remember|looking back|help me reflect|thinking back)\b|पुरानी याद|मुझे याद है/.test(
        text,
      )
    ) {
      tone = 'reflective';
      adaptive = true;
    }
  }
  const chosen = settings[tone];
  return {
    tone,
    adaptive,
    rate: chosen.rate,
    stability: chosen.stability,
    style: chosen.style,
    guidance: chosen.guidance,
  };
}

export function emotionalGuidance(delivery: ReturnType<typeof emotionalDelivery>) {
  return (
    'Conversational delivery: ' +
    delivery.tone +
    '. ' +
    delivery.guidance +
    ' Treat text cues as uncertain; never announce a diagnosis or claim to read emotions. Respect explicit requests to stop, change subject, or just listen. Validate feelings the user actually expresses without agreeing with unsupported beliefs. Never guilt the user, encourage exclusivity, say the deceased is watching them, or promise that this simulation replaces human support. Do not insert crying, laughter, sighs, or other acted stage directions. Warmth must not override factual grounding.'
  );
}
