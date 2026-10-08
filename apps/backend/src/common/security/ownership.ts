import type { AuthenticatedUser } from '../../auth/auth.service.js';

/**
 * Ownership scope for owned resources. Domain services MUST put it in the query itself
 * (`findFirst({ where: { id, ...ownedBy(user) } })`, `updateMany`, `deleteMany`) instead of
 * loading by id and checking afterwards, and answer ResourceNotFoundException when nothing
 * matches. A foreign id is then indistinguishable from a missing one (no IDOR, no
 * existence leak).
 *
 * ADMIN has no implicit bypass: admin features use explicit /admin routes and policies.
 * The database triggers (PASSO 03) are a second line of defense, not a substitute.
 */
export function ownedBy(user: Pick<AuthenticatedUser, 'id'>): { ownerId: string } {
  return { ownerId: user.id };
}
