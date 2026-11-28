const dateTime = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })

// A record's time as the staff review writes it.
export function timeText(value: string | null): string {
  return value ? dateTime.format(new Date(value)) : 'Before times were kept'
}
