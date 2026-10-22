import { AssistanceIssueStatus } from '@prisma/client';

// Shapes read by ladder-agent-dashboard (its features/cases/types). A case is a help issue: a
// failed identify on a partner screen. The customer's name is unknown (the check failed), so a case
// shows the ID that failed by its last 4 characters.

export type CaseStatus = AssistanceIssueStatus;
export type StageStatus = 'COMPLETED' | 'IN_PROGRESS' | 'PENDING';

export interface CaseStage {
  key: 'REVIEW_ISSUE' | 'PROVIDE_CORRECTION' | 'REVERIFY';
  label: string;
  status: StageStatus;
}

export interface CaseListItem {
  id: string;
  customer: {
    // e.g. "BVN ending 8901".
    label: string;
    // WhatsApp number when the customer wrote from WhatsApp, else null.
    phoneNumber: string | null;
  };
  issue: { title: string; description: string };
  status: CaseStatus;
  partner: string;
  attempts: number;
  updatedAt: string;
}

export interface CaseOfficeVisit {
  // BVN or NIN: the record to fix.
  id: string;
  where: string;
  bring: string[];
  notes: string[];
}

export interface CaseChatMessage {
  id: string;
  sender: 'customer' | 'ladder' | 'agent';
  text: string;
  agentName: string | null;
  createdAt: string;
}

export interface CaseChat {
  // ai: the AI answers the customer. agent: an agent has taken the chat over.
  mode: 'ai' | 'agent';
  agentName: string | null;
  preferredLanguage: string | null;
  messages: CaseChatMessage[];
}

export interface CaseNote {
  id: string;
  text: string;
  authorName: string;
  createdAt: string;
}

export interface CaseDetail extends CaseListItem {
  method: string;
  createdAt: string;
  lastAttemptAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  stages: CaseStage[];
  // How the customer fixes it (the same steps the AI gives).
  guidance: string[];
  officeVisits: CaseOfficeVisit[];
  // The web help chat; null until the customer opens it.
  chat: CaseChat | null;
  notes: CaseNote[];
}

export interface CaseSummary {
  inProgress: number;
  needsAttention: number;
  resolvedToday: number;
  total: number;
}

export interface CaseListPage {
  items: CaseListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AgentProfile {
  fullName: string;
  role: string;
}
