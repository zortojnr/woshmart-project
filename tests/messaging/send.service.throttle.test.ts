// Outbound throttle (docs/BUILD_SCRIPT.md Phase 7 item 1): send.service.ts is the only
// code path that calls Twilio's send API (CLAUDE.md rule 5), and must space sends out
// rather than firing them at full speed to respect Twilio/WhatsApp's outbound rate
// tiers. Kept in its own file (not tests/messaging/send.service.test.ts) so each test
// can start from a fresh module instance via vi.resetModules() — the throttle's
// "next allowed slot" state is module-level and would otherwise leak between tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { sendMessage as SendMessageFn } from '../../src/messaging/send.service';

const createMessageMock = vi.fn();
vi.mock('../../src/messaging/twilio.client', () => ({
  twilioClient: { messages: { create: createMessageMock } },
}));

const prismaMessageCreateMock = vi.fn().mockResolvedValue({});
vi.mock('../../src/db/client', () => ({
  prisma: { message: { create: prismaMessageCreateMock } },
}));

async function freshSendMessage(): Promise<typeof SendMessageFn> {
  vi.resetModules();
  const mod = await import('../../src/messaging/send.service');
  return mod.sendMessage;
}

beforeEach(() => {
  createMessageMock.mockReset();
  prismaMessageCreateMock.mockClear();
  vi.useFakeTimers();
});

describe('sendMessage — outbound throttle', () => {
  it('spaces two consecutive sends by at least the minimum interval, not fire-and-forget', async () => {
    createMessageMock.mockResolvedValue({ sid: 'SM1', status: 'queued' });
    const sendMessage = await freshSendMessage();

    const first = sendMessage({ to: '+2348011111111', body: 'first' });
    await vi.advanceTimersByTimeAsync(0);
    expect(createMessageMock).toHaveBeenCalledTimes(1);

    const second = sendMessage({ to: '+2348011111111', body: 'second' });
    await vi.advanceTimersByTimeAsync(0);
    // The second send must not have gone out yet — it's waiting for its slot.
    expect(createMessageMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(createMessageMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(createMessageMock).toHaveBeenCalledTimes(2);

    await Promise.all([first, second]);
  });

  it('does not delay a send that arrives well after the previous slot', async () => {
    createMessageMock.mockResolvedValue({ sid: 'SM1', status: 'queued' });
    const sendMessage = await freshSendMessage();

    await sendMessage({ to: '+2348011111111', body: 'first' });
    await vi.advanceTimersByTimeAsync(5000);

    await sendMessage({ to: '+2348011111111', body: 'second, much later' });
    await vi.advanceTimersByTimeAsync(0);

    expect(createMessageMock).toHaveBeenCalledTimes(2);
  });
});
