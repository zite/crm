/** Turn any thrown thing into a sentence for a toast, falling back to our own words. */
export function errorMessage(error: unknown, fallback: string) {
  const message = (error as { message?: string })?.message;
  if (!message) return fallback;
  // The generated caller wraps an endpoint's reply: `API call failed (409): {"message":…}`.
  // Without unwrapping it, a toast shows the raw JSON instead of the sentence we wrote.
  const wrapped = message.match(/^API call failed \(\d{3}\):\s*([\s\S]*)$/);
  if (wrapped) {
    try {
      const parsed = JSON.parse(wrapped[1].trim()) as { message?: string };
      // Endpoint messages are written for people, including ones that open with a
      // count ("1 deal is in Security review…"), so they pass through as they are.
      if (parsed?.message && parsed.message.length < 400) return parsed.message;
    } catch {
      /* not JSON — the gateway's own words aren't meant for a person */
    }
    return fallback;
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'You appear to be offline — nothing was saved';
  if (/unauthorized|401/i.test(message)) return 'Your session expired. Reload the page and try again';
  // Endpoint errors are already written for people.
  return /^[A-Z]/.test(message) && message.length < 220 ? message : fallback;
}
