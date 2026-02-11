import { Request, Response, NextFunction } from 'express';
import { logAndRespond } from './logger';
import { alertOnExternalServiceError } from './errorAlerts';
import { HTTP_STATUS } from './constants';

interface ErrorHandlerOptions {
  logPrefix?: string;
  alertService?: string;
  alertContext?: string;
  defaultMessage?: string;
  retryable?: boolean;
}

export function handleRouteError(
  req: Request,
  res: Response,
  error: any,
  options: ErrorHandlerOptions = {}
) {
  const {
    logPrefix = '[Route]',
    alertService,
    alertContext,
    defaultMessage = 'An unexpected error occurred',
    retryable = false,
  } = options;

  console.error(`${logPrefix} Error:`, error);

  if (alertService) {
    alertOnExternalServiceError(alertService, error, alertContext || 'unknown operation').catch(
      (alertErr) => console.error(`${logPrefix} Failed to send error alert:`, alertErr)
    );
  }

  const statusCode = error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const responseBody: Record<string, any> = {
    error: defaultMessage,
  };

  if (retryable) {
    responseBody.retryable = true;
  }

  res.status(statusCode).json(responseBody);
}

export function wrapRoute(
  handler: (req: Request, res: Response) => Promise<any>,
  options: ErrorHandlerOptions = {}
) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error: any) {
      handleRouteError(req, res, error, options);
    }
  };
}

export function wrapStripeRoute(
  handler: (req: Request, res: Response) => Promise<any>,
  operationName: string,
  defaultMessage = 'Payment processing failed. Please try again.'
) {
  return wrapRoute(handler, {
    logPrefix: '[Stripe]',
    alertService: 'Stripe',
    alertContext: operationName,
    defaultMessage,
    retryable: true,
  });
}
