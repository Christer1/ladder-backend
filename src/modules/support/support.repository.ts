import { Injectable } from '@nestjs/common';
import {
  AssistanceIssue,
  AssistanceIssueStatus,
  DeliveryStatus,
  Prisma,
  WhatsAppMessage,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SupportRepository {
  constructor(private readonly prisma: PrismaService) {}

  createIssue(data: Prisma.AssistanceIssueUncheckedCreateInput): Promise<AssistanceIssue> {
    return this.prisma.assistanceIssue.create({ data });
  }

  findIssueByReference(reference: string): Promise<AssistanceIssue | null> {
    return this.prisma.assistanceIssue.findUnique({ where: { reference } });
  }

  findIssueByOpenFingerprint(openFingerprint: string): Promise<AssistanceIssue | null> {
    return this.prisma.assistanceIssue.findUnique({ where: { openFingerprint } });
  }

  // One more failed identify with the same details.
  recordAttempt(
    id: string,
    data: { expiresAt: Date; status?: AssistanceIssueStatus },
  ): Promise<AssistanceIssue> {
    return this.prisma.assistanceIssue.update({
      where: { id },
      data: { ...data, attempts: { increment: 1 }, lastAttemptAt: new Date() },
    });
  }

  releaseOpenFingerprint(id: string): Promise<AssistanceIssue> {
    return this.prisma.assistanceIssue.update({ where: { id }, data: { openFingerprint: null } });
  }

  // Sets the status only if the issue is currently in one of `from`. False if it wasn't.
  async updateStatus(
    id: string,
    status: AssistanceIssueStatus,
    from: AssistanceIssueStatus[],
  ): Promise<boolean> {
    const { count } = await this.prisma.assistanceIssue.updateMany({
      where: { id, status: { in: from } },
      data: { status },
    });
    return count === 1;
  }

  async resolveByIdFingerprints(idFingerprints: string[], resolvedBy: string): Promise<number> {
    const { count } = await this.prisma.assistanceIssue.updateMany({
      where: {
        idFingerprint: { in: idFingerprints },
        status: { not: AssistanceIssueStatus.RESOLVED },
      },
      data: {
        status: AssistanceIssueStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedBy,
        openFingerprint: null,
      },
    });
    return count;
  }

  // Claims an unclaimed, unexpired issue for a phone. False if someone else got there first.
  async claimIssue(id: string, phone: string): Promise<boolean> {
    const { count } = await this.prisma.assistanceIssue.updateMany({
      where: { id, contactPhone: null, expiresAt: { gt: new Date() } },
      data: { contactPhone: phone },
    });
    return count === 1;
  }

  // The issue this phone most recently wrote about, for follow-ups without the reference.
  findLatestIssueForPhone(phone: string, since: Date): Promise<AssistanceIssue | null> {
    return this.prisma.assistanceIssue.findFirst({
      where: { contactPhone: phone, updatedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  setPreferredLanguage(id: string, preferredLanguage: string): Promise<AssistanceIssue> {
    return this.prisma.assistanceIssue.update({ where: { id }, data: { preferredLanguage } });
  }

  touchIssue(id: string): Promise<AssistanceIssue> {
    return this.prisma.assistanceIssue.update({ where: { id }, data: { updatedAt: new Date() } });
  }

  createMessage(data: Prisma.WhatsAppMessageUncheckedCreateInput): Promise<WhatsAppMessage> {
    return this.prisma.whatsAppMessage.create({ data });
  }

  updateMessage(
    id: string,
    data: Prisma.WhatsAppMessageUncheckedUpdateInput,
  ): Promise<WhatsAppMessage> {
    return this.prisma.whatsAppMessage.update({ where: { id }, data });
  }

  findMessageByProviderId(providerMessageId: string): Promise<WhatsAppMessage | null> {
    return this.prisma.whatsAppMessage.findUnique({ where: { providerMessageId } });
  }

  updateMessageStatus(
    id: string,
    status: DeliveryStatus,
    errorCode?: string,
  ): Promise<WhatsAppMessage> {
    return this.prisma.whatsAppMessage.update({
      where: { id },
      data: { status, ...(errorCode && { errorCode }) },
    });
  }

  // Latest messages with this phone, oldest first, for the AI's view of the conversation.
  async recentMessages(phone: string, since: Date, take: number): Promise<WhatsAppMessage[]> {
    const latest = await this.prisma.whatsAppMessage.findMany({
      where: { phone, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return latest.reverse();
  }
}
