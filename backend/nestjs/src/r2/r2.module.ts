import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { R2Service } from './r2.service';
import { R2Controller } from './r2.controller';
import { DriveFile } from '../entities/drive-file.entity';
import { UsersModule } from '../users/users.module';

@Module({
  // DriveFile：网盘文件元信息；UsersModule：头像更新用户资料
  imports: [TypeOrmModule.forFeature([DriveFile]), UsersModule],
  providers: [R2Service],
  controllers: [R2Controller],
  exports: [R2Service], // 导出后其他模块也可注入使用
})
export class R2Module {}