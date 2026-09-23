import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge has to know the CRM's own type scale, or it reads `text-ui`
 * as a colour and silently drops it when `text-ink-2` follows.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'meta', 'ui', 'body', 'title', 'display-sm', 'display', 'display-lg'] }],
      shadow: [{ shadow: ['hairline', 'raised', 'pop', 'sheet', 'drag', 'key'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
