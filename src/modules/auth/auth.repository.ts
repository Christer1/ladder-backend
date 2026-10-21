import { Injectable } from '@nestjs/common';
import { Otp, OtpPurpose, Session } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findLatestOtp(email: string, purpose: OtpPurpose): Promise<Otp | null> {
    return this.prisma.otp.findFirst({
      where: { email, purpose },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Issuing a new code invalidates any older unused code for the same email.
  async replaceOtp(data: {
    email: string;
    purpose: OtpPurpose;
    codeHash: string;
    expiresAt: Date;
  }): Promise<Otp> {
    const [, otp] = await this.prisma.$transaction([
      this.prisma.otp.updateMany({
        where: { email: data.email, purpose: data.purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.otp.create({ data }),
    ]);
    return otp;
  }

  incrementOtpAttempts(id: string): Promise<Otp> {
    return this.prisma.otp.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }

  consumeOtp(id: string): Promise<Otp> {
    return this.prisma.otp.update({ where: { id }, data: { consumedAt: new Date() } });
  }

  createSession(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<Session> {
    return this.prisma.session.create({ data });
  }

  findSessionByTokenHash(tokenHash: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { tokenHash } });
  }

  revokeSession(id: string): Promise<Session> {
    return this.prisma.session.update({ where: { id }, data: { revokedAt: new Date() } });
  }
}
