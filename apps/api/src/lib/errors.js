import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(422).json({
      error: 'Dữ liệu gửi lên không hợp lệ.',
      code: 'VALIDATION_ERROR',
      details: error.flatten()
    });
  }
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }

  console.error(error);
  return res.status(500).json({ error: 'Đã có lỗi hệ thống. Vui lòng thử lại.', code: 'INTERNAL_ERROR' });
}
