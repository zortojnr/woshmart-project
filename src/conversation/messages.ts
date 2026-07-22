// Message copy — copied exactly from docs/PRD.md §10, kept separate from state
// handler logic so copy can be reviewed independently (CLAUDE.md rule 7).
//
// Everything in this file down to "Fallback / operational copy" is sourced directly
// from PRD.md §10. Some of it (status updates, feedback, timeouts) isn't wired into a
// state handler yet — those are Phase 4/6 territory — but the copy is captured here now
// per the Phase 3 build instructions, so it exists in one reviewable place.
import { env } from '../config/env';
import type { BundleId } from '../domain/pricing/bundles.config';
import { computeQuote } from '../domain/pricing/pricing.service';
import { formatNairaFromKobo } from '../lib/money';

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

export function addressRequestMessage(bundleName: string, priceKobo: number): string {
  return `${bundleName} for ₦${formatNairaFromKobo(priceKobo)} — noted. What's your address? Drop a landmark too so our Woshman finds you fast.`;
}

export const PICKUP_TIME_MESSAGE = `When works for pickup?
1. Today (morning — 7AM–12PM)
2. Today (afternoon — 12PM–4PM)
3. Today (evening — 4PM–7PM)
4. Tomorrow morning
5. Tomorrow afternoon
Reply 1–5.`;

export const PAYMENT_METHOD_MESSAGE = `How are you paying?
1. Bank transfer
2. Cash on delivery
Reply 1 or 2.`;

export interface QuoteMessageInput {
  bundleName: string;
  itemsLabel: string;
  serviceTotalKobo: number;
  smallBasketFeeKobo: number;
  logisticsFeeKobo: number;
  grandTotalKobo: number;
}

// PRD.md's template shows the small-basket-fee line only "(only if applicable)" — it
// never applies at MVP (bundle-only pricing, see pricing.service.ts), so that line is
// omitted whenever it's 0, not printed as "₦0". The logistics line isn't marked
// conditional in the template, but PRD §6.3's free-logistics threshold has to be
// customer-visible somehow — rendered as "Free" when waived, since a literal "₦0" line
// reads oddly. Flagged for reviewer sign-off (this phase gets real scrutiny per
// CLAUDE.md) as a copy-rendering interpretation, not a fabricated business rule.
export function quoteMessage(input: QuoteMessageInput): string {
  const lines = [
    "Here's your summary:",
    `${input.bundleName} — ${input.itemsLabel} — ₦${formatNairaFromKobo(input.serviceTotalKobo)}`,
  ];

  if (input.smallBasketFeeKobo > 0) {
    lines.push(`Small basket fee — ₦${formatNairaFromKobo(input.smallBasketFeeKobo)}`);
  }

  lines.push(
    input.logisticsFeeKobo > 0
      ? `Pickup + delivery — ₦${formatNairaFromKobo(input.logisticsFeeKobo)}`
      : 'Pickup + delivery — Free',
  );
  lines.push(`Total — ₦${formatNairaFromKobo(input.grandTotalKobo)}`);
  lines.push('Reply YES to confirm. Reply NO to cancel.');

  return lines.join('\n');
}

// Convenience wrapper so state handlers don't each re-assemble the QuoteMessageInput
// shape from a bundleId — the pricing math still lives entirely in pricing.service.ts.
export function quoteMessageForBundle(bundleId: BundleId): string {
  const quote = computeQuote(bundleId);
  return quoteMessage({
    bundleName: quote.bundle.name,
    itemsLabel: quote.bundle.itemsLabel,
    serviceTotalKobo: quote.serviceTotalKobo,
    smallBasketFeeKobo: quote.smallBasketFeeKobo,
    logisticsFeeKobo: quote.logisticsFeeKobo,
    grandTotalKobo: quote.grandTotalKobo,
  });
}

export function bankTransferInstructionsMessage(totalKobo: number): string {
  return `Send ₦${formatNairaFromKobo(totalKobo)} to:
${env.BANK_NAME} | ${env.BANK_ACCOUNT_NUMBER} | Woshmart
Send your receipt here once done — we'll confirm and get your Woshman moving.`;
}

export function codConfirmationMessage(totalKobo: number, timeWindowLabel: string): string {
  return `Your Woshman will collect ₦${formatNairaFromKobo(totalKobo)} cash when they deliver. They'll be with you by ${timeWindowLabel} — have your items ready.`;
}

export function dispatchConfirmationMessage(woshmanName: string): string {
  return `Got your payment — we're good to go. ${woshmanName} is your Woshman and they're heading to you now. We'll update you as things move.`;
}

export const STATUS_UPDATE_MESSAGES = {
  picked_up: 'Your clothes have been picked up and are heading to the laundry. ✅',
  at_laundry: 'Your clothes are at the laundry — washing and ironing in progress. We\'ll ping you when they\'re heading back.',
  delivered: 'Your clothes are home! 🧺 Thanks for using Woshmart.',
} as const;

export function outForDeliveryMessage(woshmanName: string): string {
  return `${woshmanName} is on the way with your clothes. Should be with you soon.`;
}

export const FEEDBACK_PROMPT_MESSAGE = `Quick one — how did we do?
1. All good 👍
2. Had a small issue
3. Something went wrong — please call me
Takes 5 seconds.`;

export const FEEDBACK_RESPONSE_MESSAGES = {
  1: 'Glad to hear it! 🙌 Know anyone who needs laundry sorted? Refer them and your next pickup is on us.',
  2: 'Noted — what could we have done better?',
  3: 'Really sorry about that. Someone from the team will call you shortly.',
} as const;

export const QUOTE_TIMEOUT_MESSAGE = 'Your order has timed out. Message us anytime to start again.';
export const PAYMENT_REMINDER_MESSAGE = 'Did your transfer go through? Reply with your receipt when ready.';

// --- Fallback / operational copy (not in PRD.md §10 — PRD has no specified copy for
// unmatched-input handling, so this is new, minimal, and flagged for a copy review
// rather than silently treated as "PRD-equivalent" text). ---

export const ESCALATION_FALLBACK_MESSAGE =
  "Sorry, I'm having trouble understanding. Reply MENU to see your options again, or a teammate will reach out to help.";

export const MEDIA_NOT_SUPPORTED_MESSAGE = 'We can only read text messages right now — no photos/files yet outside payment confirmation.';

export const WAITLIST_DECLINE_MESSAGE = 'No worries — message us anytime if you\'d like to join the waitlist.';

// --- Woshman/partner keyword protocol copy (docs/TRD.md §4) — PRD.md §10 is
// customer-facing only and has no specified text for Woshman/partner-side replies or
// alerts, so this is new copy, kept in this same "not from PRD" category. ---

export function readyForPickupAlertMessage(orderNumber: string): string {
  return `${orderNumber} is ready for pickup from the laundry — head over when you can.`;
}

export function unknownOrderMessage(orderNumber: string): string {
  return `We don't have an order ${orderNumber}. Please check the order number and resend.`;
}

export const MALFORMED_KEYWORD_MESSAGE =
  'Didn\'t recognize that command. Valid formats: COLLECTED <order>, LAUNDRY <order>, READY <order>, DELIVERING <order>, DELIVERED <order> <count>pcs, ISSUE <order> <note>.';

export function illegalKeywordTransitionMessage(orderNumber: string, currentStatus: string): string {
  return `Can't update ${orderNumber} right now — current status is "${currentStatus}". Check the order and try again.`;
}

export function alreadyAtStatusMessage(orderNumber: string, status: string): string {
  return `${orderNumber} is already marked as ${status} — no changes made.`;
}

export function keywordNotAllowedForSenderMessage(keyword: string): string {
  return `${keyword} can't be sent from this number. Check the keyword and who's sending it.`;
}

// --- Admin API assignment briefs (docs/TRD.md §5.2 / USER_JOURNEY.md §2, §3) — PRD.md
// §12 lists these as "dispatch brief" / "job brief" rows but doesn't specify the copy
// (customer- and Woshman/partner-facing keyword copy above is the same situation), so
// this is new copy in the same "not from PRD, flagged for review" category. ---

export function woshmanDispatchBriefMessage(input: {
  orderNumber: string;
  address: string;
  landmark: string | null;
  zone: string;
  pickupWindow: string | null;
}): string {
  const landmarkLine = input.landmark ? ` (landmark: ${input.landmark})` : '';
  return `New job: ${input.orderNumber} — pickup at ${input.address}${landmarkLine}, ${input.zone}. Window: ${input.pickupWindow ?? 'TBC'}. Reply COLLECTED ${input.orderNumber} once picked up.`;
}

export function partnerJobBriefMessage(input: { orderNumber: string; serviceType: string; itemsDescription: string | null }): string {
  const itemsLine = input.itemsDescription ? ` — ${input.itemsDescription}` : '';
  return `Incoming job: ${input.orderNumber} (${input.serviceType})${itemsLine}. Reply READY ${input.orderNumber} once it's ready for delivery.`;
}
