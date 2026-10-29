/** An error whose message is safe to show to the person using the app. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'bad_request', details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthenticated = (message = 'Please sign in to continue.') =>
  new AppError(401, 'unauthenticated', message);
export const forbidden = (message = 'Only workspace owners can do that.') =>
  new AppError(403, 'forbidden', message);
export const notFound = (what = 'That item') =>
  new AppError(404, 'not_found', `${what} was not found.`);
export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);
export const staleRevision = () =>
  conflict(
    'Someone else changed this since you opened it. Reload to see their changes.',
    'stale_revision',
  );
