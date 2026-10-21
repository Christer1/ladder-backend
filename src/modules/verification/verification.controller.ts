import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { UPLOAD_MAX_BYTES } from '../../config/app.config';
import { UploadGovernmentIdDto } from './dto/upload-government-id.dto';
import {
  LivenessResponse,
  VerificationResultResponse,
  VerificationStatusResponse,
} from './dto/verification.response';
import { VerifyBvnDto } from './dto/verify-bvn.dto';
import { VerifyNinDto } from './dto/verify-nin.dto';
import { VerificationService } from './verification.service';

const uploadLimits = { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } };

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
    return this.verificationService.verifyBvn(user.id, dto.bvn);
  }

  @Post('nin')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('NIN verified.')
  verifyNin(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyNinDto,
  ): Promise<VerificationResultResponse> {
    return this.verificationService.verifyNin(user.id, dto.nin);
  }

  @Post('government-id')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  @ResponseMessage('Government ID verified.')
  uploadGovernmentId(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadGovernmentIdDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<VerificationResultResponse> {
    return this.verificationService.uploadGovernmentId(user.id, dto.idType, file);
  }

  @Post('liveness')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('selfie', uploadLimits))
  @ResponseMessage('Liveness check passed.')
  submitLiveness(
    @CurrentUser() user: AuthUser,
    @UploadedFile() selfie: Express.Multer.File | undefined,
  ): Promise<LivenessResponse> {
    return this.verificationService.submitLiveness(user.id, selfie);
  }

  @Get('status')
  getStatus(@CurrentUser() user: AuthUser): Promise<VerificationStatusResponse> {
    return this.verificationService.getStatus(user.id);
  }
}
