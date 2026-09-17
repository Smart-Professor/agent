import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** 网盘文件记录：R2 中的对象在此登记元信息（原名 / 大小 / 上传者） */
@Entity('drive_files')
export class DriveFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  uploaderId: string;

  /** 上传者昵称快照（避免列表查询时联表） */
  @Column()
  uploaderName: string;

  /** R2 对象键（形如 drive/2026-09-13/xxx.zip） */
  @Column({ unique: true })
  key: string;

  /** 原始文件名 */
  @Column()
  name: string;

  @Column({ type: 'bigint', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  size: number;

  @Column({ nullable: true })
  type: string;

  @CreateDateColumn()
  createdAt: Date;
}