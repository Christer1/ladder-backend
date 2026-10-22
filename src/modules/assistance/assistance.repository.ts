import { Injectable } from '@nestjs/common';
import { AssistanceSession, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AssistanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  createSession(data: Prisma.AssistanceSessionUncheckedCreateInput): Promise<AssistanceSession> {
    return this.prisma.assistanceSession.create({ data });
  }

  findSessionByTokenHash(tokenHash: string): Promise<AssistanceSession | null> {
    return this.prisma.assistanceSession.findUnique({ where: { tokenHash } });
  }

  updateSession(id: string, data: Prisma.AssistanceSessionUpdateInput): Promise<AssistanceSession> {
    return this.prisma.assistanceSession.update({ where: { id }, data });
  }
}
