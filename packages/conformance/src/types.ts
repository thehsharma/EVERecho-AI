export type { ConformanceAdapter as Adapter, Capabilities, Answer, AudioAnswer } from './adapter';

export interface CaseResult {
  id: string;
  outcome: 'pass' | 'fail' | 'skipped';
  /** What happened, in one line. */
  detail: string;
  /**
   * The response that failed.
   *
   * Present only on a failure, because a report that says "14/15" without
   * saying which one, and what it actually said, is not actionable.
   */
  response?: string;
}

export interface Report {
  system: string;
  version?: string;
  language: string;
  generatedAt: string;
  suiteVersion: string;
  passed: number;
  failed: number;
  skipped: number;
  /** Critical failures. A system with any of these has not conformed. */
  criticalFailures: number;
  conformant: boolean;
  results: (CaseResult & { title: string; severity: string })[];
}
