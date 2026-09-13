import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { createServiceClient } from '../lib/supabase.js';
import { audit, clientIp } from '../services/audit.js';
import { companyIdForProfile } from '../services/company.js';

const ticketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(20_000),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL')
});

export const supportRouter = Router();
supportRouter.use(requireAuth, requireRoles('HR'));

supportRouter.get('/tickets', asyncHandler(async (req, res) => {
  const companyId = await companyIdForProfile(req.profile);
  if (!companyId) throw new HttpError(409, 'Tài khoản chưa được gán vào công ty.', 'COMPANY_NOT_ASSIGNED');
  const { data, error } = await createServiceClient().from('support_tickets')
    .select('id, subject, description, status, priority, admin_note, created_at, updated_at')
    .eq('company_id', companyId).order('updated_at', { ascending: false });
  if (error) throw new HttpError(502, 'Không thể tải ticket hỗ trợ.', 'DATABASE_ERROR');
  res.json({ data: data ?? [] });
}));

supportRouter.post('/tickets', asyncHandler(async (req, res) => {
  const body = ticketSchema.parse(req.body);
  const companyId = await companyIdForProfile(req.profile);
  if (!companyId) throw new HttpError(409, 'Tài khoản chưa được gán vào công ty.', 'COMPANY_NOT_ASSIGNED');
  const { data, error } = await createServiceClient().from('support_tickets').insert({
    company_id: companyId, created_by: req.profile.id, subject: body.subject, description: body.description, priority: body.priority
  }).select('id, subject, status, priority, created_at').single();
  if (error || !data) throw new HttpError(502, 'Không thể tạo ticket hỗ trợ.', 'DATABASE_ERROR');
  await audit(req.profile.id, 'SUPPORT_TICKET_CREATED', { ticketId: data.id, companyId }, clientIp(req));
  res.status(201).json({ data });
}));
