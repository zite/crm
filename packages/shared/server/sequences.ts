/**
 * Sequence engine contract. The implementation lives in ./sequencesEngine.ts
 * (owned by the outreach area); callers import from here.
 *
 *   exitEnrollments({ contactId, reason })  — stop a contact's active enrollments
 *     (reasons: 'Replied', 'Meeting booked', 'Unsubscribed', 'Deal won', 'Manually', 'Contact deleted')
 *   enrollContacts({ actor, sequenceId, contactIds, ownerId?, dealId? }) → { enrolled, skipped: [{ contactId, reason }] }
 *   runDueSteps({ now }) — the scheduled sender
 */
export { exitEnrollments, enrollContacts, runDueSteps } from './sequencesEngine';
export type { EnrollResult } from './sequencesEngine';
