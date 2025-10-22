import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';

export interface SavedAttachmentInfo {
  id: string; // base64url of relative path
  tableId: number;
  recordId?: number;
  filename: string;
  storedName: string;
  mime: string;
  size: number;
  fullPath: string;
}

function toBase64Url(input: string): string {
  const b64 = Buffer.from(input, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
  return Buffer.from(padded, 'base64').toString('utf8');
}

@Injectable()
export class AttachmentsService {
  private uploadRoot: string;

  constructor() {
    const envDir = process.env.UPLOAD_DIR;
    this.uploadRoot = envDir && envDir.trim().length > 0 ? envDir : path.resolve(process.cwd(), 'uploads');
  }

  async ensureDir(dir: string) {
    await fs.mkdir(dir, { recursive: true });
  }

  async saveUploadedFile(opts: {
    file: Express.Multer.File;
    tableId: number;
    recordId?: number;
  }): Promise<SavedAttachmentInfo> {
    const { file, tableId, recordId } = opts;
    if (!file || !file.buffer) {
      throw new BadRequestException('缺少文件或文件内容为空');
    }
    if (!tableId || Number.isNaN(tableId)) {
      throw new BadRequestException('缺少或非法的 tableId');
    }

    const ext = path.extname(file.originalname || '') || '';
    const storedName = `${Date.now()}-${randomUUID()}${ext}`;
    const relativeDir = path.join(String(tableId), recordId ? String(recordId) : 'unlinked');
    const relativePath = path.join(relativeDir, storedName);
    const fullDir = path.join(this.uploadRoot, relativeDir);
    const fullPath = path.join(this.uploadRoot, relativePath);

    await this.ensureDir(fullDir);
    await fs.writeFile(fullPath, file.buffer);

    const id = toBase64Url(relativePath);
    return {
      id,
      tableId,
      recordId,
      filename: file.originalname || storedName,
      storedName,
      mime: file.mimetype || 'application/octet-stream',
      size: file.size || file.buffer.length,
      fullPath,
    };
  }

  // Map common file extensions to MIME types
  private lookupMimeByExt(ext: string): string {
    const e = ext.toLowerCase();
    switch (e) {
      case '.txt':
        return 'text/plain';
      case '.json':
        return 'application/json';
      case '.csv':
        return 'text/csv';
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.gif':
        return 'image/gif';
      case '.pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }

  async getFileById(id: string): Promise<{ fullPath: string; storedName: string; mime: string }> {
    if (!id) throw new BadRequestException('缺少附件 id');
    const relativePath = fromBase64Url(id);
    const fullPath = path.join(this.uploadRoot, relativePath);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) throw new NotFoundException('附件不存在');
      const storedName = path.basename(fullPath);
      const ext = path.extname(storedName);
      const mime = this.lookupMimeByExt(ext);
      return { fullPath, storedName, mime };
    } catch (e) {
      throw new NotFoundException('附件不存在');
    }
  }
}