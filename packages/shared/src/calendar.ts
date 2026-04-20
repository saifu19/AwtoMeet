import { z } from 'zod';

export const CalendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  start: z.string(),
  end: z.string(),
  attendees: z.array(z.string()).optional(),
});
export type CalendarEventSchema = z.infer<typeof CalendarEventSchema>;

export const ImportEventsReq = z.object({
  event_ids: z.array(z.string()).min(1),
});
export type ImportEventsReq = z.infer<typeof ImportEventsReq>;
