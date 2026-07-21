// Woshman/partner keyword protocol parser (docs/TRD.md §4). Pure parsing only — no DB,
// no Twilio, no order lookups. Returns null for anything that doesn't match one of the
// six known keyword formats, so the caller can send a clear "malformed" reply rather
// than guessing at intent.

export type ParsedKeywordCommand =
  | { type: 'COLLECTED'; orderNumber: string }
  | { type: 'LAUNDRY'; orderNumber: string }
  | { type: 'READY'; orderNumber: string }
  | { type: 'DELIVERING'; orderNumber: string }
  | { type: 'DELIVERED'; orderNumber: string; count: number }
  | { type: 'ISSUE'; orderNumber: string; note: string };

const PATTERNS: Array<{ regex: RegExp; build: (match: RegExpMatchArray) => ParsedKeywordCommand }> = [
  {
    regex: /^COLLECTED\s+(\S+)$/i,
    build: (m) => ({ type: 'COLLECTED', orderNumber: m[1]!.toUpperCase() }),
  },
  {
    regex: /^LAUNDRY\s+(\S+)$/i,
    build: (m) => ({ type: 'LAUNDRY', orderNumber: m[1]!.toUpperCase() }),
  },
  {
    regex: /^READY\s+(\S+)$/i,
    build: (m) => ({ type: 'READY', orderNumber: m[1]!.toUpperCase() }),
  },
  {
    regex: /^DELIVERING\s+(\S+)$/i,
    build: (m) => ({ type: 'DELIVERING', orderNumber: m[1]!.toUpperCase() }),
  },
  {
    regex: /^DELIVERED\s+(\S+)\s+(\d+)\s*pcs$/i,
    build: (m) => ({ type: 'DELIVERED', orderNumber: m[1]!.toUpperCase(), count: Number.parseInt(m[2]!, 10) }),
  },
  {
    regex: /^ISSUE\s+(\S+)\s+(.+)$/is,
    build: (m) => ({ type: 'ISSUE', orderNumber: m[1]!.toUpperCase(), note: m[2]!.trim() }),
  },
];

export function parseKeywordCommand(body: string): ParsedKeywordCommand | null {
  const trimmed = body.trim();
  for (const { regex, build } of PATTERNS) {
    const match = trimmed.match(regex);
    if (match) {
      return build(match);
    }
  }
  return null;
}
