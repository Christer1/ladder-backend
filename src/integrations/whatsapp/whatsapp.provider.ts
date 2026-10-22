import { DeliveryStatus } from '@prisma/client';

// Contract every WhatsApp adapter implements. Services depend on this, never on a vendor API.
export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

export interface WhatsAppSendResult {
  providerMessageId: string;
  status: DeliveryStatus;
}

export interface WhatsAppProvider {
  readonly name: string;
  // to: E.164, e.g. +2348012345678. Free-form text: only within 24 hours of the customer's message.
  sendText(to: string, body: string): Promise<WhatsAppSendResult>;
}
