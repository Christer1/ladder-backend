import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const withVerifications = { verifications: true } satisfies Prisma.UserInclude;
export type UserWithVerifications = Prisma.UserGetPayload<{ include: typeof withVerifications }>;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByIdWithVerifications(id: string): Promise<UserWithVerifications | null> {
    return this.prisma.user.findUnique({ where: { id }, include: withVerifications });
  }

  upsertByEmail(email: string, dateOfBirth: Date): Promise<User> {
    return this.prisma.user.upsert({
      where: { email },
      create: { email, dateOfBirth },
      update: { dateOfBirth },
    });
  }

  update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }
}
