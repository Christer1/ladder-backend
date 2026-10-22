import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { CookieOptions, Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { EnvironmentVariables } from '../../config/env.validation';
import { AuthService } from './auth.service';
import { OtpSentResponse, SessionResponse } from './dto/auth.response';
import { LoginDto } from './dto/login.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { SignupDto } from './dto/signup.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

// Stricter limit for endpoints that send emails or check secrets.
const STRICT_LIMIT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
@Throttle(STRICT_LIMIT)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Public()
  @Post('signup')
  @ResponseMessage('Verification code sent.')
  signup(@Body() dto: SignupDto): Promise<OtpSentResponse> {
    return this.authService.signup(dto);
  }

  @Public()
  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Verification code sent.')
  resendOtp(@Body() dto: ResendOtpDto): Promise<OtpSentResponse> {
    return this.authService.resendOtp(dto);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Email verified.')
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    this.setSessionCookie(res, await this.authService.verifyOtp(dto));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in.')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.setSessionCookie(res, await this.authService.login(dto));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed out.')
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(user.sessionId);
    res.clearCookie(this.cookieName, this.cookieOptions);
  }

  private setSessionCookie(res: Response, session: SessionResponse): void {
    res.cookie(this.cookieName, session.token, {
      ...this.cookieOptions,
      expires: session.expiresAt,
    });
  }

  private get cookieOptions(): CookieOptions {
    const sameSite = this.config.get('COOKIE_SAME_SITE', { infer: true });
    return {
      httpOnly: true,
      secure: sameSite === 'none' || this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite,
      path: '/',
    };
  }

  private get cookieName(): string {
    return this.config.get('SESSION_COOKIE_NAME', { infer: true });
  }
}
