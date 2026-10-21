import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.validation';
import { IDENTITY_PROVIDER, IdentityProvider } from './identity.provider';
import { MockIdentityProvider } from './mock.provider';

// Add a vendor: create <vendor>.provider.ts implementing IdentityProvider and add a case here.
@Module({
  providers: [
    MockIdentityProvider,
    {
      provide: IDENTITY_PROVIDER,
      inject: [ConfigService, MockIdentityProvider],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
        mock: MockIdentityProvider,
      ): IdentityProvider => {
        switch (config.get('IDENTITY_PROVIDER', { infer: true })) {
          case 'mock':
            return mock;
        }
      },
    },
  ],
  exports: [IDENTITY_PROVIDER],
})
export class IdentityModule {}
