import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

/** R2 列表项 */
export interface R2ObjectInfo {
  key: string;
  size: number;
  lastModified?: Date;
}

@Injectable()
export class R2Service {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('R2_BUCKET_NAME')!;
    this.publicUrl = this.config.get<string>('R2_PUBLIC_URL')!;

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: this.config.get<string>('R2_ENDPOINT'),
      credentials: {
        accessKeyId: this.config.get<string>('R2_ACCESS_KEY_ID')!,
        secretAccessKey: this.config.get<string>('R2_SECRET_ACCESS_KEY')!,
      },
    });
  }

  // 上传文件，返回访问 URL
  async upload(
    key: string,
    body: Buffer | Readable,
    contentType: string,
  ): Promise<string> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      return this.publicUrl
        ? `${this.publicUrl}/${key}`
        : `r2://${this.bucket}/${key}`;
    } catch (e) {
      throw new InternalServerErrorException(`R2 上传失败: ${(e as Error).message}`);
    }
  }

  // 下载文件，返回 Buffer
  async download(key: string): Promise<Buffer> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as Readable) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks);
    } catch (e) {
      const err = e as { name?: string };
      if (err.name === 'NoSuchKey') {
        throw new NotFoundException('文件不存在');
      }
      throw new InternalServerErrorException(`R2 下载失败: ${(e as Error).message}`);
    }
  }

  // 列出某个前缀下的对象
  async list(prefix?: string): Promise<R2ObjectInfo[]> {
    try {
      const res = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
        }),
      );
      return (res.Contents ?? []).map((item) => ({
        key: item.Key ?? '',
        size: item.Size ?? 0,
        lastModified: item.LastModified,
      }));
    } catch (e) {
      throw new InternalServerErrorException(`R2 列表失败: ${(e as Error).message}`);
    }
  }

  // 删除文件
  async delete(key: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (e) {
      throw new InternalServerErrorException(`R2 删除失败: ${(e as Error).message}`);
    }
  }
}
