// How a message looks, by author: shared by the student's conversation panel and the
// staff conversation page, so staff read a conversation as the student saw it.

export const bubbleClass = {
  student: 'rounded-tl-2xl rounded-tr-[2px] rounded-br-2xl rounded-bl-2xl bg-self px-[14px] py-[10px] text-on-self shadow-[0px_1px_1px_rgba(0,0,0,0.05)]',
  teacher: 'rounded-tl-[2px] rounded-tr-2xl rounded-br-2xl rounded-bl-2xl border border-brand-200/80 bg-brand-50 px-[15px] py-[11px] text-brand-950',
  deskmate: 'rounded-tl-[2px] rounded-tr-2xl rounded-br-2xl rounded-bl-2xl border border-amber-200/80 bg-amber-50 px-[15px] py-[11px] text-amber-950',
} as const

export const portraitSrc = {
  student: '/portraits/student.png',
  teacher: '/portraits/teacher.png',
  deskmate: '/portraits/deskmate.png',
} as const

export const portraitClass = {
  student: 'border-ink-300 bg-ink-100 shadow-[-2px_2px_0_0_var(--color-ink-400)]',
  teacher: 'border-brand-200 bg-brand-50 shadow-[2px_2px_0_0_var(--color-brand-300)]',
  deskmate: 'border-amber-200 bg-amber-50 shadow-[2px_2px_0_0_var(--color-amber-300)]',
} as const

export const nameClass = {
  student: 'text-on-self',
  teacher: 'text-brand-900',
  deskmate: 'text-amber-950',
} as const

// A system message: a centred pill, not a bubble.
export const eventClass = 'rounded-full bg-ink-100 px-2.5 py-0.5 text-center font-mono text-[10px] leading-[15px] text-ink-500'
