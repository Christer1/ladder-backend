import { Injectable } from '@nestjs/common';
import { AssistanceIssue, DeliveryStatus, Prisma, WhatsAppMessage } from '@prisma/client';
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
