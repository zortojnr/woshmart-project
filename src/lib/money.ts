// Money is always an integer kobo value (CLAUDE.md rule 3). Domain/pricing code uses
// plain `number` for kobo, not the JS `BigInt` type — every value here is a small
// integer (well under Number.MAX_SAFE_INTEGER) so there's no precision risk, and it
// keeps arithmetic/JSON/test assertions simple. Conversion to `BigInt` happens only at
// the Prisma write boundary (order.repository.ts), matching the schema's BIGINT column.

export function formatNairaFromKobo(kobo: number): string {
  const naira = Math.trunc(kobo / 100);
  return naira.toLocaleString('en-US');
}
