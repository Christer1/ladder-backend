import { Module } from '@nestjs/common';
import { IdentityModule } from '../../integrations/identity/identity.module';
import { UsersModule } from '../users/users.module';
import { AssistanceController } from './assistance.controller';
import { AssistanceRepository } from './assistance.repository';
import { AssistanceService } from './assistance.service';
import { AssistanceSessionGuard } from './guards/assistance-session.guard';
import { PartnerGuard } from './guards/partner.guard';

@Module({
  imports: [UsersModule, IdentityModule],
  controllers: [AssistanceController],
  providers: [AssistanceService, AssistanceRepository, PartnerGuard, AssistanceSessionGuard],
})
export class AssistanceModule {}
