export class AppError extends Error {
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(message: string, statusCode: number, expose = true) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400);
    this.name = 'BadRequestError';
  }
}
