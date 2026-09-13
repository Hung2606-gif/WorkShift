import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { createServiceClient } from '../lib/supabase.js';
import { clientIp } from '../services/audit.js';
import { companyIdForProfile } from '../services/company.js';

const emptyBodySchema = z.object({}).strict();

export function attendanceRouter() {
  const router = Router();
  router.use(requireAuth);

  router.post('/checkin', asyncHandler(async (req, res) => {
    // The request must not contain camera, GPS, face-vector, or client-supplied
    // attendance data. Its only proof is the verified corporate network IP.
    emptyBodySchema.parse(req.body ?? {});
    const ip = clientIp(req);
    const companyId = await companyIdForProfile(req.profile);
    if (!ip || !companyId) {
      throw new HttpError(403, 'Bạn phải kết nối đúng Wi-Fi công ty để chấm công', 'COMPANY_WIFI_REQUIRED');
    }

    const supabase = createServiceClient();
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('allowed_ip')
      .eq('id', companyId)
      .maybeSingle();
    if (companyError) throw new HttpError(502, 'Không thể tải cấu hình công ty.', 'DATABASE_ERROR');
    if (!company?.allowed_ip || company.allowed_ip !== ip) {
      throw new HttpError(403, 'Bạn phải kết nối đúng Wi-Fi công ty để chấm công', 'COMPANY_WIFI_REQUIRED');
    }

    // `check_in_time` is set by the database so a client cannot forge it.
    const { data: attendance, error: insertError } = await supabase
      .from('attendances')
      .insert({ user_id: req.profile.id, status: 'NORMAL' })
      .select('id, user_id, check_in_time, status')
      .single();
    if (insertError || !attendance) throw new HttpError(502, 'Không thể lưu chấm công.', 'DATABASE_ERROR');

    res.status(200).json({ message: 'Chấm công thành công!', data: attendance });
  }));

  return router;
}
