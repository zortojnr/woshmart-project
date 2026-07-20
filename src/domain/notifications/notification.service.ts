// Single fan-out point for every outbound "event" (docs/PRD.md §12). Called by the FSM,
// keyword parser, and Admin API — never bypassed. Implemented in Phase 4 (docs/BUILD_SCRIPT.md).
export {};
