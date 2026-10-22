import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AssistanceIssue,
  AssistanceIssueReason,
  AssistanceMethod,
  DeliveryStatus,
  MessageDirection,
  Prisma,
  VerificationType,
} from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { randomBlock } from '../../common/utils/ladder-id';
import { last4, maskLast4 } from '../../common/utils/mask';
import {
  HELP_CHAT_TTL_DAYS,
  HELP_REFERENCE_TTL_HOURS,
  HELP_TRANSCRIPT_MESSAGES,
} from '../../config/app.config';
import { EnvironmentVariables } from '../../config/env.validation';
import { InfobipInbound, InfobipReport } from '../../integrations/whatsapp/infobip.mapping';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from '../../integrations/whatsapp/whatsapp.provider';
import { HelpChatAgent } from './help-chat.agent';
import { issueContext, partnerName } from './help-chat.context';
import { helpChatOpener, toTranscript } from './help-chat.prompts';
import { SupportRepository } from './support.repository';
import { maskLongNumbers } from './validate-reply';

type IdType = typeof VerificationType.BVN | typeof VerificationType.NIN;

export interface NewAssistanceIssue {
  partnerId: string;
  method: AssistanceMethod;
  // BVN or NIN when one of them failed; null for Ladder IDs.
  failedType: IdType | null;
  reason: AssistanceIssueReason;
  // What the customer typed. Only its last 4 characters are stored.
  enteredValue: string;
}

// Returned to the partner screen beside the error: the Get Help button opens whatsappUrl.
export interface AssistanceHelp {
  helpReference: string;
  whatsappUrl: string;
}

type ReferenceProblem = 'not_found' | 'expired' | 'used_by_another_phone';

interface ResolvedIssue {
  issue: AssistanceIssue | null;
  // True when this message claimed the issue: Ladder answers with its opening message.
  claimed?: boolean;
  referenceProblem?: ReferenceProblem;
}

const REFERENCE_PATTERN = /\bLDR-([2-9A-HJKMNP-Z]{6})\b/i;
const REFERENCE_MAX_TRIES = 5;
const DAY_MS = 86_400_000;

const REFERENCE_PROBLEMS: Record<ReferenceProblem, string> = {
  not_found: 'No issue has this reference. It may have been mistyped.',
  expired: 'This reference is more than a day old and can no longer be used.',
  used_by_another_phone: 'This reference is already being used in a chat from another phone.',
};

// Later statuses win: a late "sent" report must not overwrite "delivered".
const STATUS_RANK: Record<DeliveryStatus, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  RECEIVED: 3,
  FAILED: 4,
};

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

// WhatsApp help for failed assistance identifies. The partner screen gets a reference and a wa.me
// link; the customer's message arrives through the Infobip webhook and the AI explains the issue.
@Injectable()
export class SupportService {
  constructor(
    private readonly supportRepository: SupportRepository,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly agent: HelpChatAgent,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsApp: WhatsAppProvider,
  ) {}

  async openIssue(input: NewAssistanceIssue): Promise<AssistanceHelp> {
    const expiresAt = new Date(Date.now() + HELP_REFERENCE_TTL_HOURS * 3_600_000);

    for (let attempt = 0; attempt < REFERENCE_MAX_TRIES; attempt++) {
      try {
        const issue = await this.supportRepository.createIssue({
          reference: `LDR-${randomBlock(6)}`,
          partnerId: input.partnerId,
          method: input.method,
          failedType: input.failedType,
          reason: input.reason,
          maskedValue: maskLast4(last4(input.enteredValue), input.enteredValue.length),
          expiresAt,
        });
        return { helpReference: issue.reference, whatsappUrl: this.whatsAppUrl(issue.reference) };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new AppError('INTERNAL_ERROR');
  }

  // One customer message from the webhook: store it, find the issue it is about, reply. The message
  // that claims an issue gets Ladder's opening message (which language?); the AI answers the rest.
  async handleInbound(inbound: InfobipInbound): Promise<void> {
    const text = maskLongNumbers(inbound.text);
    let messageId: string;
    try {
      const message = await this.supportRepository.createMessage({
        direction: MessageDirection.INBOUND,
        phone: inbound.fromPhone,
        body: text,
        providerMessageId: inbound.messageId,
        status: DeliveryStatus.RECEIVED,
      });
      messageId = message.id;
    } catch (error) {
      if (isUniqueViolation(error)) return; // Infobip delivered it again
      throw error;
    }

    const { issue, claimed, referenceProblem } = await this.resolveIssue(inbound.fromPhone, text);
    if (issue) {
      await this.supportRepository.updateMessage(messageId, { issueId: issue.id });
      await this.supportRepository.touchIssue(issue.id);
    }
    if (issue && claimed) {
      await this.send(inbound.fromPhone, helpChatOpener(partnerName(issue.partnerId)), issue.id);
      return;
    }

    const history = await this.supportRepository.recentMessages(
      inbound.fromPhone,
      new Date(Date.now() - DAY_MS),
      HELP_TRANSCRIPT_MESSAGES + 1,
    );
    const transcript = toTranscript(history.filter((m) => m.id !== messageId));
    const reply = await this.writeReply(issue, referenceProblem, transcript, text);
    await this.send(inbound.fromPhone, reply, issue?.id ?? null);
  }

  async handleReports(reports: InfobipReport[]): Promise<void> {
    for (const report of reports) {
      const message = await this.supportRepository.findMessageByProviderId(report.messageId);
      if (!message || STATUS_RANK[report.status] < STATUS_RANK[message.status]) continue;
      await this.supportRepository.updateMessageStatus(message.id, report.status, report.errorCode);
    }
  }

  private whatsAppUrl(reference: string): string {
    const sender = this.config.get('INFOBIP_WHATSAPP_SENDER', { infer: true });
    const text = `Hi Ladder, I need help with my account opening. Ref: ${reference}`;
    return `https://wa.me/${sender}?text=${encodeURIComponent(text)}`;
  }

  // A reference in the message claims or reopens that issue; otherwise the phone's latest one.
  private async resolveIssue(phone: string, text: string): Promise<ResolvedIssue> {
    const match = REFERENCE_PATTERN.exec(text);
    if (!match) {
      const since = new Date(Date.now() - HELP_CHAT_TTL_DAYS * DAY_MS);
      return { issue: await this.supportRepository.findLatestIssueForPhone(phone, since) };
    }

    const issue = await this.supportRepository.findIssueByReference(
      `LDR-${match[1].toUpperCase()}`,
    );
    if (!issue) return { issue: null, referenceProblem: 'not_found' };
    if (issue.contactPhone === phone) return { issue };
    if (!issue.contactPhone && (await this.supportRepository.claimIssue(issue.id, phone))) {
      return { issue: { ...issue, contactPhone: phone }, claimed: true };
    }
    return {
      issue: null,
      referenceProblem:
        issue.contactPhone || issue.expiresAt > new Date() ? 'used_by_another_phone' : 'expired',
    };
  }

  private async writeReply(
    issue: AssistanceIssue | null,
    referenceProblem: ReferenceProblem | undefined,
    transcript: ReturnType<typeof toTranscript>,
    text: string,
  ): Promise<string> {
    const context = issue && issueContext(issue, issue.preferredLanguage);
    const { reply, preferredLanguage } = await this.agent.reply({
      channel: 'whatsapp',
      data:
        context?.data ??
        (referenceProblem ? { reference_problem: REFERENCE_PROBLEMS[referenceProblem] } : null),
      transcript,
      text,
      fallback: context?.fallback ?? fixedNoIssueReply(referenceProblem),
    });
    if (issue && preferredLanguage && preferredLanguage !== issue.preferredLanguage) {
      await this.supportRepository.setPreferredLanguage(issue.id, preferredLanguage);
    }
    return reply;
  }

  private async send(phone: string, body: string, issueId: string | null): Promise<void> {
    const message = await this.supportRepository.createMessage({
      direction: MessageDirection.OUTBOUND,
      phone,
      body,
      issueId,
      status: DeliveryStatus.QUEUED,
    });
    try {
      const result = await this.whatsApp.sendText(phone, body);
      await this.supportRepository.updateMessage(message.id, {
        providerMessageId: result.providerMessageId,
        status: result.status,
      });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      await this.supportRepository.updateMessageStatus(
        message.id,
        DeliveryStatus.FAILED,
        error.code,
      );
    }
  }
}

// Sent when the AI can't answer and the message names no usable issue.
function fixedNoIssueReply(referenceProblem: ReferenceProblem | undefined): string {
  const problem = referenceProblem ? `${REFERENCE_PROBLEMS[referenceProblem]} ` : '';
  return `Hi, this is Ladder. ${problem}Please send the reference shown on the account opening screen (it looks like LDR-XXXXXX) so we can see what went wrong. If you don't have one, try the account opening screen again and tap "Chat with us on WhatsApp".`;
}
