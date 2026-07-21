// Small shared reply-matching helpers used across state handlers.

export function isYes(input: string): boolean {
  return /^\s*y(es)?\s*$/i.test(input);
}

export function isNo(input: string): boolean {
  return /^\s*no?\s*$/i.test(input);
}
