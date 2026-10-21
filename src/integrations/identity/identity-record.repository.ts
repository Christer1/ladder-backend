import { Injectable } from '@nestjs/common';
import { IdentityRecord, VerificationType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class IdentityRecordRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByNumber(type: VerificationType, number: string): Promise<IdentityRecord | null> {
    return this.prisma.identityRecord.findUnique({ where: { type_number: { type, number } } });
  }
}
