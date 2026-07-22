// Prisma's BIGINT columns (money, per CLAUDE.md rule 3) surface as JS `bigint`, which
// JSON.stringify can't serialize by default — every Admin API route returning an order,
// user, woshman, or partner record would 500. Every BigInt column here is a kobo amount,
// always well under Number.MAX_SAFE_INTEGER (src/lib/money.ts's existing convention),
// so rendering it as a plain JSON number is safe. Imported once for its side effect.
declare global {
  interface BigInt {
    toJSON(): number;
  }
}

BigInt.prototype.toJSON = function (this: bigint): number {
  return Number(this);
};

export {};
