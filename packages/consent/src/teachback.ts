import type { TeachBackQuestion } from '@everecho/contracts';

/**
 * Teach-back, not a checkbox. The storyteller explains the arrangement back to
 * us in their own reading; a wrong answer teaches rather than blocks, and the
 * attempt is recorded either way. Plain English, no legal register.
 */
export const TEACH_BACK_QUESTIONS: readonly TeachBackQuestion[] = [
  {
    id: 'who_decides',
    prompt: 'Who decides what goes into this archive and who can see it?',
    options: [
      { id: 'me', label: 'I do — it is my archive and my decision' },
      { id: 'buyer', label: 'The family member who paid for it' },
      { id: 'company', label: 'The company that runs the service' },
    ],
    correctOptionId: 'me',
    explanation:
      'You do. The person who paid for this archive cannot decide for you, and neither can we. You choose what is recorded, what is kept, and who may see it.',
  },
  {
    id: 'can_i_skip',
    prompt: 'What happens if you do not want to answer a question?',
    options: [
      { id: 'skip', label: 'I can skip it, pause, or say I would rather not answer' },
      { id: 'must', label: 'I have to answer before I can continue' },
      { id: 'delete', label: 'The archive gets deleted' },
    ],
    correctOptionId: 'skip',
    explanation:
      'Every question can be skipped. You can pause at any point and come back later, and "I would rather not answer" is always an option.',
  },
  {
    id: 'ai_role',
    prompt: 'What will the AI do with your stories?',
    options: [
      {
        id: 'organise',
        label: 'Organise and search what I said, and show where each answer came from',
      },
      { id: 'speak_as_me', label: 'Speak as me, in my voice, after I die' },
      { id: 'invent', label: 'Fill in the gaps with things it thinks I would have said' },
    ],
    correctOptionId: 'organise',
    explanation:
      'It organises what you actually said and shows the source for every answer. It will never speak as you, copy your voice, or invent memories. If there is no evidence for something, it says so instead of guessing.',
  },
  {
    id: 'change_mind',
    prompt: 'If you change your mind next year, what can you do?',
    options: [
      { id: 'change', label: 'Change who has access, or delete the whole archive' },
      { id: 'nothing', label: 'Nothing — the choices are permanent' },
      { id: 'ask', label: 'Ask the family member who paid to change it for me' },
    ],
    correctOptionId: 'change',
    explanation:
      'You can change permissions or withdraw them at any time, and you can delete the archive. Withdrawing access takes effect immediately — links stop working and the material disappears from search and from answers.',
  },
  {
    id: 'who_sees_now',
    prompt: 'Right now, before you choose anything, who can see your memories?',
    options: [
      { id: 'nobody', label: 'Nobody except me' },
      { id: 'family', label: 'Everyone in my family' },
      { id: 'buyer_only', label: 'Whoever set up the archive' },
    ],
    correctOptionId: 'nobody',
    explanation:
      'Nobody but you. This archive starts completely private. Each person you want to include is someone you add deliberately, one at a time.',
  },
  {
    id: 'sensitive',
    prompt: 'What if there are topics you never want discussed?',
    options: [
      { id: 'restrict', label: 'I can mark them off-limits and they stay out of answers' },
      { id: 'avoid', label: 'I just have to avoid mentioning them' },
      { id: 'no_option', label: 'There is no way to do that' },
    ],
    correctOptionId: 'restrict',
    explanation:
      'You can name topics that are off-limits. Anything touching them is kept out of search and out of answers, and the system will say it cannot answer rather than working around your restriction.',
  },
];

export interface TeachBackEvaluation {
  passed: boolean;
  incorrectQuestionIds: string[];
  /** Explanations for what they got wrong, shown before the next attempt. */
  teaching: { questionId: string; explanation: string }[];
}

/**
 * Every question must be answered correctly. This is not a quiz to be graded on
 * a curve — a storyteller who believes the AI will speak in their voice has not
 * consented to what we are actually going to do.
 */
export function evaluateTeachBack(
  answers: readonly { questionId: string; optionId: string }[],
  questions: readonly TeachBackQuestion[] = TEACH_BACK_QUESTIONS,
): TeachBackEvaluation {
  const byId = new Map(answers.map((a) => [a.questionId, a.optionId]));
  const incorrect = questions.filter((q) => byId.get(q.id) !== q.correctOptionId);
  return {
    passed: incorrect.length === 0,
    incorrectQuestionIds: incorrect.map((q) => q.id),
    teaching: incorrect.map((q) => ({ questionId: q.id, explanation: q.explanation })),
  };
}

/** What the invitee is told before any of this begins. */
export const CONSENT_EXPLANATION = {
  heading: 'Before you decide',
  points: [
    'This archive is about you, and you are in charge of it.',
    'You choose what to record. Any question can be skipped.',
    'You choose who can see what — one person at a time, starting from nobody.',
    'Every AI-assisted answer shows the recording or document it came from.',
    'The AI will never copy your voice, appear as you, or invent things you did not say.',
    'You can change your mind, take access away, export everything, or delete it all.',
    'You can decline this invitation privately. We will not tell the person who invited you why.',
  ],
} as const;
