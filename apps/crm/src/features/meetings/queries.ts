import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  deleteBookingPage,
  getBookingPage,
  listBookingPages,
  listBookings,
  saveBookingPage,
  type ListBookingsInputType,
  type SaveBookingPageInputType,
} from 'zitejs/api';
import { errorMessage } from '../../lib/errors';

/**
 * The meetings area owns the `meetings` key prefix. Everything a write can
 * change lives under it, so one `invalidateMeetings` after a save is enough —
 * plus the timeline and home, because a booking is an activity on a record.
 */
export const meetingKeys = {
  pages: () => ['meetings', 'pages'] as const,
  page: (id: string) => ['meetings', 'page', id] as const,
  bookings: (input: ListBookingsInputType) => ['meetings', 'bookings', input] as const,
};

export function invalidateMeetings(qc: QueryClient, pageId?: string) {
  void qc.invalidateQueries({ queryKey: ['meetings'] });
  if (pageId) void qc.invalidateQueries({ queryKey: meetingKeys.page(pageId) });
  // A booking is an Activity, so timelines and the day's worklist move too.
  for (const root of ['timeline', 'tasks', 'home', 'notifications']) void qc.invalidateQueries({ queryKey: [root] });
}

export function useBookingPages() {
  return useQuery({ queryKey: meetingKeys.pages(), queryFn: () => listBookingPages({}) });
}

export function useBookingPage(id: string | null | undefined) {
  return useQuery({
    queryKey: meetingKeys.page(id ?? ''),
    queryFn: () => getBookingPage({ id: id as string }),
    enabled: Boolean(id),
    retry: (count, error) => count < 2 && !/doesn’t exist|NOT_FOUND/i.test(String((error as Error)?.message)),
  });
}

export function useBookings(input: ListBookingsInputType, enabled = true) {
  return useQuery({ queryKey: meetingKeys.bookings(input), queryFn: () => listBookings(input), enabled });
}

export function useSaveBookingPage(options?: { onSaved?: (result: { id: string; slug: string; url: string; created: boolean }) => void }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveBookingPageInputType) => saveBookingPage(input),
    onSuccess: (result, input) => {
      invalidateMeetings(qc, input.id ?? result.id);
      options?.onSaved?.(result);
    },
    onError: e => toast.error(errorMessage(e, 'Couldn’t save the meeting link')),
  });
}

export function useDeleteBookingPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; confirmUpcoming?: boolean }) => deleteBookingPage(input),
    onSuccess: () => invalidateMeetings(qc),
  });
}
