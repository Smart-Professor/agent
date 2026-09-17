import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import * as express from 'express';
import * as path from 'path';
import { Repository } from 'typeorm';
import { R2Service } from './r2.service';
import { DriveFile } from '../entities/drive-file.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../entities/user.entity';
import { UsersService } from '../users/users.service';

/** 网盘文件前缀：所有共享文件存于此目录下 */
const DRIVE_PREFIX = 'drive/';
/** 头像文件前缀：每个用户一个目录 */
const AVATAR_PREFIX = 'avatars/';
/** AI 头像文件前缀（全局默认 + 会话级均存于此） */
const AI_AVATAR_PREFIX = 'ai-avatars/';

/** 图片类 MIME 白名单（头像专用） */
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const AVATAR_MAX_SIZE = 5 * 1024 * 1024; // 5MB

/** 拼接公开访问 URL */
function buildUrl(publicUrl: string | undefined, key: string): string {
  return publicUrl ? `${publicUrl}/${key}` : '';
}

/**
 * R2 对象存储接口（全局守卫拦截，全部需登录）
 * - 共享网盘：所有登录用户可查看 / 下载，只有上传者能删除
 * - 头像：上传到 avatars/ 并同步更新当前用户资料
 */
@Controller('r2')
export class R2Controller {
  constructor(
    private readonly r2Service: R2Service,
    private readonly usersService: UsersService,
    @InjectRepository(DriveFile)
    private readonly driveRepo: Repository<DriveFile>,
  ) {}

  // POST /r2/upload  网盘上传（form-data，字段名 file）
  // 返回：{ id, url, key }
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ) {
    if (!file) throw new BadRequestException('请选择文件');
    const safeName = path.basename(file.originalname).replace(/[^\w.\u4e00-\u9fa5-]/g, '_');
    const key = `${DRIVE_PREFIX}${new Date().toISOString().slice(0, 10)}/${Date.now()}-${safeName}`;
    const url = await this.r2Service.upload(key, file.buffer, file.mimetype);

    const record = await this.driveRepo.save(
      this.driveRepo.create({
        uploaderId: user.id,
        uploaderName: user.nickname || user.email,
        key,
        name: file.originalname,
        size: file.size,
        type: file.mimetype,
      }),
    );
    return { id: record.id, url, key, name: record.name, size: record.size };
  }

  // GET /r2/list  网盘文件列表（所有登录用户共享可见）
  @Get('list')
  async list(@CurrentUser() user: User) {
    const records = await this.driveRepo.find({
      order: { createdAt: 'DESC' },
    });
    const publicUrl = process.env.R2_PUBLIC_URL;
    return records.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      size: r.size,
      type: r.type,
      uploaderId: r.uploaderId,
      uploaderName: r.uploaderName,
      createdAt: r.createdAt,
      url: buildUrl(publicUrl, r.key),
      mine: r.uploaderId === user.id,
    }));
  }

  // POST /r2/avatar  头像上传（form-data，字段名 file）
  // 校验图片类型与大小，成功后同步更新用户资料并返回新头像 URL
  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_SIZE } }))
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ) {
    if (!file) throw new BadRequestException('请选择图片');
    if (!IMAGE_MIMES.includes(file.mimetype)) {
      throw new BadRequestException('头像仅支持 png / jpg / gif / webp 图片');
    }
    const ext = path.extname(file.originalname) || '.png';
    const key = `${AVATAR_PREFIX}${user.id}/${Date.now()}${ext}`;
    const url = await this.r2Service.upload(key, file.buffer, file.mimetype);
    await this.usersService.update(user.id, { avatar: url });
    return { url, key };
  }

  // POST /r2/ai-avatar  全局默认 AI 头像（form-data，字段名 file）
  // 上传到 ai-avatars/ 并写入 users.aiAvatar，对所有未单独设置头像的会话生效
  @Post('ai-avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_SIZE } }))
  async uploadAiAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ) {
    if (!file) throw new BadRequestException('请选择图片');
    if (!IMAGE_MIMES.includes(file.mimetype)) {
      throw new BadRequestException('头像仅支持 png / jpg / gif / webp 图片');
    }
    const ext = path.extname(file.originalname) || '.png';
    const key = `${AI_AVATAR_PREFIX}${user.id}/${Date.now()}${ext}`;
    const url = await this.r2Service.upload(key, file.buffer, file.mimetype);
    await this.usersService.update(user.id, { aiAvatar: url });
    return { url, key };
  }

  // GET /r2/download/:key  通过后端代理下载（key 里的 / 要 URL 编码）
  @Get('download/:key')
  async download(@Param('key') key: string, @Res() res: express.Response) {
    const buffer = await this.r2Service.download(key);
    res.send(buffer);
  }

  // DELETE /r2/:key  删除文件（仅上传者可删，共享网盘规则）
  @Delete(':key')
  async delete(@Param('key') key: string, @CurrentUser() user: User) {
    const record = await this.driveRepo.findOne({ where: { key } });
    if (!record) throw new BadRequestException('该文件不在网盘记录中');
    if (record.uploaderId !== user.id) {
      throw new ForbiddenException('只有上传者可以删除该文件');
    }
    await this.r2Service.delete(key);
    await this.driveRepo.delete(record.id);
    return { message: '删除成功', key };
  }
}