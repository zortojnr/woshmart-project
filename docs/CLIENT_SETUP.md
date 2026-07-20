# Woshmart — What You (the Client) Need to Do

Short version: a few accounts need to be created and owned by **you**, the business — not the engineering team building this. This keeps your WhatsApp number, billing, and business verification tied to your company, so nothing is stuck in someone else's account later.

Do these first — item 1 has the longest wait time, so start there.

## 1. Create your Twilio account

- Go to **twilio.com**, sign up using a business email address (not a personal one).
- Verify the email and phone number when prompted.
- Add a payment method — Twilio charges per WhatsApp message sent/received. This is your business's ongoing cost, so it should be on your card, not your developer's.

## 2. Decide on your WhatsApp business number

- Pick the phone number Woshmart will use to talk to customers. **This should be a dedicated number, not anyone's personal phone** — it needs to work even if the person currently running things changes later.
- Have it ready to receive a verification SMS or call.

## 3. Submit your WhatsApp Business Profile

Your developer will walk you through the actual screens (Twilio Console → Messaging → Senders → New WhatsApp Sender), but a few things only you can provide:

- Your registered business name (should match what you'd use on any official paperwork)
- Business email, website, and country
- The display name customers will see (e.g. "Woshmart")
- A Facebook/Meta login with admin rights to your business — if you don't have a Meta Business Manager account yet, one gets created as part of this same step

**This step has a review wait of typically 1–3 business days** (sometimes longer). Get it submitted as early as possible — it should not be the thing holding up your launch date.

## 4. Give your developer access — without giving away ownership

Once your Twilio account exists:

- Go to **Console → Account → Manage Users** (wording may vary slightly).
- Invite your developer's email as a user on the account.
- This lets them build and configure things without the account, billing, or business verification being tied to them instead of you.

## 5. Share credentials safely

Your developer will need two values from your Twilio account (**Account SID** and **Auth Token**) to connect the software to your WhatsApp number.

- Share these through a password manager (e.g. 1Password) or a secrets-sharing tool.
- **Never send them in plaintext over email, WhatsApp, or Slack.**
- If you're ever unsure whether something's been exposed, they can be regenerated/rotated from the Twilio Console — ask your developer to do this if in doubt.

## 6. Have your bank details ready

Customers paying by bank transfer will be sent your account name and number directly in the WhatsApp chat. Confirm which account this should be before launch.

## 7. Know what you're approving

Before things go live, your developer should walk you through:
- The exact messages customers will receive (already written and reviewed — ask to see them)
- The pricing customers will be quoted
- A short supervised test run with real orders before the system goes fully live unsupervised

---

**The one-line summary:** you own the Twilio account, the phone number, the WhatsApp Business Profile, and the bank account customers pay into. Your developer gets *access* to build on top of that — not ownership of it.
