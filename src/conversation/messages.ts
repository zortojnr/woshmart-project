// Message copy — copied exactly from docs/PRD.md §10, kept separate from state
// handler logic so copy can be reviewed independently (CLAUDE.md rule 7).
// Only the two messages needed through COVERAGE_CHECK are populated here (Phase 2);
// the rest of §10 is added as later states are implemented.

export const WELCOME_MESSAGE =
  "Hi! 👋 You've reached Woshmart. We pick up your clothes, wash and iron everything, and bring them back within 48 hours. Which area of Minna are you in?";

export function coverageConfirmedMessage(area: string): string {
  return `We cover ${area}! Here's what we offer:
1. Starter Bundle — 10 items for ₦2,000
2. Weekly Bundle — 20 items for ₦3,800
3. Family Bundle — 30 items for ₦5,500
4. Household Bundle — 10 items + bedsheet + 2 pillowcases for ₦3,000
Reply 1, 2, 3, or 4.`;
}

export function outOfCoverageMessage(area: string): string {
  return `We're not in ${area} yet — but we're expanding. Want us to add you to the list and message you when we get there? Reply YES and we'll keep you posted.`;
}
