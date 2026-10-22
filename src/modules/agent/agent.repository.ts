import { Injectable } from '@nestjs/common';
import {
  AssistanceIssue,
  AssistanceIssueNote,
  AssistanceIssueStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type IssueWithNotes = AssistanceIssue & { notes: AssistanceIssueNote[] };

@Injectable()
export class AgentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listIssues(
    where: Prisma.AssistanceIssueWhereInput,
    skip: number,
    take: number,
  ): Promise<{ items: AssistanceIssue[]; total: number }> {
    // Not a transaction: BEGIN/COMMIT would add two round trips to a dashboard poll, and a count
    // that is a moment out of step with the page is fine.
    const [items, total] = await Promise.all([
      this.prisma.assistanceIssue.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.assistanceIssue.count({ where }),
    ]);
    return { items, total };
  }

  async countByStatus(): Promise<Partial<Record<AssistanceIssueStatus, number>>> {
    const rows = await this.prisma.assistanceIssue.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  }

  countResolvedSince(since: Date): Promise<number> {
    return this.prisma.assistanceIssue.count({
      where: { status: AssistanceIssueStatus.RESOLVED, resolvedAt: { gte: since } },
    });
  }

  findIssue(reference: string): Promise<IssueWithNotes | null> {
    return this.prisma.assistanceIssue.findUnique({
      where: { reference },
      include: { notes: { orderBy: { createdAt: 'desc' } } },
    });
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

  // Resolved issues free their details: the next failed attempt with them logs a new issue.
  async resolve(id: string, resolvedBy: string): Promise<boolean> {
    const { count } = await this.prisma.assistanceIssue.updateMany({
      where: { id, status: { not: AssistanceIssueStatus.RESOLVED } },
      data: {
        status: AssistanceIssueStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedBy,
        openFingerprint: null,
      },
    });
    return count === 1;
  }

  // Also bumps the issue's updatedAt, so the case moves to the top of the list.
  async addNote(issueId: string, text: string, authorName: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.assistanceIssueNote.create({ data: { issueId, text, authorName } }),
      this.prisma.assistanceIssue.update({
        where: { id: issueId },
        data: { updatedAt: new Date() },
      }),
    ]);
  }

  async touch(issueId: string): Promise<void> {
    await this.prisma.assistanceIssue.update({
      where: { id: issueId },
      data: { updatedAt: new Date() },
    });
  }
}
