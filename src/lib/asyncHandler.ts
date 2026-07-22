import type { NextFunction, Request, Response } from 'express';

// Express doesn't await route handlers — an async handler that throws/rejects would
// otherwise become an unhandled rejection instead of reaching the error middleware.
export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
