import { useEffect } from 'react';

/** Every page sets one. The organization name is the suffix. */
export function useDocumentTitle(title: string | null | undefined, org = 'CRM') {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ${org}`;
    return () => {
      document.title = previous;
    };
  }, [title, org]);
}
