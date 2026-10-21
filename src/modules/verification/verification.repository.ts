import { Injectable } from '@nestjs/common';
import { Document, Prisma, Verification, VerificationType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type VerificationData = Omit<
  Prisma.VerificationUncheckedCreateInput,
  'id' | 'userId' | 'type' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class VerificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllByUser(userId: string): Promise<Verification[]> {
    return this.prisma.verification.findMany({ where: { userId } });
  }

  findOne(userId: string, type: VerificationType): Promise<Verification | null> {
    return this.prisma.verification.findUnique({ where: { userId_type: { userId, type } } });
  }

  // One row per (user, type); a retry overwrites the previous attempt.
  upsert(userId: string, type: VerificationType, data: VerificationData): Promise<Verification> {
    return this.prisma.verification.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type, ...data },
      update: data,
    });
  }

  createDocument(data: Prisma.DocumentUncheckedCreateInput): Promise<Document> {
    return this.prisma.document.create({ data });
  }
}
