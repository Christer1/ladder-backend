import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProfileResponse } from './dto/profile.response';
import { UsersService } from './users.service';

@Controller('profile')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthUser): Promise<ProfileResponse> {
    return this.usersService.getProfile(user.id);
  }
}
