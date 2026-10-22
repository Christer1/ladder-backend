import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { UPLOAD_MAX_BYTES } from '../../config/app.config';
import { SaveLastStepDto } from './dto/save-last-step.dto';
import { SubmitLivenessDto } from './dto/submit-liveness.dto';
import { UploadGovernmentIdDto } from './dto/upload-government-id.dto';
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

  @Post('government-id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('ID received.')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'front', maxCount: 1 },
        { name: 'back', maxCount: 1 },
      ],
      { limits: { fileSize: UPLOAD_MAX_BYTES, files: 2 } },
    ),
  )
  uploadGovernmentId(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadGovernmentIdDto,
    @UploadedFiles() files: { front?: Express.Multer.File[]; back?: Express.Multer.File[] } = {},
  ): Promise<VerificationResultResponse> {
    return this.verificationService.uploadGovernmentId(user.id, dto.idType, {
      front: files.front?.[0],
      back: files.back?.[0],
    });
  }

  @Post('liveness')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Liveness verified.')
  @UseInterceptors(FileInterceptor('selfie', { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } }))
  submitLiveness(
    @CurrentUser() user: AuthUser,
    @Body() dto: SubmitLivenessDto,
    @UploadedFile() selfie?: Express.Multer.File,
  ): Promise<VerificationResultResponse> {
    return this.verificationService.submitLiveness(user.id, selfie, dto.challenges);
  }

  @Put('last-step')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Progress saved.')
  saveLastStep(@CurrentUser() user: AuthUser, @Body() dto: SaveLastStepDto): Promise<void> {
    return this.verificationService.saveLastStep(user.id, dto.step);
  }

  @Get('status')
  getStatus(@CurrentUser() user: AuthUser): Promise<VerificationStatusResponse> {
    return this.verificationService.getStatus(user.id);
  }
}
