import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from '../lib/hotkeys';

/**
 * Keyboard and selection for any list: J/K to move, Enter to open, Space to
 * peek, X to select, ⌘A for all, Esc to clear. Disable it (`enabled: false`)
 * while a picker or dialog of your own owns the keyboard.
 */
export function useListNav<T>({
  items,
  getId,
  onOpen,
  onPeek,
  enabled = true,
  followFocus = false,
}: {
  items: T[];
  getId: (item: T) => string;
  onOpen?: (item: T) => void;
  onPeek?: (item: T) => void;
  enabled?: boolean;
  /** Set while a peek sheet is open: J/K then move the sheet as well as the focus. */
  followFocus?: boolean;
}) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => items.map(getId), [items, getId]);

  useEffect(() => {
    // Drop selections and focus for rows that no longer exist.
    setSelected(current => {
      const next = new Set([...current].filter(id => ids.includes(id)));
      return next.size === current.size ? current : next;
    });
    setFocusId(current => (current && ids.includes(current) ? current : null));
  }, [ids.join(',')]);

  const move = useCallback(
    (delta: number) => {
      if (!items.length) return;
      const index = focusId ? ids.indexOf(focusId) : -1;
      const nextIndex = Math.max(0, Math.min(items.length - 1, index + delta === -1 && index === -1 ? 0 : index + delta));
      const id = ids[nextIndex];
      setFocusId(id);
      scrollRef.current?.querySelector(`[data-row-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      if (followFocus && onPeek) {
        const item = items[nextIndex];
        if (item) onPeek(item);
      }
    },
    [focusId, ids, items.length, followFocus, onPeek, items],
  );

  const focused = items.find(item => getId(item) === focusId) ?? null;

  const toggleSelect = useCallback((id: string) => {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useHotkeys(
    {
      j: () => {
        if (!items.length) return false;
        move(1);
      },
      down: () => {
        if (!items.length) return false;
        move(1);
      },
      k: () => {
        if (!items.length) return false;
        move(-1);
      },
      up: () => {
        if (!items.length) return false;
        move(-1);
      },
      enter: () => {
        if (!focused || !onOpen) return false;
        onOpen(focused);
      },
      space: () => {
        if (!focused || !onPeek) return false;
        onPeek(focused);
      },
      x: () => {
        if (!focusId) return false;
        toggleSelect(focusId);
      },
      'mod+a': () => {
        if (!items.length) return false;
        setSelected(new Set(ids));
      },
      esc: () => {
        if (selected.size) setSelected(new Set());
        else if (focusId) setFocusId(null);
        else return false;
      },
    },
    { enabled },
  );

  return {
    focusId,
    setFocusId,
    focused,
    selected,
    setSelected,
    toggleSelect,
    clearSelection: () => setSelected(new Set()),
    selectAll: () => setSelected(new Set(ids)),
    allSelected: items.length > 0 && selected.size === items.length,
    scrollRef,
    /** The rows an action applies to: the selection, else the focused row. */
    targets: () => (selected.size ? items.filter(item => selected.has(getId(item))) : focused ? [focused] : []),
    targetsFor: (item: T) => (selected.has(getId(item)) ? items.filter(i => selected.has(getId(i))) : [item]),
  };
}
