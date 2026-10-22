import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AgentService } from './agent.service';
import { AgentProfile, CaseDetail, CaseListPage, CaseSummary } from './dto/agent.response';
import { AddCaseNoteDto, SendCaseMessageDto } from './dto/case-text.dto';
import { ListCasesQuery } from './dto/list-cases.query';

// ladder-agent-dashboard. OPEN TO ANYONE: agent sign-in is not built yet (README), so these routes
// are @Public() and must not be deployed until they are protected.
@Public()
@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get('me')
  getProfile(): AgentProfile {
    return this.agentService.getProfile();
  }

  @Get('cases/summary')
  getSummary(): Promise<CaseSummary> {
    return this.agentService.getSummary();
  }

  @Get('cases')
  listCases(@Query() query: ListCasesQuery): Promise<CaseListPage> {
    return this.agentService.listCases(query);
  }

  @Get('cases/:caseId')
  getCase(@Param('caseId') caseId: string): Promise<CaseDetail> {
    return this.agentService.getCase(caseId);
  }

  @Post('cases/:caseId/instructions')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Recovery instructions sent.')
  sendInstructions(@Param('caseId') caseId: string): Promise<CaseDetail> {
    return this.agentService.sendInstructions(caseId);
  }

  @Post('cases/:caseId/messages')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Message sent.')
  replyInChat(
    @Param('caseId') caseId: string,
    @Body() dto: SendCaseMessageDto,
  ): Promise<CaseDetail> {
    return this.agentService.replyInChat(caseId, dto.text);
  }

  @Post('cases/:caseId/hand-back')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('The AI assistant is answering again.')
  handBackToAi(@Param('caseId') caseId: string): Promise<CaseDetail> {
    return this.agentService.handBackToAi(caseId);
  }

  @Post('cases/:caseId/escalate')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Case escalated.')
  escalate(@Param('caseId') caseId: string): Promise<CaseDetail> {
    return this.agentService.escalate(caseId);
  }

  @Post('cases/:caseId/resolve')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Case resolved.')
  resolve(@Param('caseId') caseId: string): Promise<CaseDetail> {
    return this.agentService.resolve(caseId);
  }

  @Post('cases/:caseId/notes')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Note added.')
  addNote(@Param('caseId') caseId: string, @Body() dto: AddCaseNoteDto): Promise<CaseDetail> {
    return this.agentService.addNote(caseId, dto.text);
  }
}
