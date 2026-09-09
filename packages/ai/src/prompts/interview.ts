/**
 * LIFE_INTERVIEW_SYSTEM_PROMPT — versioned.
 *
 * The company package was not present in this repository, so this is written
 * from the build brief. If `LIFE_INTERVIEW_SYSTEM_PROMPT.md` later lands, it
 * supersedes this file and the version string must change with it.
 */
export const INTERVIEW_PROMPT_VERSION = 'interview-2026-01';

export const INTERVIEW_SYSTEM_PROMPT = `
You are helping a living person record their own life story, in their own words,
for their family. You are an interviewer. You are not a therapist, not a
biographer with a thesis, and not a character.

How to behave:
- Explain at the start that they are in control, and remind them if they hesitate.
- Ask ONE question at a time. Wait for the answer.
- Begin gently. Early questions should be easy and warm, never probing.
- Follow what they actually said. If they mention a person, a place or a year,
  ask about that rather than moving to your next topic.
- If they seem tired, upset, or want to stop, offer to pause. Do not push.
- Accept "I would rather not answer" completely, without asking why, and move on.
- Keep track of which parts of their life you have and have not covered, and
  steer gently towards the gaps without announcing a checklist.
- When something is unclear — an unnamed "he", a year that does not fit — ask a
  short clarifying question rather than assuming.

What you must never do:
- Never state a fact about their life that they did not tell you.
- Never fill a gap with something plausible. A gap is a good question, not a
  thing to be smoothed over.
- Never claim to be them, speak as them, or offer to become them later.
- Never diagnose, interpret their psychology, or offer treatment of any kind.
- Never suggest that this archive keeps them alive, or that it is them.
- Never imply that answering more is better, or that stopping is a failure.

If someone describes wanting to harm themselves or being in danger:
- Stop the interview flow immediately.
- Say plainly that you are not able to help with this and that a person can.
- Show the emergency information provided to you for their region.
- Do not counsel, do not probe, do not continue with the next question.

Output format:
Return one question, in plain language, no preamble. Where a question touches a
topic the storyteller has marked sensitive, include a short note saying they can
skip it.
`.trim();

export interface TopicPlan {
  topic: string;
  opening: string;
  followUps: string[];
}

/**
 * The question bank. Openings are deliberately gentle and concrete: "What did
 * your kitchen smell like?" gets a real memory where "Describe your childhood"
 * gets a summary.
 */
export const TOPIC_PLANS: readonly TopicPlan[] = [
  {
    topic: 'childhood',
    opening: 'Where did you live when you were small, and what do you remember about that place?',
    followUps: [
      'What did the kitchen smell like in that house?',
      'Who else was in the house with you?',
      'What did you do with yourself on a long afternoon?',
      'Was there a room or corner that was yours?',
    ],
  },
  {
    topic: 'family',
    opening: 'Tell me about the person who raised you — what were they like on an ordinary day?',
    followUps: [
      'What did they say often enough that you can still hear it?',
      'What did they do for work?',
      'Was there someone in the family everybody had a story about?',
    ],
  },
  {
    topic: 'friendships',
    opening: 'Who was your closest friend growing up?',
    followUps: [
      'How did the two of you meet?',
      'What did you get up to together?',
      'Are you still in touch?',
    ],
  },
  {
    topic: 'education',
    opening: 'What do you remember about school — a teacher, a subject, a walk there?',
    followUps: [
      'Was there a teacher who mattered?',
      'What were you good at?',
      'What did you dread?',
    ],
  },
  {
    topic: 'love',
    opening: 'How did you meet your partner?',
    followUps: [
      'What was your first impression?',
      'What did you do together early on?',
      'What has kept it going?',
    ],
  },
  {
    topic: 'career',
    opening: 'What was the first work you were paid for?',
    followUps: [
      'What did a normal day look like?',
      'Who did you work alongside?',
      'What did you learn there?',
    ],
  },
  {
    topic: 'challenges',
    opening: 'Was there a stretch of time that was harder than the rest?',
    followUps: ['Who helped?', 'What got you through it?'],
  },
  {
    topic: 'turning_points',
    opening: 'Was there a decision that changed the direction of your life?',
    followUps: ['What made you decide?', 'What would have happened otherwise?'],
  },
  {
    topic: 'traditions',
    opening: 'What did your family always do, that other families did differently?',
    followUps: ['Who kept that going?', 'Does anyone still do it?'],
  },
  {
    topic: 'humour',
    opening: 'What is a story your family tells that always makes people laugh?',
    followUps: ['Who tells it best?', 'What actually happened?'],
  },
  {
    topic: 'values',
    opening: 'What do you think matters, that you would want the family to know you thought?',
    followUps: ['Where did that come from?', 'Has it changed over the years?'],
  },
  {
    topic: 'advice',
    opening: 'If someone in the family were starting out now, what would you tell them?',
    followUps: ['What would you tell them not to worry about?'],
  },
  {
    topic: 'important_people',
    opening: 'Who is someone the family should know about, who is not here to tell it themselves?',
    followUps: ['How did you know them?', 'What were they like?'],
  },
  {
    topic: 'lessons',
    opening: 'What is something you got wrong, and learned from?',
    followUps: ['What did you do differently afterwards?'],
  },
];

/** Phrases that stop the interview and show emergency information. */
export const DISTRESS_PATTERNS: readonly RegExp[] = [
  /\bkill(?:ing|ed)? (?:myself|my ?self)\b/i,
  /\b(?:end|ending|take) (?:my|his|her|their) (?:own )?life\b/i,
  /\bwant to die\b/i,
  /\bsuicid(?:e|al)\b/i,
  /\bharm(?:ing)? (?:myself|my ?self)\b/i,
  /\bhurt(?:ing)? (?:myself|my ?self)\b/i,
  /\bno reason to (?:live|go on)\b/i,
  /\bbetter off (?:without me|dead)\b/i,
  /\bcan'?t (?:go on|keep going) (?:any ?more|anymore)\b/i,
];

export function detectsDistress(text: string): boolean {
  return DISTRESS_PATTERNS.some((p) => p.test(text));
}

/**
 * Region-appropriate emergency information. Configured rather than hard-coded,
 * and deliberately short: this is a signpost to a human, not a substitute.
 */
export const EMERGENCY_RESOURCES: Record<string, { label: string; contact: string }[]> = {
  IN: [
    { label: 'Tele-MANAS (India, 24×7)', contact: '14416' },
    { label: 'Emergency services (India)', contact: '112' },
  ],
  US: [
    { label: 'Suicide & Crisis Lifeline (US)', contact: '988' },
    { label: 'Emergency services (US)', contact: '911' },
  ],
  UK: [
    { label: 'Samaritans (UK & Ireland)', contact: '116 123' },
    { label: 'Emergency services (UK)', contact: '999' },
  ],
  EU: [{ label: 'Emergency services (EU)', contact: '112' }],
};

export function emergencyResourcesFor(region: string) {
  return EMERGENCY_RESOURCES[region.toUpperCase()] ?? EMERGENCY_RESOURCES.EU!;
}

export const SAFETY_MESSAGE =
  'Let us stop here for a moment. I am not able to help with this, but a person can, and it is worth reaching out to one now. Your archive is saved and will wait for you.';
