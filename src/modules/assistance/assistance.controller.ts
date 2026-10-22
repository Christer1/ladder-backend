import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssistanceSession } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { sessionCookieOptions } from '../../common/utils/cookie';
import { UPLOAD_MAX_BYTES } from '../../config/app.config';
import { EnvironmentVariables } from '../../config/env.validation';
import { AssistanceService, StartedAssistanceSession } from './assistance.service';
import {
  AssistanceDetailsResponse,
  AssistanceStatusResponse,
  AssistanceStepResponse,
} from './dto/assistance.response';
import { ConfirmDetailsDto } from './dto/confirm-details.dto';
import { IdentifyBvnAndNinDto } from './dto/identify-bvn-and-nin.dto';
import { IdentifyBvnDto } from './dto/identify-bvn.dto';
import { IdentifyLadderIdDto } from './dto/identify-ladder-id.dto';
import { IdentifyNinDto } from './dto/identify-nin.dto';
import { AssistanceSessionGuard } from './guards/assistance-session.guard';
import { CurrentAssistanceSession, PartnerId } from './guards/assistance-request';
import { PartnerGuard } from './guards/partner.guard';

// Room for a few typos per minute, not for guessing numbers.
const IDENTIFY_LIMIT = { default: { limit: 10, ttl: 60_000 } };

// ladder-assistance. Public to the Ladder Web SessionGuard: uses its own partner check and cookie.
@Public()
@Controller('assistance')
@UseGuards(PartnerGuard)
export class AssistanceController {
  constructor(
    private readonly assistanceService: AssistanceService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Post('identify/bvn')
  @HttpCode(HttpStatus.OK)
  @Throttle(IDENTIFY_LIMIT)
  @ResponseMessage('Identity found.')
  async identifyBvn(
    @PartnerId() partnerId: string,
    @Body() dto: IdentifyBvnDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AssistanceStepResponse> {
    const session = await this.assistanceService.identifyBvn(partnerId, dto.bvn, dto.dateOfBirth);
    return this.startSession(res, session);
  }

  @Post('identify/nin')
  @HttpCode(HttpStatus.OK)
  @Throttle(IDENTIFY_LIMIT)
  @ResponseMessage('Identity found.')
  async identifyNin(
    @PartnerId() partnerId: string,
    @Body() dto: IdentifyNinDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AssistanceStepResponse> {
    const session = await this.assistanceService.identifyNin(partnerId, dto.nin, dto.dateOfBirth);
    return this.startSession(res, session);
  }

  @Post('identify/bvn-and-nin')
  @HttpCode(HttpStatus.OK)
  @Throttle(IDENTIFY_LIMIT)
  @ResponseMessage('Identity found.')
  async identifyBvnAndNin(
    @PartnerId() partnerId: string,
    @Body() dto: IdentifyBvnAndNinDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AssistanceStepResponse> {
    const session = await this.assistanceService.identifyBvnAndNin(
      partnerId,
      dto.bvn,
      dto.nin,
      dto.dateOfBirth,
    );
    return this.startSession(res, session);
  }

  @Post('identify/ladder-id')
  @HttpCode(HttpStatus.OK)
  @Throttle(IDENTIFY_LIMIT)
  @ResponseMessage('Ladder ID verified.')
  async identifyLadderId(
    @PartnerId() partnerId: string,
    @Body() dto: IdentifyLadderIdDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AssistanceStepResponse> {
    const session = await this.assistanceService.identifyLadderId(partnerId, dto.ladderId);
    return this.startSession(res, session);
  }

  @Post('liveness')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AssistanceSessionGuard)
  @ResponseMessage('Liveness verified.')
  @UseInterceptors(FileInterceptor('selfie', { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } }))
  submitLiveness(
    @CurrentAssistanceSession() session: AssistanceSession,
    @UploadedFile() selfie?: Express.Multer.File,
  ): Promise<AssistanceStepResponse> {
    return this.assistanceService.submitLiveness(session, selfie);
  }

  @Get('status')
  @UseGuards(AssistanceSessionGuard)
  getStatus(@CurrentAssistanceSession() session: AssistanceSession): AssistanceStatusResponse {
    return this.assistanceService.getStatus(session);
  }

  @Get('details')
  @UseGuards(AssistanceSessionGuard)
  getDetails(
    @CurrentAssistanceSession() session: AssistanceSession,
  ): Promise<AssistanceDetailsResponse> {
    return this.assistanceService.getDetails(session);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AssistanceSessionGuard)
  @ResponseMessage('Details sent.')
  confirm(
    @CurrentAssistanceSession() session: AssistanceSession,
    @Body() dto: ConfirmDetailsDto,
  ): Promise<void> {
    return this.assistanceService.confirmDetails(session, dto.residentialAddress);
  }

  @Post('session/end')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AssistanceSessionGuard)
  @ResponseMessage('Session ended.')
  async endSession(
    @CurrentAssistanceSession() session: AssistanceSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.assistanceService.endSession(session);
    res.clearCookie(this.cookieName, sessionCookieOptions(this.config));
  }

  private startSession(res: Response, session: StartedAssistanceSession): AssistanceStepResponse {
    res.cookie(this.cookieName, session.token, {
      ...sessionCookieOptions(this.config),
      expires: session.expiresAt,
    });
    return { status: 'verified' };
  }

  private get cookieName(): string {
    return this.config.get('ASSISTANCE_COOKIE_NAME', { infer: true });
  }
}
