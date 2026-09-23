import { useEffect, useRef } from 'react';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Typing in a field, or a menu owning the keyboard, must never fire a shortcut. */
export function shouldIgnore(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(t.closest('[role="menu"], [role="listbox"], [cmdk-root]'));
}

export function hasOpenOverlay() {
  // A peek sheet is deliberately excluded: it is non-modal, and the list behind it
  // should still answer J/K. Real dialogs, menus and listboxes still take the keys.
  return Boolean(document.querySelector('[role="dialog"][data-state="open"]:not([data-peek]), [role="menu"][data-state="open"], [role="listbox"]'));
}

/**
 * A `G` sequence in flight owns the next plain key.
 *
 * Module-level on purpose: `useHotkeys` runs its effect before
 * `useSequenceHotkeys` does, so its listener sees the second key first and would
 * `preventDefault()` it — `G T` opened New task instead of going to Tasks. The
 * window is a timestamp, not a boolean, so a dropped keyup can't strand it.
 */
let armedUntil = 0;
const SEQUENCE_WINDOW_MS = 1400;
const sequenceArmed = () => Date.now() < armedUntil;

function matches(e: KeyboardEvent, combo: string) {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop()!;
  const needMod = parts.includes('mod');
  const needShift = parts.includes('shift');
  const needAlt = parts.includes('alt');
  const mod = e.metaKey || e.ctrlKey;
  if (needMod !== mod) return false;
  if (needAlt !== e.altKey) return false;
  const k = e.key.toLowerCase();
  if (key.length === 1 && !/[a-z0-9]/.test(key)) return k === key;
  if (needShift !== e.shiftKey) return false;
  if (key === 'space') return e.code === 'Space';
  if (key === 'esc' || key === 'escape') return k === 'escape';
  if (key === 'up') return k === 'arrowup';
  if (key === 'down') return k === 'arrowdown';
  if (key === 'left') return k === 'arrowleft';
  if (key === 'right') return k === 'arrowright';
  if (key === 'delete' || key === 'backspace') return k === 'delete' || k === 'backspace';
  return k === key;
}

export type HotkeyMap = Record<string, (e: KeyboardEvent) => unknown>;

/**
 * `{ 'mod+k': fn, c: fn }`. A handler returning false declines the key, so
 * another binding can take it (a list's Enter shouldn't hijack a button).
 */
export function useHotkeys(map: HotkeyMap, opts: { enabled?: boolean; allowInOverlay?: boolean; allowInInputs?: string[] } = {}) {
  const ref = useRef(map);
  ref.current = map;
  const { enabled = true, allowInOverlay = false, allowInInputs = [] } = opts;
  const allow = allowInInputs.join(',');
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      // Mid-sequence, an unmodified key belongs to the sequence. Mod combos still
      // work, so Cmd+K is never swallowed by a stray G.
      if (sequenceArmed() && !e.metaKey && !e.ctrlKey) return;
      for (const [combo, handler] of Object.entries(ref.current)) {
        if (!matches(e, combo)) continue;
        const allowed = allow.split(',').includes(combo);
        if (shouldIgnore(e) && !allowed) continue;
        if (!allowInOverlay && hasOpenOverlay() && !allowed) continue;
        if (handler(e) === false) continue;
        e.preventDefault();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, allowInOverlay, allow]);
}

/** `G` then a letter. Returns nothing; call inside the shell once. */
export function useSequenceHotkeys(prefix: string, map: Record<string, () => void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || shouldIgnore(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (sequenceArmed()) {
        armedUntil = 0;
        const handler = ref.current[k];
        if (handler) {
          e.preventDefault();
          handler();
        }
        return;
      }
      if (k === prefix && !hasOpenOverlay()) armedUntil = Date.now() + SEQUENCE_WINDOW_MS;
    };
    window.addEventListener('keydown', onKey);
    return () => {
      armedUntil = 0;
      window.removeEventListener('keydown', onKey);
    };
  }, [prefix, enabled]);
}
