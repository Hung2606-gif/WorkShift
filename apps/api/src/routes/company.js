import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { createServiceClient } from '../lib/supabase.js';
import { clientIp } from '../services/audit.js';
import { companyIdForProfile } from '../services/company.js';

const updateCompanyIpSchema = z.object({
  // When omitted, the request's public address is used instead.
  allowedIp: z.string().ip().optional()
}).strict();

export const companyRouter = Router();

companyRouter.get('/company/wifi', requireAuth, requireRoles('HR'), asyncHandler(async (req, res) => {
  const companyId = await companyIdForProfile(req.profile);
  if (!companyId) throw new HttpError(409, 'Tai khoan HR chua duoc gan vao cong ty.', 'COMPANY_NOT_ASSIGNED');
  const { data, error } = await createServiceClient()
    .from('companies')
    .select('id, name, allowed_ip')
    .eq('id', companyId)
    .single();
  if (error || !data) throw new HttpError(502, 'Khong the tai cau hinh IP cong ty.', 'DATABASE_ERROR');
  res.json({ data });
}));

companyRouter.patch('/company/ip', requireAuth, requireRoles('HR'), asyncHandler(async (req, res) => {
  const { allowedIp } = updateCompanyIpSchema.parse(req.body);
  const ip = allowedIp ?? clientIp(req);
  if (!ip) throw new HttpError(422, 'Khong the xac dinh dia chi IP cong ty.', 'CLIENT_IP_UNAVAILABLE');
  const companyId = await companyIdForProfile(req.profile);
  if (!companyId) throw new HttpError(409, 'Tai khoan HR chua duoc gan vao cong ty.', 'COMPANY_NOT_ASSIGNED');

  // The company ID always comes from the verified JWT profile, never the body.
  const { data, error } = await createServiceClient()
    .from('companies')
    .update({ allowed_ip: ip })
    .eq('id', companyId)
    .select('id, name, allowed_ip')
    .single();
  if (error || !data) throw new HttpError(502, 'Khong the cap nhat IP cong ty.', 'DATABASE_ERROR');

  res.json({ message: 'Da cap nhat IP Wi-Fi cong ty.', data });
}));
