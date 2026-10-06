import { z } from 'zod';
export const requestInputSchema = z
  .object({
    contactName: z.string().trim().min(2).max(120),
    contactEmail: z
      .email()
      .max(320)
      .transform((v) => v.toLowerCase()),
    contactPhone: z
      .string()
      .trim()
      .max(40)
      .regex(/^[+()\d .-]*$/)
      .default(''),
    message: z.string().trim().min(10).max(3000),
  })
  .strict();
export const requestStatusSchema = z
  .object({
    status: z.enum(['in_progress', 'completed', 'closed']),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();
export type RequestInput = z.infer<typeof requestInputSchema>;
export interface SalesRequest {
  id: string;
  customer_id: string;
  account_uuid: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  message: string;
  status: 'new' | 'in_progress' | 'completed' | 'closed';
  email_state: 'pending' | 'sending' | 'sent' | 'failed';
  email_attempts: number;
  email_error: string | null;
  created_at: Date;
}
