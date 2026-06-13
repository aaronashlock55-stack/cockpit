import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import {
  clonePracticeEnvironment,
  defaultPracticeEnvironment,
  trainingCourseEnvironment,
} from '@/types/practice-environment'

describe('clonePracticeEnvironment', () => {
  it('clones a plain environment into a detached copy', () => {
    const copy = clonePracticeEnvironment(trainingCourseEnvironment)
    expect(copy).toEqual(trainingCourseEnvironment)
    expect(copy).not.toBe(trainingCourseEnvironment)
    copy.obstacles[0].position[0] = 999
    expect(trainingCourseEnvironment.obstacles[0].position[0]).not.toBe(999) // deep copy
  })

  it('clones a Vue REACTIVE environment without throwing (regression: structuredClone DataCloneError)', () => {
    // activePracticeEnvironment.value is always a reactive proxy; structuredClone
    // throws DataCloneError on it, which silently broke Practice mode start-up.
    const reactiveEnv = ref(clonePracticeEnvironment(defaultPracticeEnvironment))
    expect(() => structuredClone(reactiveEnv.value)).toThrow() // documents WHY the helper exists
    const copy = clonePracticeEnvironment(reactiveEnv.value)
    expect(copy.name).toBe(defaultPracticeEnvironment.name)
    expect(copy.obstacles.length).toBe(defaultPracticeEnvironment.obstacles.length)
  })
})
