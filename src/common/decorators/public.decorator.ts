import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Routes need a session by default. Mark a route @Public() to skip SessionGuard.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
