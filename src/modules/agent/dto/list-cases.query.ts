import { AssistanceIssueStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

// A status, or IN_PROGRESS for OPEN and IN_CHAT together (the "In progress" summary card).
export const CASE_STATUS_FILTERS = [
  ...Object.values(AssistanceIssueStatus),
  'IN_PROGRESS',
] as const;
export type CaseStatusFilter = AssistanceIssueStatus | 'IN_PROGRESS';

export class ListCasesQuery {
  // Matches a case reference, the last digits of the ID that failed, or a WhatsApp phone number.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(40)
  search?: string;

  @IsOptional()
  @IsIn(CASE_STATUS_FILTERS)
  status?: CaseStatusFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
}
