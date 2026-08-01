-- Optional Twilio Auth Token (encrypted) used to verify inbound TwiML
-- webhook signatures (X-Twilio-Signature).
ALTER TABLE "VoiceConfig" ADD COLUMN "twilioAuthToken" TEXT;
