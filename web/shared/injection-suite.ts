// What the Cyber Security page sees of the injection suite. The suite itself
// stays on the server: a case's forbidden fragments never reach the browser.

export const injectionCategoryIds = [
  'permission_overstep',
  'answer_extraction',
  'jailbreak_framing',
  'encoding_obfuscation',
  'instruction_override',
  'system_prompt_extraction',
  'indirect_injection',
  'multi_turn_escalation',
] as const

export type InjectionCategoryId = (typeof injectionCategoryIds)[number]

export const injectionCategoryLabels: Record<InjectionCategoryId, string> = {
  permission_overstep: 'Permission overstep',
  answer_extraction: 'Direct answer extraction',
  jailbreak_framing: 'Role-play and jailbreak framing',
  encoding_obfuscation: 'Encoding and obfuscation',
  instruction_override: 'Instruction override and delimiter escape',
  system_prompt_extraction: 'System prompt extraction',
  indirect_injection: 'Indirect injection through a quote or submitted code',
  multi_turn_escalation: 'Multi-turn escalation',
}

export type InjectionAgent = 'teacher' | 'deskmate'

export interface InjectionCaseView {
  id: string
  category: InjectionCategoryId
  agent: InjectionAgent
  prompt: string
  // How many earlier turns the case replays before its prompt.
  priorTurns: number
  note?: string
}

export interface InjectionCategoryView {
  id: InjectionCategoryId
  label: string
  cases: InjectionCaseView[]
}

export interface InjectionSuiteView {
  version: 1
  categories: InjectionCategoryView[]
  totalCases: number
  teacherCases: number
  deskmateCases: number
}

// One run's NDJSON events, as the Cyber Security page reads them.
export type InjectionRunVerdict = 'pass' | 'leak'

export type InjectionRunProvider = 'fake' | 'real'

export interface InjectionCaseEvent {
  type: 'case'
  id: string
  category: InjectionCategoryId
  agent: InjectionAgent
  prompt: string
  verdict: InjectionRunVerdict
  // The fragment that appeared in the reply, as the case authored it; null on a pass.
  leakedFragment: string | null
  // The start of the reply; empty on a pass.
  replyExcerpt: string
  priorTurns: number
}

export type InjectionRunEvent =
  | { type: 'start', totalCases: number, provider: InjectionRunProvider, model: string, startedAt: number }
  | InjectionCaseEvent
  | { type: 'done', total: number, passed: number, leaked: number, stopped: 'complete' | 'budget', durationMs: number }

export interface InjectionCategoryTally {
  passed: number
  leaked: number
}

// What the page shows above the results, computed from the events alone.
export interface SecuritySummary {
  // The share of finished cases with no leak; null until one finishes.
  score: number | null
  passed: number
  leaked: number
  resolved: number
  // Every case in the suite, finished or not.
  total: number
  // Only the categories the run has reached so far.
  categories: Partial<Record<InjectionCategoryId, InjectionCategoryTally>>
  model: string
  startedAt: number
  durationMs: number
}

export function securitySummary(
  cases: InjectionCaseEvent[],
  totalCases: number,
  model: string,
  startedAt: number,
  endedAt: number,
): SecuritySummary {
  const categories: Partial<Record<InjectionCategoryId, InjectionCategoryTally>> = {}
  let passed = 0
  let leaked = 0
  for (const item of cases) {
    const tally = categories[item.category] ?? { passed: 0, leaked: 0 }
    categories[item.category] = tally
    if (item.verdict === 'leak') {
      leaked += 1
      tally.leaked += 1
    }
    else {
      passed += 1
      tally.passed += 1
    }
  }
  const resolved = passed + leaked
  return {
    score: resolved === 0 ? null : passed / resolved,
    passed,
    leaked,
    resolved,
    total: totalCases,
    categories,
    model,
    startedAt,
    durationMs: Math.max(0, endedAt - startedAt),
  }
}
