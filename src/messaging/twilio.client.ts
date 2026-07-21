import twilio from 'twilio';
import { env } from '../config/env';

// Single Twilio SDK client instance, used only by send.service.ts (CLAUDE.md rule 5).
export const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
