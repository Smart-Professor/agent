import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { MailService } from '../mail/mail.service';
import { UsersService, SafeUser } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/** 密码哈希强度 */
const BCRYPT_ROUNDS = 10;

export interface AuthResult {
  token: string;
  user: SafeUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
  ) {}

  /** 校验邮箱验证码并完成注册（验证码由 /mail/send-code 发送） */
  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase().trim();

    // 验证码校验：过期 / 错误分别提示
    const codeResult = await this.mailService.checkRegisterCode(email, dto.code);
    if (codeResult === 'expired') {
      throw new UnauthorizedException('验证码已过期，请重新获取');
    }
    if (codeResult === 'wrong') {
      throw new UnauthorizedException('验证码错误');
    }

    // 双重校验，防止发码后邮箱被并发注册
    if (await this.usersService.existsByEmail(email)) {
      throw new ConflictException('该邮箱已被注册');
    }

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.usersService.create({
      email,
      password: hashedPassword,
      nickname: dto.nickname,
    });

    // 注册成功立即销毁验证码（一次性使用）
    await this.mailService.clearRegisterCode(email);

    const token = await this.jwtService.signAsync({ sub: user.id, email: user.email });
    return { token, user: this.usersService.toSafeUser(user) };
  }

  /** 邮箱 + 密码登录 */
  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.usersService.findByEmail(email);

    // 统一报错文案，避免泄露邮箱是否存在
    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    if (!user.isActive) {
      throw new ForbiddenException('账号已被禁用，请联系管理员');
    }

    const matched = await bcrypt.compare(dto.password, user.password);
    if (!matched) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    const token = await this.jwtService.signAsync({ sub: user.id, email: user.email });
    return { token, user: this.usersService.toSafeUser(user) };
  }
}
