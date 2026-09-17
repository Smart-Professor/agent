import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

/** 创建用户的入参（password 应为已加密的哈希值） */
export interface CreateUserDto {
  email: string;
  password: string;
  nickname?: string;
  avatar?: string;
  aiAvatar?: string | null;
}

/** 更新用户的入参（全部可选；aiAvatar 传 null 表示清除，回退内置默认头像） */
export interface UpdateUserDto {
  nickname?: string;
  avatar?: string;
  aiAvatar?: string | null;
}

/** 对外返回的安全用户结构（不含密码） */
export type SafeUser = Omit<User, 'password'>;

/**
 * 用户数据库操作封装
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** 按邮箱查找用户（含密码字段，仅用于登录校验） */
  findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  /** 按 ID 查找用户 */
  findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  /** 邮箱是否已被注册 */
  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.userRepo.count({ where: { email } });
    return count > 0;
  }

  /** 创建用户 */
  create(data: CreateUserDto): Promise<User> {
    const user = this.userRepo.create(data);
    return this.userRepo.save(user);
  }

  /** 更新用户资料（昵称 / 头像），返回更新后的完整用户 */
  async update(id: string, data: UpdateUserDto): Promise<User | null> {
    const result = await this.userRepo.update(id, data);
    if (!result.affected) return null;
    return this.findById(id);
  }

  /** 去除敏感字段 */
  toSafeUser(user: User): SafeUser {
    const { password, ...safe } = user;
    return safe;
  }
}
