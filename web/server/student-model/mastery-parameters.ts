import type { MasteryParameters } from './estimate'

// The Bayesian Knowledge Tracing parameters are the same for every module and every course,
// so they are written here and not in the estimator or in the course content. The mastery
// threshold belongs to the course: each course spec sets its own.
export const learningParameters: Omit<MasteryParameters, 'threshold'> = {
  prior: 0.1,
  // Learning is set per kind so practice moves mastery more than the quiz: a module has many more
  // questions than exercises, and working code is the better evidence. Guess 0.25 is the chance of
  // guessing one of four choices. Checked against Module 1: one passed exercise takes mastery from
  // 0.1 to 0.433, one correct answer to 0.321.
  byKind: {
    submission: { slip: 0.1, guess: 0.2, learning: 0.15 },
    quiz_answer: { slip: 0.1, guess: 0.25, learning: 0.05 },
  },
}

export function masteryParametersFor(threshold: number): MasteryParameters {
  return { ...learningParameters, threshold }
}
