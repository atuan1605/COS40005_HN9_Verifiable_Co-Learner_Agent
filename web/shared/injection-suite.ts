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
