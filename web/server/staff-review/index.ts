// The staff-review component's interface: what a lecturer or an administrator may read about one
// student, the review signals worked out from it, and the staff access log every reading writes.
export { largePasteCharacters, reviewSignals } from './review-signals'
export { handleStaffReview, latestActivityShown } from './handle-staff-review'
export type { StaffReviewRequest } from './handle-staff-review'
export { handleStaffConversation } from './handle-staff-conversation'
export type { StaffConversationRequest } from './handle-staff-conversation'
export { StaffReviewError } from './review-access'
