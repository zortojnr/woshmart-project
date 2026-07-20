// Thin wrapper over Twilio's send API — owns retry/backoff and outbound throttling.
// The only code path that calls Twilio's send API. Implemented in Phase 2 (docs/BUILD_SCRIPT.md).
export {};
