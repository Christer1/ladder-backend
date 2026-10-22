import { DeliveryStatus } from '@prisma/client';

// Pure helpers for Infobip's WhatsApp JSON. No network calls, so they are unit-tested.

// Infobip takes international numbers without "+": +2348150990267 → 2348150990267.
export const toInfobipNumber = (e164: string): string => e164.replace(/^\+/, '');

// Infobip sends numbers without "+". Non-numeric business-scoped user IDs are not phones.
export function fromInfobipNumber(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\+?\d{7,15}$/.test(value)) return null;
  return value.startsWith('+') ? value : `+${value}`;
}

// Infobip status groups: PENDING, DELIVERED, UNDELIVERABLE, EXPIRED, REJECTED.
export function mapInfobipStatus(groupName: string | undefined): DeliveryStatus {
  switch ((groupName ?? '').toUpperCase()) {
    case 'DELIVERED':
      return DeliveryStatus.DELIVERED;
    case 'UNDELIVERABLE':
    case 'EXPIRED':
    case 'REJECTED':
      return DeliveryStatus.FAILED;
    case 'PENDING':
      return DeliveryStatus.SENT;
    default:
      return DeliveryStatus.QUEUED;
  }
}

export interface InfobipReport {
  messageId: string;
  status: DeliveryStatus;
  errorCode?: string;
}

interface InfobipStatus {
  groupName?: string;
  name?: string;
}

// Delivery and seen reports: { results: [{ messageId, status: { groupName }, error, seenAt? }] }
export function parseReports(body: unknown): InfobipReport[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];

  const reports: InfobipReport[] = [];
  for (const item of results) {
    const r = (item ?? {}) as {
      messageId?: string;
      status?: InfobipStatus;
      error?: { name?: string };
      seenAt?: string;
    };
    if (!r.messageId) continue;
    if (r.seenAt && !r.status) {
      reports.push({ messageId: r.messageId, status: DeliveryStatus.READ });
      continue;
    }
    const status = mapInfobipStatus(r.status?.groupName);
    const errorName = r.error?.name && r.error.name !== 'NO_ERROR' ? r.error.name : r.status?.name;
    reports.push({
      messageId: r.messageId,
      status,
      ...(status === DeliveryStatus.FAILED && errorName && { errorCode: errorName }),
    });
  }
  return reports;
}

export interface InfobipInbound {
  messageId: string;
  fromPhone: string;
  text: string;
}

// What the customer typed or tapped, across Infobip's shapes (text, buttons, interactive replies).
function extractText(r: Record<string, unknown>): string | null {
  const message = (r.message ?? {}) as Record<string, unknown>;
  const content = (message.content ?? {}) as Record<string, unknown>;
  const candidates = [
    message.text,
    content.text,
    message.title,
    message.payload,
    r.cleanText,
    r.text,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

// Inbound messages: { results: [{ from, to, messageId, message: { type, text } }] }
// Images and voice notes get a placeholder so the chat still records them.
export function parseInbound(body: unknown): InfobipInbound[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];

  const inbound: InfobipInbound[] = [];
  for (const item of results) {
    const r = (item ?? {}) as Record<string, unknown>;
    const messageId = typeof r.messageId === 'string' ? r.messageId : null;
    const fromPhone = fromInfobipNumber(r.from);
    if (!messageId || !fromPhone) continue;
    const type = String((r.message as { type?: string } | undefined)?.type ?? 'TEXT');
    inbound.push({
      messageId,
      fromPhone,
      text: extractText(r) ?? `[${type.toLowerCase()} message received]`,
    });
  }
  return inbound;
}
