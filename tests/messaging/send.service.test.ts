import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { sendMessage as SendMessageFn } from '../../src/messaging/send.service';

const createMessageMock = vi.fn();
vi.mock('../../src/messaging/twilio.client', () => ({
  twilioClient: { messages: { create: createMessageMock } },
}));

const prismaMessageCreateMock = vi.fn().mockResolvedValue({});
vi.mock('../../src/db/client', () => ({
  prisma: { message: { create: prismaMessageCreateMock } },
}));

// send.service backs off with real setTimeout delays — fake timers keep the test fast
// and deterministic instead of actually waiting.
vi.useFakeTimers();

let sendMessage: typeof SendMessageFn;

beforeAll(async () => {
  ({ sendMessage } = await import('../../src/messaging/send.service'));
});

function twilioError(overrides: { status?: number; code?: number; message?: string }) {
  return Object.assign(new Error(overrides.message ?? 'twilio error'), overrides);
}

async function runAndFlush<T>(promise: Promise<T>): Promise<T> {
  const result = promise;
  await vi.runAllTimersAsync();
  return result;
}

beforeEach(() => {
  createMessageMock.mockReset();
  prismaMessageCreateMock.mockClear();
});

describe('sendMessage — WhatsApp template (contentSid) path', () => {
  it('sends via the Content API (contentSid + contentVariables) when contentSid is provided, not free text', async () => {
    createMessageMock.mockResolvedValueOnce({ sid: 'SM789', status: 'queued' });

    await runAndFlush(
      sendMessage({
        to: '+2348011111111',
        body: 'fallback text, should not be used',
        contentSid: 'HXtemplate123',
        contentVariables: { '1': 'WM-042' },
      }),
    );

    expect(createMessageMock).toHaveBeenCalledWith({
      from: expect.any(String),
      to: 'whatsapp:+2348011111111',
      contentSid: 'HXtemplate123',
      contentVariables: JSON.stringify({ '1': 'WM-042' }),
    });
    // No `body` key at all on the Content API path — confirms the free-text fallback
    // text genuinely isn't sent alongside the template.
    expect(createMessageMock.mock.calls[0]?.[0]).not.toHaveProperty('body');
  });

  it('falls back to free text (body, no contentSid) when contentSid is not provided', async () => {
    createMessageMock.mockResolvedValueOnce({ sid: 'SM790', status: 'queued' });

    await runAndFlush(sendMessage({ to: '+2348011111111', body: 'plain text message' }));

    expect(createMessageMock).toHaveBeenCalledWith({
      from: expect.any(String),
      to: 'whatsapp:+2348011111111',
      body: 'plain text message',
    });
    expect(createMessageMock.mock.calls[0]?.[0]).not.toHaveProperty('contentSid');
  });
});

describe('sendMessage', () => {
  it('sends successfully on the first attempt and logs the outbound message', async () => {
    createMessageMock.mockResolvedValueOnce({ sid: 'SM123', status: 'queued' });

    const result = await runAndFlush(sendMessage({ to: '+2348011111111', body: 'hi' }));

    expect(result).toEqual({ status: 'sent', twilioSid: 'SM123' });
    expect(createMessageMock).toHaveBeenCalledTimes(1);
    expect(prismaMessageCreateMock).toHaveBeenCalledWith({
      data: {
        twilioSid: 'SM123',
        direction: 'outbound',
        phoneNumber: '+2348011111111',
        body: 'hi',
        status: 'queued',
      },
    });
  });

  it('retries a transient 5xx error and succeeds on a later attempt, without exceeding the retry budget', async () => {
    createMessageMock
      .mockRejectedValueOnce(twilioError({ status: 503 }))
      .mockRejectedValueOnce(twilioError({ status: 429 }))
      .mockResolvedValueOnce({ sid: 'SM456', status: 'sent' });

    const result = await runAndFlush(sendMessage({ to: '+2348011111111', body: 'retry me' }));

    expect(result).toEqual({ status: 'sent', twilioSid: 'SM456' });
    expect(createMessageMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a permanent error (invalid number) and logs it as failed', async () => {
    createMessageMock.mockRejectedValueOnce(twilioError({ status: 400, code: 21211 }));

    const result = await runAndFlush(sendMessage({ to: '+2348011111111', body: 'bad number' }));

    expect(result).toEqual({ status: 'failed' });
    expect(createMessageMock).toHaveBeenCalledTimes(1);
    expect(prismaMessageCreateMock).toHaveBeenCalledWith({
      data: { direction: 'outbound', phoneNumber: '+2348011111111', body: 'bad number', status: 'failed' },
    });
  });

  it('does not retry an opted-out recipient', async () => {
    createMessageMock.mockRejectedValueOnce(twilioError({ status: 400, code: 21610 }));

    const result = await runAndFlush(sendMessage({ to: '+2348011111111', body: 'opted out' }));

    expect(result).toEqual({ status: 'failed' });
    expect(createMessageMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting retries on persistent transient failures', async () => {
    createMessageMock.mockRejectedValue(twilioError({ status: 500 }));

    const result = await runAndFlush(sendMessage({ to: '+2348011111111', body: 'always fails' }));

    expect(result).toEqual({ status: 'failed' });
    expect(createMessageMock).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });
});
