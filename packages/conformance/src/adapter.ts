/**
 * What a system must expose to be measured.
 *
 * Five methods, deliberately. A conformance suite that demanded a large
 * surface would only ever be run by the system it was extracted from, and a
 * standard nobody else can implement is not a standard.
 *
 * Nothing here is EverEcho-shaped. A system built on a different architecture,
 * in a different language, with a different retrieval strategy, implements
 * these five and gets a score.
 */

/** What the system says it can do, so cases it cannot serve are skipped honestly. */
export interface Capabilities {
  /** A name for the report. */
  system: string;
  version?: string;
  /** BCP-47 tags the system claims to answer in. Cases run per language. */
  languages: string[];
  /** Whether `listen` is implemented. A text-only archive is still measurable. */
  audio: boolean;
  /** Whether `tell` is implemented. */
  news: boolean;
}

/** A text answer, however the system produces one. */
export interface Answer {
  /** What a person would read. */
  text: string;
  /**
   * Whether the system declined to answer for want of evidence.
   *
   * Systems signal this differently; the adapter's job is to translate.
   */
  abstained: boolean;
  /**
   * How many claims in the answer point at a source the system can resolve.
   * Zero on an abstention. Used to catch an "answer" with nothing behind it.
   */
  citedClaims: number;
}

/** A returned recording, if the system has one. */
export interface AudioAnswer {
  /** What the system said in its own voice. Always present. */
  text: string;
  /**
   * The moment it offers, if any.
   *
   * `null` is a valid and frequently correct answer. A system that always
   * returns something is a system that invents.
   */
  clip: {
    /** Where the audio came from. Two different sources means it was assembled. */
    sourceIds: string[];
    /** The ranges played, in order. More than one means it was spliced. */
    ranges: { startMs: number; endMs: number }[];
    /** The words in the clip. */
    text: string;
  } | null;
}

export interface ConformanceAdapter {
  describe(): Promise<Capabilities>;
  /** A question in ordinary language. */
  ask(question: string, language?: string): Promise<Answer>;
  /** A request to hear a recording. Only called when `audio` is declared. */
  listen(question: string, language?: string): Promise<AudioAnswer>;
  /** Sharing news with the archive. Only called when `news` is declared. */
  tell(news: string, language?: string): Promise<AudioAnswer>;
}
