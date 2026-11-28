// Paging of the staff review's Latest activity table. The review already holds
// every event it lists, so the page splits them itself. A page is found by an
// event's place in the list, never by arithmetic on ids: older events a signal
// links to are listed too, so the ids have gaps.

const rowsPerPage = 20

export function activityPage<T>(events: readonly T[], page: number) {
  return {
    pageCount: Math.max(1, Math.ceil(events.length / rowsPerPage)),
    rows: events.slice((page - 1) * rowsPerPage, page * rowsPerPage),
  }
}

// The page, counted from 1, that holds the event; null when it is not listed.
export function pageOfEvent(events: readonly { id: number }[], id: number): number | null {
  const index = events.findIndex(event => event.id === id)
  return index < 0 ? null : Math.floor(index / rowsPerPage) + 1
}
