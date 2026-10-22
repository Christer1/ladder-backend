import { Module, ValidationError, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppError } from './common/errors/app-error';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SessionGuard } from './common/guards/session.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { AssistanceModule } from './modules/assistance/assistance.module';
import { AuthModule } from './modules/auth/auth.module';
import { SupportModule } from './modules/support/support.module';
import { UsersModule } from './modules/users/users.module';
import { VerificationModule } from './modules/verification/verification.module';

// Turns class-validator errors into `errors: { field: [messages] }` on the error envelope.
const toFieldErrors = (errors: ValidationError[]): AppError =>
  new AppError(
    'VALIDATION_FAILED',
    Object.fromEntries(errors.map((e) => [e.property, Object.values(e.constraints ?? {})])),
  );

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    VerificationModule,
    AssistanceModule,
    SupportModule,
  ],
  providers: [
    // Guards run in this order: rate limit first, then session.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: toFieldErrors,
      }),
    },
  ],
})
export class AppModule {}
