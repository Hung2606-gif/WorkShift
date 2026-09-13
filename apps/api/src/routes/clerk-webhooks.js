import { verifyWebhook } from '@clerk/express/webhooks';
import { Router } from 'express';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { deactivateClerkUser, syncClerkUser } from '../services/clerk-profile.js';

export const clerkWebhookRouter = Router();

clerkWebhookRouter.post('/', asyncHandler(async (req, res) => {
  let event;
  try {
    event = await verifyWebhook(req);
  } catch {
    throw new HttpError(400, 'Webhook xác thực không hợp lệ.', 'INVALID_WEBHOOK_SIGNATURE');
  }
  let result;
  if (event.type === 'user.created' || event.type === 'user.updated') result = await syncClerkUser(event.data);
  else if (event.type === 'user.deleted') await deactivateClerkUser(event.data.id);
  res.status(result?.status === 'pending_email' ? 202 : 200).json({ received: true, type: event.type, status: result?.status });
}));
