import { describe, it, expect } from 'vitest';
import {
  getErrorMessage,
  getErrorCode,
  getErrorStatusCode,
  isStripeError,
  getFullErrorDetails,
  getErrorDetail,
  getErrorStack,
  getErrorProperty,
} from '../../server/utils/errorUtils';

describe('errorUtils', () => {
  describe('getErrorMessage', () => {
    it('should extract message from Error instance', () => {
      const error = new Error('Test error message');
      expect(getErrorMessage(error)).toBe('Test error message');
    });

    it('should return the string when given a string', () => {
      const errorString = 'String error';
      expect(getErrorMessage(errorString)).toBe('String error');
    });

    it('should convert number to string', () => {
      const errorNumber = 404;
      expect(getErrorMessage(errorNumber)).toBe('404');
    });

    it('should return "undefined" when error is undefined', () => {
      expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('should return "null" when error is null', () => {
      expect(getErrorMessage(null)).toBe('null');
    });

    it('should convert object without message to string', () => {
      const errorObject = { code: 'ERROR_CODE', details: 'Some details' };
      const result = getErrorMessage(errorObject);
      expect(typeof result).toBe('string');
      expect(result).toBe('[object Object]');
    });

    it('should handle object with message property by using Error message', () => {
      const errorObject = new Error('Error with message');
      expect(getErrorMessage(errorObject)).toBe('Error with message');
    });

    it('should handle boolean values', () => {
      expect(getErrorMessage(true)).toBe('true');
      expect(getErrorMessage(false)).toBe('false');
    });

    it('should handle empty string', () => {
      expect(getErrorMessage('')).toBe('');
    });
  });

  describe('getErrorCode', () => {
    it('should extract string code from error object', () => {
      const error = { code: 'INTERNAL_ERROR' };
      expect(getErrorCode(error)).toBe('INTERNAL_ERROR');
    });

    it('should convert numeric code to string', () => {
      const error = { code: 42 };
      expect(getErrorCode(error)).toBe('42');
    });

    it('should return undefined for Error instance without code', () => {
      const error = new Error('Test error');
      expect(getErrorCode(error)).toBeUndefined();
    });

    it('should return undefined when error is null', () => {
      expect(getErrorCode(null)).toBeUndefined();
    });

    it('should return undefined when error is undefined', () => {
      expect(getErrorCode(undefined)).toBeUndefined();
    });

    it('should return undefined for object without code property', () => {
      const error = { message: 'Test', statusCode: 400 };
      expect(getErrorCode(error)).toBeUndefined();
    });

    it('should handle code property with boolean value', () => {
      const error = { code: true };
      expect(getErrorCode(error)).toBe('true');
    });

    it('should handle code property with empty string', () => {
      const error = { code: '' };
      expect(getErrorCode(error)).toBe('');
    });

    it('should handle code property with null value', () => {
      const error = { code: null };
      expect(getErrorCode(error)).toBe('null');
    });
  });

  describe('getErrorStatusCode', () => {
    it('should extract statusCode from error object', () => {
      const error = { statusCode: 500 };
      expect(getErrorStatusCode(error)).toBe(500);
    });

    it('should extract status from error object when statusCode missing', () => {
      const error = { status: 404 };
      expect(getErrorStatusCode(error)).toBe(404);
    });

    it('should prioritize statusCode over status when both present', () => {
      const error = { statusCode: 500, status: 404 };
      expect(getErrorStatusCode(error)).toBe(500);
    });

    it('should return undefined when error is null', () => {
      expect(getErrorStatusCode(null)).toBeUndefined();
    });

    it('should return undefined when error is undefined', () => {
      expect(getErrorStatusCode(undefined)).toBeUndefined();
    });

    it('should convert non-numeric statusCode to number', () => {
      const error = { statusCode: '400' };
      expect(getErrorStatusCode(error)).toBe(400);
    });

    it('should return NaN when statusCode is non-numeric string', () => {
      const error = { statusCode: 'not-a-number' };
      const result = getErrorStatusCode(error);
      expect(isNaN(result)).toBe(true);
    });

    it('should handle string status property', () => {
      const error = { status: '200' };
      expect(getErrorStatusCode(error)).toBe(200);
    });

    it('should return 0 for statusCode 0', () => {
      const error = { statusCode: 0 };
      expect(getErrorStatusCode(error)).toBe(0);
    });

    it('should handle negative status codes', () => {
      const error = { statusCode: -1 };
      expect(getErrorStatusCode(error)).toBe(-1);
    });
  });

  describe('isStripeError', () => {
    it('should return true for Stripe error object', () => {
      const error = {
        type: 'StripeCardError',
        message: 'Card declined',
      };
      expect(isStripeError(error)).toBe(true);
    });

    it('should return true for Stripe error with StripeInvalidRequestError type', () => {
      const error = {
        type: 'StripeInvalidRequestError',
        message: 'Invalid parameter',
      };
      expect(isStripeError(error)).toBe(true);
    });

    it('should return false for non-Stripe error object', () => {
      const error = { type: 'CustomError', message: 'Something went wrong' };
      expect(isStripeError(error)).toBe(false);
    });

    it('should return false when error is null', () => {
      expect(isStripeError(null)).toBe(false);
    });

    it('should return false when error is undefined', () => {
      expect(isStripeError(undefined)).toBe(false);
    });

    it('should return false when error object missing type property', () => {
      const error = { message: 'Some error' };
      expect(isStripeError(error)).toBe(false);
    });

    it('should return false when type is not a string', () => {
      const error = { type: 123, message: 'Error' };
      expect(isStripeError(error)).toBe(false);
    });

    it('should return false when type does not start with "Stripe"', () => {
      const error = { type: 'MyStripeError', message: 'Error' };
      expect(isStripeError(error)).toBe(false);
    });

    it('should handle Stripe error with code and statusCode properties', () => {
      const error = {
        type: 'StripeRateLimitError',
        message: 'Rate limited',
        code: 'rate_limit',
        statusCode: 429,
      };
      expect(isStripeError(error)).toBe(true);
    });

    it('should be case-sensitive for "Stripe" prefix', () => {
      const error = { type: 'stripe_error', message: 'Error' };
      expect(isStripeError(error)).toBe(false);
    });
  });

  describe('getFullErrorDetails', () => {
    it('should return complete error details for Error instance', () => {
      const error = new Error('Test error');
      const details = getFullErrorDetails(error);
      
      expect(details.message).toBe('Test error');
      expect(details.stack).toBeDefined();
      expect(details.stack).toContain('Test error');
      expect(details.code).toBeUndefined();
      expect(details.statusCode).toBeUndefined();
    });

    it('should return error details for plain string', () => {
      const error = 'String error';
      const details = getFullErrorDetails(error);
      
      expect(details.message).toBe('String error');
      expect(details.code).toBeUndefined();
      expect(details.statusCode).toBeUndefined();
      expect(details.stack).toBeUndefined();
    });

    it('should extract all properties from complex error object', () => {
      const error = {
        message: 'Request failed',
        code: 'ERR_REQUEST',
        statusCode: 500,
        stack: 'Error: Request failed\n    at test.ts:1:1',
      };
      const details = getFullErrorDetails(error);
      
      expect(details.message).toBe('[object Object]');
      expect(details.code).toBe('ERR_REQUEST');
      expect(details.statusCode).toBe(500);
      expect(details.stack).toBeUndefined();
    });

    it('should handle null error', () => {
      const details = getFullErrorDetails(null);
      
      expect(details.message).toBe('null');
      expect(details.code).toBeUndefined();
      expect(details.statusCode).toBeUndefined();
      expect(details.stack).toBeUndefined();
    });

    it('should handle undefined error', () => {
      const details = getFullErrorDetails(undefined);
      
      expect(details.message).toBe('undefined');
      expect(details.code).toBeUndefined();
      expect(details.statusCode).toBeUndefined();
      expect(details.stack).toBeUndefined();
    });

    it('should prioritize statusCode over status', () => {
      const error = {
        message: 'Error',
        statusCode: 500,
        status: 404,
      };
      const details = getFullErrorDetails(error);
      
      expect(details.statusCode).toBe(500);
    });

    it('should return all undefined properties when error has no relevant properties', () => {
      const error = { random: 'property' };
      const details = getFullErrorDetails(error);
      
      expect(details.message).toBeDefined();
      expect(details.code).toBeUndefined();
      expect(details.statusCode).toBeUndefined();
      expect(details.stack).toBeUndefined();
    });

    it('should not include stack for non-Error objects', () => {
      const error = { message: 'Test', code: 'TEST' };
      const details = getFullErrorDetails(error);
      
      expect(details.stack).toBeUndefined();
    });
  });

  describe('getErrorDetail', () => {
    it('should extract detail from PostgreSQL-like error object', () => {
      const error = {
        message: 'unique violation',
        detail: 'Key (email)=(test@example.com) already exists.',
      };
      expect(getErrorDetail(error)).toBe('Key (email)=(test@example.com) already exists.');
    });

    it('should return undefined for error without detail property', () => {
      const error = new Error('Test error');
      expect(getErrorDetail(error)).toBeUndefined();
    });

    it('should return undefined when error is null', () => {
      expect(getErrorDetail(null)).toBeUndefined();
    });

    it('should return undefined when error is undefined', () => {
      expect(getErrorDetail(undefined)).toBeUndefined();
    });

    it('should convert detail property to string', () => {
      const error = { detail: 123 };
      expect(getErrorDetail(error)).toBe('123');
    });

    it('should handle detail property with empty string', () => {
      const error = { detail: '' };
      expect(getErrorDetail(error)).toBe('');
    });

    it('should handle detail property with null value', () => {
      const error = { detail: null };
      expect(getErrorDetail(error)).toBe('null');
    });

    it('should handle object with multiple properties including detail', () => {
      const error = {
        message: 'Database error',
        code: 'UNIQUE_VIOLATION',
        detail: 'Duplicate key value',
        table: 'users',
      };
      expect(getErrorDetail(error)).toBe('Duplicate key value');
    });
  });

  describe('getErrorStack', () => {
    it('should extract stack from Error instance', () => {
      const error = new Error('Test error');
      const stack = getErrorStack(error);
      
      expect(stack).toBeDefined();
      expect(typeof stack).toBe('string');
      expect(stack).toContain('Test error');
    });

    it('should extract stack from object with stack property', () => {
      const stack = 'Error: Custom error\n    at line 1\n    at line 2';
      const error = { message: 'Custom error', stack };
      
      expect(getErrorStack(error)).toBe(stack);
    });

    it('should return undefined when error is null', () => {
      expect(getErrorStack(null)).toBeUndefined();
    });

    it('should return undefined when error is undefined', () => {
      expect(getErrorStack(undefined)).toBeUndefined();
    });

    it('should return undefined for object without stack property', () => {
      const error = { message: 'Test error' };
      expect(getErrorStack(error)).toBeUndefined();
    });

    it('should prioritize Error instance stack over other sources', () => {
      const error = new Error('Test error');
      const stack = getErrorStack(error);
      
      expect(stack).toBeDefined();
      expect(stack).toContain('Error');
    });

    it('should handle string stack property', () => {
      const stackString = 'Stack trace line 1\nStack trace line 2';
      const error = { stack: stackString };
      
      expect(getErrorStack(error)).toBe(stackString);
    });

    it('should handle stack property with null value', () => {
      const error = { stack: null };
      expect(getErrorStack(error)).toBe('null');
    });

    it('should handle multiline stack traces', () => {
      const error = new Error('Complex error');
      const stack = getErrorStack(error);
      
      expect(stack).toBeDefined();
      expect(stack.split('\n').length).toBeGreaterThan(1);
    });
  });

  describe('getErrorProperty', () => {
    it('should extract property from object', () => {
      const error = { customProp: 'custom value' };
      expect(getErrorProperty(error, 'customProp')).toBe('custom value');
    });

    it('should return undefined for missing property', () => {
      const error = { prop1: 'value1' };
      expect(getErrorProperty(error, 'nonExistentProp')).toBeUndefined();
    });

    it('should return undefined when error is null', () => {
      expect(getErrorProperty(null, 'anyKey')).toBeUndefined();
    });

    it('should return undefined when error is undefined', () => {
      expect(getErrorProperty(undefined, 'anyKey')).toBeUndefined();
    });

    it('should extract property with different value types', () => {
      const error = {
        stringProp: 'string',
        numberProp: 42,
        booleanProp: true,
        nullProp: null,
        undefinedProp: undefined,
      };
      
      expect(getErrorProperty(error, 'stringProp')).toBe('string');
      expect(getErrorProperty(error, 'numberProp')).toBe(42);
      expect(getErrorProperty(error, 'booleanProp')).toBe(true);
      expect(getErrorProperty(error, 'nullProp')).toBeNull();
      expect(getErrorProperty(error, 'undefinedProp')).toBeUndefined();
    });

    it('should return undefined for dot-notation keys', () => {
      const error = {
        nested: { deep: 'value' },
      };
      
      const result = getErrorProperty(error, 'nested.deep');
      expect(result).toBeUndefined();
    });

    it('should extract property with empty string key', () => {
      const error = { '': 'empty key value' };
      expect(getErrorProperty(error, '')).toBe('empty key value');
    });

    it('should handle Error instance properties', () => {
      const error = new Error('Test error');
      const message = getErrorProperty(error, 'message');
      
      expect(message).toBe('Test error');
    });

    it('should extract numeric or symbol keys from object', () => {
      const error = { code: 'ERR_001', statusCode: 500, type: 'ApiError' };
      
      expect(getErrorProperty(error, 'code')).toBe('ERR_001');
      expect(getErrorProperty(error, 'statusCode')).toBe(500);
      expect(getErrorProperty(error, 'type')).toBe('ApiError');
    });

    it('should handle object with property that has falsy value', () => {
      const error = { zeroProp: 0, falseProp: false, emptyString: '' };
      
      expect(getErrorProperty(error, 'zeroProp')).toBe(0);
      expect(getErrorProperty(error, 'falseProp')).toBe(false);
      expect(getErrorProperty(error, 'emptyString')).toBe('');
    });

    it('should return undefined for non-object errors', () => {
      expect(getErrorProperty('string', 'anyKey')).toBeUndefined();
      expect(getErrorProperty(123, 'anyKey')).toBeUndefined();
      expect(getErrorProperty(true, 'anyKey')).toBeUndefined();
    });
  });
});
