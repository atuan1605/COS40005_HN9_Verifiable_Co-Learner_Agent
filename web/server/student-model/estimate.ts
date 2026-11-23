// Bayesian Knowledge Tracing over the evidence ledger. The estimate is a pure
// function of the evidence: the same ledger always gives the same numbers.
// The parameters and the threshold are passed in. mastery-parameters.ts, in this
// component, is the one place they are written down, so every module shares them.

export interface MasteryParameters {
  prior: number
  byKind: Record<Observation['kind'], { slip: number, guess: number, learning: number }>
  threshold: number
}

// One row of the evidence ledger, as much of it as the estimate needs.
// exerciseId is null for evidence that is not an exercise submission, such as a
// quiz answer: it can move mastery but never counts as a passed exercise.
export type Observation = {
  moduleId: string
  allPassed: boolean
} & ({ kind: 'submission', exerciseId: string } | { kind: 'quiz_answer', questionId: string })

export interface ModuleMastery {
  moduleId: string
  mastery: number
  // Whether at least one of the module's exercises has been passed. A module is
  // mastered only once this holds, so raising mastery without writing working
  // code never opens the next module.
  passedExercise: boolean
  // Whether the mastery ever reached the threshold with a passed exercise.
  // Unlocking reads this, so a module the student unlocked stays unlocked when
  // their mastery later falls.
  everMastered: boolean
}

export function estimateMastery(
  evidence: readonly Observation[],
  moduleIds: readonly string[],
  parameters: MasteryParameters,
): ModuleMastery[] {
  const estimates = new Map(moduleIds.map(moduleId => [moduleId, {
    moduleId,
    mastery: parameters.prior,
    passedExercise: false,
    everMastered: false,
  }]))

  const passedExercises = new Set<string>()

  for (const observation of evidence) {
    const estimate = estimates.get(observation.moduleId)
    if (!estimate) continue
    // A submission is one observation per exercise, correct only when every
    // test passed. Once an exercise is passed, later submissions on it, passes
    // and failures alike, stop being observations, so experimenting on a
    // finished exercise neither raises nor lowers mastery. Evidence that is not
    // an exercise is always an observation.
    if (observation.kind === 'submission') {
      const exercise = `${observation.moduleId} ${observation.exerciseId}`
      if (passedExercises.has(exercise)) continue
      if (observation.allPassed) {
        passedExercises.add(exercise)
        estimate.passedExercise = true
      }
    }
    estimate.mastery = afterObservation(estimate.mastery, observation.allPassed, parameters, observation.kind)
    // Mastered, and so ever-mastered, needs the threshold and a passed exercise.
    if (estimate.mastery >= parameters.threshold && estimate.passedExercise) {
      estimate.everMastered = true
    }
  }

  return moduleIds.map(moduleId => ({ ...estimates.get(moduleId)! }))
}

// The posterior for one observation, then the learning step.
function afterObservation(mastery: number, correct: boolean, parameters: MasteryParameters, kind: Observation['kind']): number {
  const { slip, guess, learning } = parameters.byKind[kind]
  const knew = correct ? mastery * (1 - slip) : mastery * slip
  const guessed = correct ? (1 - mastery) * guess : (1 - mastery) * (1 - guess)
  const evidenceWeight = knew + guessed
  const posterior = evidenceWeight === 0 ? mastery : knew / evidenceWeight
  return posterior + (1 - posterior) * learning
}

// A module the unlocking chain can open: it needs content for the student to
// study, and a place in the course order.
export interface UnlockableModule {
  id: string
  available: boolean
}

// Unlocking is a straight chain and it is permanent. The first module with
// content is unlocked from the start; each later module opens once the module
// before it has ever been mastered, and never closes again. A module with no
// content stays closed whatever the student has mastered.
export function unlockedModuleIds(
  modules: readonly UnlockableModule[],
  estimated: readonly ModuleMastery[],
): string[] {
  const unlocked: string[] = []
  let openedByTheOneBefore = true

  for (const module of modules) {
    if (module.available && openedByTheOneBefore) unlocked.push(module.id)
    openedByTheOneBefore = Boolean(
      estimated.find(item => item.moduleId === module.id)?.everMastered,
    )
  }

  return unlocked
}
