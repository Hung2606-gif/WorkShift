import { z } from 'zod';

// Shared validation retained for the HR attendance-review endpoint.
export const reviewSchema = z.object({
  reviewNote: z.string().trim().min(3).max(500),
  isFlagged: z.boolean()
});
