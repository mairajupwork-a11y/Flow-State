import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = 'That item') => new HttpError(404, `${what} could not be found.`);

/** Parses `input` with a zod schema, raising a friendly 400 on failure. */
export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join('.') || 'input';
    throw new HttpError(400, `Please check ${field}: ${first?.message ?? 'invalid value'}.`, result.error.issues);
  }
  return result.data;
}

export function errorHandler(log = console) {
  // eslint-disable-next-line no-unused-vars
  return (err, _req, res, _next) => {
    if (err instanceof ZodError) err = new HttpError(400, 'Some fields need attention.', err.issues);
    if (err?.type === 'entity.parse.failed') err = new HttpError(400, 'The request body was not valid JSON.');
    if (err?.type === 'entity.too.large') err = new HttpError(413, 'That request is too large.');
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) log.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message, details: err.details });
  };
}
