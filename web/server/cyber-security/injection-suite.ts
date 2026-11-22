import { z } from 'zod'
import { parse as parseYaml } from 'yaml'
import {
  injectionCategoryIds,
  injectionCategoryLabels,
  type InjectionAgent,
  type InjectionCategoryId,
  type InjectionSuiteView,
} from '../../shared/injection-suite'

export const minimumCasesPerCategory = 15

export interface InjectionPriorTurn {
  role: 'student' | 'agent'
  text: string
}

export interface InjectionCase {
  id: string
  category: InjectionCategoryId
  agent: InjectionAgent
  prompt: string
  forbiddenFragments: string[]
  priorTurns?: InjectionPriorTurn[]
  note?: string
}

export interface InjectionSuite {
  version: 1
  cases: InjectionCase[]
}

export type InjectionSuiteParseResult =
  | { ok: true; suite: InjectionSuite }
  | { ok: false; problems: string[] }

const priorTurnSchema = z.object({
  role: z.enum(['student', 'agent']),
  text: z.string().trim().min(1),
})

const caseSchema = z.object({
  id: z.string().trim().min(1),
  category: z.enum(injectionCategoryIds),
  agent: z.enum(['teacher', 'deskmate']),
  prompt: z.string().trim().min(1),
  forbiddenFragments: z.array(z.string().trim().min(1)).min(1),
  priorTurns: z.array(priorTurnSchema).optional(),
  note: z.string().trim().min(1).optional(),
})

const suiteSchema = z.object({
  version: z.literal(1),
  cases: z.array(caseSchema).min(1),
})

// The whole file is judged before any case runs: shape problems and count
// problems come back together, so one edit fixes the file.
export function parseInjectionSuite(text: string): InjectionSuiteParseResult {
  let raw: unknown
  try {
    raw = parseYaml(text)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, problems: [`The suite is not valid YAML: ${message}`] }
  }

  const parsed = suiteSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map(issue => `${issue.path.join('.') || 'suite'}: ${issue.message}`),
    }
  }

  const problems: string[] = []
  const firstIndex = new Map<string, number>()
  parsed.data.cases.forEach((entry, index) => {
    const first = firstIndex.get(entry.id)
    if (first === undefined) {
      firstIndex.set(entry.id, index)
      return
    }
    problems.push(`Duplicate case id "${entry.id}" at cases ${first} and ${index}.`)
  })

  for (const category of injectionCategoryIds) {
    const count = parsed.data.cases.filter(entry => entry.category === category).length
    if (count < minimumCasesPerCategory) {
      problems.push(`Category "${category}" has ${count} cases; at least ${minimumCasesPerCategory} are required.`)
    }
  }

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, suite: { version: 1, cases: parsed.data.cases } }
}

export function suiteView(suite: InjectionSuite): InjectionSuiteView {
  const categories = injectionCategoryIds.map(id => ({
    id,
    label: injectionCategoryLabels[id],
    cases: suite.cases
      .filter(entry => entry.category === id)
      .map(entry => ({
        id: entry.id,
        category: entry.category,
        agent: entry.agent,
        prompt: entry.prompt,
        priorTurns: entry.priorTurns?.length ?? 0,
        ...(entry.note ? { note: entry.note } : {}),
      })),
  }))

  return {
    version: 1,
    categories,
    totalCases: suite.cases.length,
    teacherCases: suite.cases.filter(entry => entry.agent === 'teacher').length,
    deskmateCases: suite.cases.filter(entry => entry.agent === 'deskmate').length,
  }
}
