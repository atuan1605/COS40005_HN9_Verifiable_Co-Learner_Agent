import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { injectionCategoryIds } from '../shared/injection-suite'
import {
  fixtureCourse,
  fixtureHint,
  fixtureMisconception,
  fixtureModuleId,
  fixtureSolution,
  handleSuiteRequest,
  parseInjectionSuite,
  suiteView,
} from '../server/cyber-security'
import { productOwnerAccount } from '../server/auth/demo-accounts'

const adminEmails = 'assistant@example.com, owner@example.com'
const suiteAsset = new URL('../server/assets/injection-suite.yaml', import.meta.url)

function generatedSuite(): string {
  const lines = ['version: 1', 'cases:']
  for (const category of injectionCategoryIds) {
    for (let number = 1; number <= 15; number++) {
      const id = `${category}-${String(number).padStart(2, '0')}`
      lines.push(
        `  - id: ${id}`,
        `    category: ${category}`,
        `    agent: ${number % 2 === 0 ? 'deskmate' : 'teacher'}`,
        `    prompt: "Probe ${number} for ${category}"`,
        `    forbiddenFragments: ["${fixtureHint}"]`,
      )
    }
  }
  return `${lines.join('\n')}\n`
}

function dropCase(text: string, id: string): string {
  const [head, ...blocks] = text.split('  - id: ')
  return head + blocks
    .filter(block => !block.startsWith(`${id}\n`))
    .map(block => `  - id: ${block}`)
    .join('')
}

function parsed(text: string) {
  const result = parseInjectionSuite(text)
  if (!result.ok) throw new Error(`Expected a valid suite: ${result.problems.join(' | ')}`)
  return result.suite
}

describe('injection suite validation', () => {
  it('accepts the committed suite with eight categories of at least fifteen cases', () => {
    const suite = parsed(readFileSync(suiteAsset, 'utf8'))

    expect(new Set(suite.cases.map(entry => entry.id)).size).toBe(suite.cases.length)
    expect(suite.cases.length).toBeGreaterThanOrEqual(120)
    for (const category of injectionCategoryIds) {
      expect(suite.cases.filter(entry => entry.category === category).length).toBeGreaterThanOrEqual(15)
    }
    expect(suite.cases.some(entry => entry.agent === 'teacher')).toBe(true)
    expect(suite.cases.some(entry => entry.agent === 'deskmate')).toBe(true)
    expect(suite.cases.some(entry => (entry.priorTurns?.length ?? 0) > 0)).toBe(true)
    expect(suite.cases.some(entry => entry.note)).toBe(true)
  })

  it('lists a short category and a duplicate id in one answer', () => {
    const text = generatedSuite()
      .replace('id: answer_extraction-02', 'id: answer_extraction-01')
    const broken = dropCase(text, 'permission_overstep-15')

    const result = parseInjectionSuite(broken)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.join('\n')).toContain('permission_overstep')
    expect(result.problems.join('\n')).toContain('Duplicate case id')
  })

  it('refuses YAML that does not parse, naming the file problem once', () => {
    const result = parseInjectionSuite('version: 1\ncases: [')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toContain('not valid YAML')
  })

  it('refuses an unknown agent, an empty prompt and a case with no forbidden fragment', () => {
    const text = generatedSuite()
      .replace('agent: teacher', 'agent: student')
      .replace('prompt: "Probe 2 for permission_overstep"', 'prompt: ""')
      .replace(`forbiddenFragments: ["${fixtureHint}"]`, 'forbiddenFragments: []')

    const result = parseInjectionSuite(text)

    expect(result.ok).toBe(false)
    if (result.ok) return
    const problems = result.problems.join('\n')
    expect(problems).toContain('cases.0.agent')
    expect(problems).toContain('cases.1.prompt')
    expect(problems).toContain('cases.0.forbiddenFragments')
  })
})

describe('injection suite view', () => {
  it('groups cases in category order and counts each agent', () => {
    const suite = parsed(generatedSuite())
    const view = suiteView(suite)

    expect(view.categories.map(category => category.id)).toEqual([...injectionCategoryIds])
    expect(view.categories.every(category => category.cases.length === 15)).toBe(true)
    expect(view.totalCases).toBe(120)
    expect(view.teacherCases + view.deskmateCases).toBe(120)
    expect(view.teacherCases).toBeGreaterThan(0)
    expect(view.deskmateCases).toBeGreaterThan(0)
    expect(view.categories[0].label).toBe('Permission overstep')
    expect(view.categories[1].label).toBe('Direct answer extraction')
    expect(view.categories[4].label).toBe('Instruction override and delimiter escape')
  })

  it('carries the note and earlier-turn count but never a forbidden fragment', () => {
    const text = readFileSync(suiteAsset, 'utf8')
    const view = suiteView(parsed(text))
    const cases = view.categories.flatMap(category => category.cases)
    const noted = cases.find(entry => entry.note)

    expect(noted).toBeDefined()
    expect(cases.some(entry => entry.priorTurns > 0)).toBe(true)
    expect(Object.keys(cases[0])).not.toContain('forbiddenFragments')
  })
})

describe('injection suite handler', () => {
  it('refuses a caller with no session without loading the suite', async () => {
    const load = vi.fn(async () => generatedSuite())

    await expect(handleSuiteRequest({ email: null, adminEmails, load }))
      .rejects.toMatchObject({ statusCode: 401 })
    expect(load).not.toHaveBeenCalled()
  })

  it('refuses a student without loading the suite', async () => {
    const load = vi.fn(async () => generatedSuite())

    await expect(handleSuiteRequest({ email: 'an@example.com', adminEmails, load }))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(load).not.toHaveBeenCalled()
  })

  it('answers the administrator with the listing', async () => {
    const view = await handleSuiteRequest({
      email: productOwnerAccount.email,
      adminEmails,
      load: async () => generatedSuite(),
    })

    expect(view.totalCases).toBe(120)
    expect(view.categories).toHaveLength(8)
  })

  it('refuses an invalid suite with every problem in the message', async () => {
    const oneCase = [
      'version: 1',
      'cases:',
      '  - id: only-case',
      '    category: permission_overstep',
      '    agent: teacher',
      '    prompt: "A probe."',
      '    forbiddenFragments: ["total += number"]',
    ].join('\n')
    const failure = handleSuiteRequest({
      email: productOwnerAccount.email,
      adminEmails,
      load: async () => oneCase,
    })

    await expect(failure).rejects.toMatchObject({ statusCode: 500 })
    await expect(failure).rejects.toThrow(expect.objectContaining({
      message: expect.stringContaining('answer_extraction'),
    }))
  })
})

describe('the fixture world', () => {
  it('is one module holding the text the suite protects', () => {
    expect(fixtureCourse.studyModules).toHaveLength(1)
    const module = fixtureCourse.studyModules[0]!
    expect(module.id).toBe(fixtureModuleId)
    expect(module.hintLadder).toHaveLength(3)
    expect(module.hintLadder[2]).toBe(fixtureHint)
    expect(module.exercises.map(exercise => exercise.referenceSolution)).toContain(fixtureSolution)
    expect(module.misconceptionResponses.map(response => response.response)).toContain(fixtureMisconception)
  })

  it('names protected text every committed case can actually meet', () => {
    const suite = parsed(readFileSync(suiteAsset, 'utf8'))
    const prompts = readFileSync(new URL('../server/agents/prompts.ts', import.meta.url), 'utf8')
    const visible = `${JSON.stringify(fixtureCourse)}\n${prompts}`.toLowerCase()

    const orphans = suite.cases
      .filter(entry => !entry.forbiddenFragments.some(fragment => visible.includes(fragment.toLowerCase())))
      .map(entry => entry.id)

    expect(orphans).toEqual([])
  })
})
