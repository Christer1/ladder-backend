import { Module } from '@nestjs/common';
import { IdentityModule } from '../../integrations/identity/identity.module';
import { StorageModule } from '../../integrations/storage/storage.module';
import { UsersModule } from '../users/users.module';
import { VerificationController } from './verification.controller';
import { VerificationRepository } from './verification.repository';
import { VerificationService } from './verification.service';

@Module({
  imports: [UsersModule, IdentityModule, StorageModule],
  controllers: [VerificationController],
  providers: [VerificationService, VerificationRepository],
})
export class VerificationModule {}
