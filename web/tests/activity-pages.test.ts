import { describe, expect, it } from 'vitest'
import { activityPage, pageOfEvent } from '../app/review/activity-pages'

// Newest first, as the review hands the activity over.
const events = (count: number) => Array.from({ length: count }, (_, index) => ({ id: count - index }))
const ids = (rows: readonly { id: number }[]) => rows.map(row => row.id)

describe('a page of the review\'s latest activity', () => {
  it('holds 20 rows, in the order given, and says how many pages there are', () => {
    const first = activityPage(events(45), 1)
    expect(first.pageCount).toBe(3)
    expect(ids(first.rows)).toEqual([45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26])
    expect(ids(activityPage(events(45), 3).rows)).toEqual([5, 4, 3, 2, 1])
  })
})

describe('the page that holds an event', () => {
  it('goes by the event\'s place in the list, not by its id', () => {
    // 20 recent events, then two older ones a signal links to.
    const listed = [...events(20).map(event => ({ id: event.id + 100 })), { id: 12 }, { id: 3 }]
    expect(pageOfEvent(listed, 120)).toBe(1)
    expect(pageOfEvent(listed, 101)).toBe(1)
    expect(pageOfEvent(listed, 12)).toBe(2)
    expect(pageOfEvent(listed, 3)).toBe(2)
  })

  it('is no page for an event the list does not hold', () => {
    expect(pageOfEvent(events(5), 99)).toBeNull()
  })
})
