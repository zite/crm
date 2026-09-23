/** The hash route a run log entry links back to, for the entity kinds a trigger can carry. */
export function entityPathFor(entityType: string | null | undefined, entityId: string | null | undefined) {
  if (!entityId) return null;
  switch (entityType) {
    case 'deal':
      return `/deals/${entityId}`;
    case 'lead':
      return `/leads/${entityId}`;
    case 'contact':
      return `/contacts/${entityId}`;
    case 'company':
      return `/companies/${entityId}`;
    case 'quote':
      return `/quotes/${entityId}`;
    default:
      // Tasks, activities and form submissions have no page of their own.
      return null;
  }
}
