import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = 'That item') => new HttpError(404, `${what} could not be found.`);

/** True for a unique-constraint violation on SQLite or Postgres. */
export const isUniqueViolation = (err) => err?.code === '23505' || /UNIQUE constraint failed/.test(err?.message ?? '');

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
    if (err?.type === 'entity.too.large') err = new HttpError(413, 'That is too large to send. Files can be up to 10 MB each.');
    // Two requests creating the same thing at once: the loser gets a clear answer, not a 500.
    if (isUniqueViolation(err)) err = new HttpError(409, 'That already exists — refresh and try again.');
    // Postgres rejects ids that aren't integers or don't fit; SQLite just finds nothing.
    if (err?.code === '22P02' || err?.code === '22003') err = notFound();
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) log.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message, details: err.details });
  };
}
