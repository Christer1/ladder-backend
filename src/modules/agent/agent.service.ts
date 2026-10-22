import { Injectable } from '@nestjs/common';
import {
  AssistanceIssue,
  AssistanceIssueReason,
  AssistanceIssueStatus,
  AssistanceMethod,
  Prisma,
  VerificationType,
} from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import {
  AGENT_CASES_PAGE_SIZE,
  AGENT_INSIGHT_DAYS,
  AGENT_NAME,
  AGENT_ROLE,
  AGENT_TIMEZONE_OFFSET_HOURS,
} from '../../config/app.config';
import { issueContext, partnerName } from '../support/help-chat.context';
import { issueGuidance } from '../support/help-chat.knowledge';
import { WebChatService } from '../support/web-chat.service';
import { AgentRepository, IssueWithNotes } from './agent.repository';
import {
  AgentProfile,
  CaseDetail,
  CaseInsights,
  CaseListItem,
  CaseListPage,
  CaseStage,
  CaseSummary,
} from './dto/agent.response';
import { ListCasesQuery } from './dto/list-cases.query';

type IdType = typeof VerificationType.BVN | typeof VerificationType.NIN;

const REASON_TITLES: Record<AssistanceIssueReason, (id: string) => string> = {
  NOT_FOUND: (id) => `${id} not found`,
  INVALID: (id) => `${id} not valid`,
  DOB_MISMATCH: () => 'Date of birth mismatch',
  DIFFERENT_PEOPLE: () => 'BVN/NIN name mismatch',
  LADDER_ID_UNKNOWN: () => 'Ladder ID not found',
  LADDER_ID_NOT_VERIFIED: () => 'Ladder ID not verified',
};

const METHOD_LABELS: Record<AssistanceMethod, string> = {
  BVN: 'BVN',
  NIN: 'NIN',
  BVN_AND_NIN: 'BVN and NIN',
  LADDER_ID: 'Ladder ID',
};

// Statuses an agent can still act on.
const ACTIVE: AssistanceIssueStatus[] = [
  AssistanceIssueStatus.OPEN,
  AssistanceIssueStatus.IN_CHAT,
  AssistanceIssueStatus.NEEDS_ATTENTION,
];

// Help issues (failed identifies on partner screens) as recovery cases for ladder-agent-dashboard:
// list them, read the help chat, reply in it (taking it over from the AI), escalate and resolve.
@Injectable()
export class AgentService {
  constructor(
    private readonly agentRepository: AgentRepository,
    private readonly webChatService: WebChatService,
  ) {}

  // No agent sign-in yet: every agent is AGENT_NAME.
  getProfile(): AgentProfile {
    return { fullName: AGENT_NAME, role: AGENT_ROLE };
  }

  async listCases(query: ListCasesQuery): Promise<CaseListPage> {
    const where: Prisma.AssistanceIssueWhereInput = {
      ...(query.status && {
        status:
          query.status === 'IN_PROGRESS'
            ? { in: [AssistanceIssueStatus.OPEN, AssistanceIssueStatus.IN_CHAT] }
            : query.status,
      }),
      ...(query.search && { OR: searchFilters(query.search) }),
    };
    const pageSize = AGENT_CASES_PAGE_SIZE;
    const { items, total } = await this.agentRepository.listIssues(
      where,
      (query.page - 1) * pageSize,
      pageSize,
    );
    return { items: items.map(toListItem), page: query.page, pageSize, total };
  }

  async getSummary(): Promise<CaseSummary> {
    const [counts, resolvedToday] = await Promise.all([
      this.agentRepository.countByStatus(),
      this.agentRepository.countResolvedSince(startOfToday()),
    ]);
    const count = (status: AssistanceIssueStatus) => counts[status] ?? 0;
    return {
      inProgress: count('OPEN') + count('IN_CHAT'),
      needsAttention: count('NEEDS_ATTENTION'),
      resolvedToday,
      total: Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0),
    };
  }

  async getInsights(): Promise<CaseInsights> {
    const today = startOfToday();
    const dates = Array.from({ length: AGENT_INSIGHT_DAYS }, (_, i) =>
      lagosDate(new Date(today.getTime() - (AGENT_INSIGHT_DAYS - 1 - i) * DAY_MS)),
    );
    const since = new Date(today.getTime() - (AGENT_INSIGHT_DAYS - 1) * DAY_MS);
    const { logged, resolved } = await this.agentRepository.findActivitySince(since);

    const countBy = (keys: string[]) =>
      keys.reduce<Record<string, number>>(
        (acc, key) => ({ ...acc, [key]: (acc[key] ?? 0) + 1 }),
        {},
      );
    const loggedPerDay = countBy(logged.map((i) => lagosDate(i.createdAt)));
    const resolvedPerDay = countBy(resolved.map((i) => lagosDate(i.resolvedAt as Date)));
    const perIssue = countBy(
      logged.map((i) => REASON_TITLES[i.reason](i.failedType ?? 'Ladder ID')),
    );

    return {
      days: dates.map((date) => ({
        date,
        logged: loggedPerDay[date] ?? 0,
        resolved: resolvedPerDay[date] ?? 0,
      })),
      issues: Object.entries(perIssue)
        .map(([title, count]) => ({ title, count }))
        .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)),
    };
  }

  async getCase(reference: string): Promise<CaseDetail> {
    const issue = await this.findCase(reference);
    const chat = await this.webChatService.getChat(issue.reference);
    const guidance = issueGuidance(issue.reason, issue.failedType as IdType | null);

    return {
      ...toListItem(issue),
      method: METHOD_LABELS[issue.method],
      createdAt: issue.createdAt.toISOString(),
      lastAttemptAt: issue.lastAttemptAt.toISOString(),
      resolvedAt: issue.resolvedAt?.toISOString() ?? null,
      resolvedBy: issue.resolvedBy,
      stages: stagesFor(issue.status),
      guidance: guidance.howToFix,
      officeVisits: Object.entries(guidance.officeVisits ?? {}).map(([id, visit]) => ({
        id,
        ...visit,
      })),
      chat: chat && {
        mode: chat.chat.mode,
        agentName: chat.chat.agentName,
        preferredLanguage: chat.chat.preferredLanguage,
        messages: chat.messages.map((m) => ({
          id: m.id,
          sender: m.sender,
          text: m.text,
          agentName: m.agentName,
          createdAt: m.createdAt.toISOString(),
        })),
      },
      notes: issue.notes.map((note) => ({
        id: note.id,
        text: note.text,
        authorName: note.authorName,
        createdAt: note.createdAt.toISOString(),
      })),
    };
  }

  // Posts the fixed explanation (what went wrong, how to fix it, what to bring) into the chat.
  async sendInstructions(reference: string): Promise<CaseDetail> {
    const issue = await this.findOpenCase(reference);
    await this.webChatService.postLadderMessage(
      issue.reference,
      issueContext(issue, null).fallback,
    );
    await this.agentRepository.touch(issue.id);
    return this.getCase(reference);
  }

  // The agent answers the customer and takes the chat over from the AI.
  async replyInChat(reference: string, text: string): Promise<CaseDetail> {
    const issue = await this.findOpenCase(reference);
    await this.webChatService.postAgentMessage(issue.reference, AGENT_NAME, text);
    // Answered: the customer is no longer waiting. A status change also moves updatedAt.
    const changed = await this.agentRepository.updateStatus(
      issue.id,
      AssistanceIssueStatus.IN_CHAT,
      [AssistanceIssueStatus.OPEN, AssistanceIssueStatus.NEEDS_ATTENTION],
    );
    if (!changed) await this.agentRepository.touch(issue.id);
    return this.getCase(reference);
  }

  async handBackToAi(reference: string): Promise<CaseDetail> {
    const issue = await this.findCase(reference);
    await this.webChatService.handBackToAi(issue.reference);
    await this.agentRepository.touch(issue.id);
    return this.getCase(reference);
  }

  async escalate(reference: string): Promise<CaseDetail> {
    const issue = await this.findCase(reference);
    if (!(await this.agentRepository.updateStatus(issue.id, 'ESCALATED', ACTIVE))) {
      throw new AppError('CASE_NOT_ESCALATABLE');
    }
    return this.getCase(reference);
  }

  async resolve(reference: string): Promise<CaseDetail> {
    const issue = await this.findCase(reference);
    if (!(await this.agentRepository.resolve(issue.id, AGENT_NAME))) {
      throw new AppError('CASE_RESOLVED');
    }
    return this.getCase(reference);
  }

  async addNote(reference: string, text: string): Promise<CaseDetail> {
    const issue = await this.findCase(reference);
    await this.agentRepository.addNote(issue.id, text, AGENT_NAME);
    return this.getCase(reference);
  }

  private async findCase(reference: string): Promise<IssueWithNotes> {
    const issue = await this.agentRepository.findIssue(reference.toUpperCase());
    if (!issue) throw new AppError('CASE_NOT_FOUND');
    return issue;
  }

  private async findOpenCase(reference: string): Promise<IssueWithNotes> {
    const issue = await this.findCase(reference);
    if (issue.status === AssistanceIssueStatus.RESOLVED) throw new AppError('CASE_RESOLVED');
    return issue;
  }
}

function toListItem(issue: AssistanceIssue): CaseListItem {
  const idName = issue.failedType ?? 'Ladder ID';
  const guidance = issueGuidance(issue.reason, issue.failedType as IdType | null);
  return {
    id: issue.reference,
    customer: {
      label: `${idName} ending ${issue.maskedValue.slice(-4)}`,
      phoneNumber: issue.contactPhone,
    },
    issue: { title: REASON_TITLES[issue.reason](idName), description: guidance.whatWentWrong },
    status: issue.status,
    partner: partnerName(issue.partnerId),
    attempts: issue.attempts,
    updatedAt: issue.updatedAt.toISOString(),
  };
}

// Review issue → Provide correction (the customer fixes their details) → Reverify (passes identify).
function stagesFor(status: AssistanceIssueStatus): CaseStage[] {
  const [review, correct, reverify] =
    status === 'RESOLVED'
      ? (['COMPLETED', 'COMPLETED', 'COMPLETED'] as const)
      : status === 'OPEN'
        ? (['IN_PROGRESS', 'PENDING', 'PENDING'] as const)
        : (['COMPLETED', 'IN_PROGRESS', 'PENDING'] as const);
  return [
    { key: 'REVIEW_ISSUE', label: 'Review issue', status: review },
    { key: 'PROVIDE_CORRECTION', label: 'Provide correction', status: correct },
    { key: 'REVERIFY', label: 'Reverify', status: reverify },
  ];
}

// A reference (LDR-…), the last digits of the ID that failed, or a WhatsApp number.
function searchFilters(search: string): Prisma.AssistanceIssueWhereInput[] {
  const filters: Prisma.AssistanceIssueWhereInput[] = [
    { reference: { contains: search, mode: 'insensitive' } },
  ];
  const digits = search.replace(/\D/g, '');
  if (digits.length >= 3) {
    filters.push({ maskedValue: { endsWith: digits.slice(-4) } });
    filters.push({ contactPhone: { contains: digits } });
  }
  return filters;
}

const DAY_MS = 86_400_000;
const OFFSET_MS = AGENT_TIMEZONE_OFFSET_HOURS * 3_600_000;

function startOfToday(): Date {
  const local = new Date(Date.now() + OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - OFFSET_MS);
}

// YYYY-MM-DD of a moment in Lagos time.
const lagosDate = (moment: Date): string =>
  new Date(moment.getTime() + OFFSET_MS).toISOString().slice(0, 10);
