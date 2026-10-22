import { Module } from '@nestjs/common';
import { SupportModule } from '../support/support.module';
import { AgentController } from './agent.controller';
import { AgentRepository } from './agent.repository';
import { AgentService } from './agent.service';

// Recovery cases for ladder-agent-dashboard: help issues and their web chats.
@Module({
  imports: [SupportModule],
  controllers: [AgentController],
  providers: [AgentService, AgentRepository],
})
export class AgentModule {}
