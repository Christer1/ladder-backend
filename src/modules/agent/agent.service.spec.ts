import { AssistanceIssue } from '@prisma/client';
import { WebChatService } from '../support/web-chat.service';
import { AgentRepository, IssueWithNotes } from './agent.repository';
import { AgentService } from './agent.service';

const issue = (overrides: Partial<AssistanceIssue> = {}): IssueWithNotes => ({
  id: 'issue-1',
  reference: 'LDR-7K3QX9',
  partnerId: 'zenith',
  method: 'BVN_AND_NIN',
  failedType: 'NIN',
  reason: 'DIFFERENT_PEOPLE',
  maskedValue: '*******8901',
  contactPhone: null,
  preferredLanguage: null,
  expiresAt: new Date(),
  status: 'OPEN',
  attempts: 1,
  lastAttemptAt: new Date(),
  attemptFingerprint: 'fp',
  idFingerprint: 'fp-id',
  openFingerprint: 'fp',
  resolvedAt: null,
  resolvedBy: null,
  createdAt: new Date('2026-10-22T10:00:00Z'),
  updatedAt: new Date('2026-10-22T11:00:00Z'),
  notes: [],
  ...overrides,
});

describe('AgentService', () => {
  let repo: jest.Mocked<AgentRepository>;
  let chats: jest.Mocked<WebChatService>;
  let service: AgentService;

  beforeEach(() => {
    repo = {
      listIssues: jest.fn().mockResolvedValue({ items: [issue()], total: 1 }),
      countByStatus: jest.fn().mockResolvedValue({ OPEN: 2, IN_CHAT: 1, NEEDS_ATTENTION: 3 }),
      countResolvedSince: jest.fn().mockResolvedValue(4),
      findIssue: jest.fn().mockResolvedValue(issue()),
      updateStatus: jest.fn().mockResolvedValue(true),
      resolve: jest.fn().mockResolvedValue(true),
      addNote: jest.fn(),
      touch: jest.fn(),
    } as unknown as jest.Mocked<AgentRepository>;
    chats = {
      getChat: jest.fn().mockResolvedValue(null),
      postAgentMessage: jest.fn(),
      postLadderMessage: jest.fn(),
      handBackToAi: jest.fn(),
    } as unknown as jest.Mocked<WebChatService>;
    service = new AgentService(repo, chats);
  });

  it('shows a case by the ID that failed, never a full number', async () => {
    const page = await service.listCases({ page: 1 });
    expect(page.items[0]).toMatchObject({
      id: 'LDR-7K3QX9',
      customer: { label: 'NIN ending 8901', phoneNumber: null },
      issue: { title: 'BVN/NIN name mismatch' },
    });
  });

  it('searches by reference, and by the last digits of the ID or a phone number', async () => {
    await service.listCases({ page: 2, search: '8901', status: 'IN_CHAT' });
    expect(repo.listIssues).toHaveBeenCalledWith(
      {
        status: 'IN_CHAT',
        OR: [
          { reference: { contains: '8901', mode: 'insensitive' } },
          { maskedValue: { endsWith: '8901' } },
          { contactPhone: { contains: '8901' } },
        ],
      },
      8,
      8,
    );
  });

  it('filters In progress to open and in-chat cases', async () => {
    await service.listCases({ page: 1, status: 'IN_PROGRESS' });
    expect(repo.listIssues.mock.calls[0][0]).toEqual({ status: { in: ['OPEN', 'IN_CHAT'] } });
  });

  it('counts open and in-chat cases as in progress', async () => {
    await expect(service.getSummary()).resolves.toEqual({
      inProgress: 3,
      needsAttention: 3,
      resolvedToday: 4,
      total: 6,
    });
  });

  it('lists where to go and what to bring for both records of a name mismatch', async () => {
    const detail = await service.getCase('ldr-7k3qx9');
    expect(repo.findIssue).toHaveBeenCalledWith('LDR-7K3QX9');
    expect(detail.officeVisits.map((visit) => visit.id)).toEqual(['BVN', 'NIN']);
    expect(detail.officeVisits[1].bring).toContain(
      'A sworn affidavit for the change or correction of name',
    );
    expect(detail.chat).toBeNull();
  });

  it('sends the recovery instructions into the chat', async () => {
    await service.sendInstructions('LDR-7K3QX9');
    expect(chats.postLadderMessage).toHaveBeenCalledWith(
      'LDR-7K3QX9',
      expect.stringContaining('*If your NIN record needs fixing,* visit an NIMC enrolment centre'),
    );
  });

  it('does not reply in the chat of a resolved case', async () => {
    repo.findIssue.mockResolvedValue(issue({ status: 'RESOLVED' }));
    await expect(service.replyInChat('LDR-7K3QX9', 'Hi')).rejects.toMatchObject({
      code: 'CASE_RESOLVED',
    });
    expect(chats.postAgentMessage).not.toHaveBeenCalled();
  });

  it('answers CASE_NOT_FOUND for an unknown case', async () => {
    repo.findIssue.mockResolvedValue(null);
    await expect(service.getCase('LDR-ZZZZZZ')).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' });
  });
});
