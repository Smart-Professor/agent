import { Body, Controller, Get, Post, Patch } from '@nestjs/common';
import { AuthService, AuthResult } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from './current-user.decorator';
import { User } from '../entities/user.entity';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  // POST /auth/register  { email, password, code, nickname? }
  // 注册前需先调用 POST /mail/send-code 获取验证码
  // 注册成功直接返回 JWT
  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResult> {
    return this.authService.register(dto);
  }

  // POST /auth/login  { email, password }
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.authService.login(dto);
  }

  // GET /auth/profile （全局守卫拦截，需 Authorization: Bearer <token>）
  @Get('profile')
  profile(@CurrentUser() user: User) {
    return this.usersService.toSafeUser(user);
  }

  // PATCH /auth/profile  { nickname?, avatar? } 更新当前用户资料（全局守卫拦截）
  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.usersService.update(user.id, dto);
    return this.usersService.toSafeUser(updated!);
  }
}
