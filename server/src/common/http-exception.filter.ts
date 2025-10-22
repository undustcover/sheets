import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';
    let details: any = undefined;
    let code = 'UNKNOWN_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (typeof response === 'object' && response) {
        const r = response as any;
        message = r.message || message;
        details = r.message && Array.isArray(r.message) ? r.message : r.details || r.errors;
      }
    } else if (exception instanceof Error) {
      message = exception.message || message;
    }

    switch (status) {
      case HttpStatus.BAD_REQUEST:
        code = 'VALIDATION_FAILED';
        break;
      case HttpStatus.UNAUTHORIZED:
        code = 'AUTH_FAILED';
        break;
      case HttpStatus.FORBIDDEN:
        code = 'FORBIDDEN';
        break;
      case HttpStatus.NOT_FOUND:
        code = 'NOT_FOUND';
        break;
      case HttpStatus.CONFLICT:
        code = 'REVISION_CONFLICT';
        break;
      case HttpStatus.TOO_MANY_REQUESTS:
        code = 'RATE_LIMITED';
        break;
      default:
        code = 'UNKNOWN_ERROR';
    }

    res.status(status).json({ code, message, ...(details ? { details } : {}) });
  }
}