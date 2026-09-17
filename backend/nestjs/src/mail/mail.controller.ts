import { Body, Controller, Post } from '@nestjs/common';
import { MailService } from './mail.service';
import { SendCodeDto } from './dto/send-code.dto';
import { SendMailDto } from './dto/send-mail.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  // POST /mail/send-code  { email }
  // 注册专用：公开接口，已注册拦截 + 60s 频控 + 验证码 5 分钟有效
  @Public()
  @Post('send-code')
  async sendCode(@Body() dto: SendCodeDto) {
    await this.mailService.sendRegisterCode(dto.email);
    return { message: '验证码已发送，请查收邮件' };
  }

  // POST /mail/send  { to, subject, content }
  // 通用发信接口，全局守卫拦截，需携带有效 JWT（Authorization: Bearer <token>）
  @Post('send')
  async send(@Body() dto: SendMailDto) {
    await this.mailService.sendRaw({
      to: dto.to,
      subject: dto.subject,
      html: dto.content,
    });
    return { message: '邮件发送成功' };
  }
}
