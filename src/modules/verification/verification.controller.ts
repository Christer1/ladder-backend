import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import {
  VerificationResultResponse,
  VerificationStatusResponse,
} from './dto/verification.response';
import { VerifyBvnDto } from './dto/verify-bvn.dto';
import { VerifyNinDto } from './dto/verify-nin.dto';
import { VerificationService } from './verification.service';

@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('bvn')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('BVN verified.')
  verifyBvn(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyBvnDto,
  ): Promise<VerificationResultResponse> {
    return this.verificationService.verifyBvn(user.id, dto.bvn, dto.dateOfBirth);
  }

  @Post('nin')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('NIN verified.')
  verifyNin(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyNinDto,
  ): Promise<VerificationResultResponse> {
    return this.verificationService.verifyNin(user.id, dto.nin, dto.dateOfBirth);
  }

  @Get('status')
  getStatus(@CurrentUser() user: AuthUser): Promise<VerificationStatusResponse> {
    return this.verificationService.getStatus(user.id);
  }
}
