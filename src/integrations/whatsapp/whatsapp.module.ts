import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.validation';
import { ConsoleWhatsAppProvider } from './console.provider';
import { InfobipWhatsAppProvider } from './infobip.provider';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from './whatsapp.provider';

@Module({
  providers: [
    ConsoleWhatsAppProvider,
    InfobipWhatsAppProvider,
    {
      provide: WHATSAPP_PROVIDER,
      inject: [ConfigService, ConsoleWhatsAppProvider, InfobipWhatsAppProvider],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
        consoleProvider: ConsoleWhatsAppProvider,
        infobip: InfobipWhatsAppProvider,
      ): WhatsAppProvider => {
        switch (config.get('WHATSAPP_PROVIDER', { infer: true })) {
          case 'infobip':
            return infobip;
          case 'console':
            return consoleProvider;
        }
      },
    },
  ],
  exports: [WHATSAPP_PROVIDER],
})
export class WhatsAppModule {}
