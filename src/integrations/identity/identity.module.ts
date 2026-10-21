import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.validation';
import { IdentityRecordRepository } from './identity-record.repository';
import { IDENTITY_PROVIDER, IdentityProvider } from './identity.provider';
import { MockIdentityProvider } from './mock.provider';
import { RegistryIdentityProvider } from './registry.provider';

// Add a vendor: create <vendor>.provider.ts implementing IdentityProvider and add a case here.
@Module({
  providers: [
    IdentityRecordRepository,
    MockIdentityProvider,
    RegistryIdentityProvider,
    {
      provide: IDENTITY_PROVIDER,
      inject: [ConfigService, MockIdentityProvider, RegistryIdentityProvider],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
        mock: MockIdentityProvider,
        registry: RegistryIdentityProvider,
      ): IdentityProvider => {
        switch (config.get('IDENTITY_PROVIDER', { infer: true })) {
          case 'mock':
            return mock;
          case 'registry':
            return registry;
        }
      },
    },
  ],
  exports: [IDENTITY_PROVIDER],
})
export class IdentityModule {}
