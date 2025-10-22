process.env.DATABASE_URL = 'file:F:\\trae\\sheets\\server\\prisma\\test-e2e.db';
process.env.JWT_SECRET = 'test-secret';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Attachments (E2E) - 上传与下载
 */
describe('Attachments (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;

  let viewerToken: string;
  let editorToken: string;
  let tableId: number;
  let recordId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    // Clean database
    await prisma.log.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.view.deleteMany();
    await prisma.cellValue.deleteMany();
    await prisma.record.deleteMany();
    await prisma.field.deleteMany();
    await prisma.table.deleteMany();
    await prisma.user.deleteMany();

    // Seed users
    const viewerPwd = await argon2.hash('viewer123');
    const editorPwd = await argon2.hash('editor123');
    await prisma.user.create({ data: { username: 'viewer_e2e_attach', password: viewerPwd, role: Role.viewer } });
    await prisma.user.create({ data: { username: 'editor_e2e_attach', password: editorPwd, role: Role.editor } });

    // Login
    const viewerLogin = await request(http).post('/api/auth/login').send({ username: 'viewer_e2e_attach', password: 'viewer123' });
    expect([200,201]).toContain(viewerLogin.status);
    viewerToken = viewerLogin.body.token;

    const editorLogin = await request(http).post('/api/auth/login').send({ username: 'editor_e2e_attach', password: 'editor123' });
    expect([200,201]).toContain(editorLogin.status);
    editorToken = editorLogin.body.token;

    // Create table and one record
    const table = await prisma.table.create({ data: { name: 'T-Attach-Test', metaJson: {}, exportAllowedRoles: [Role.viewer, Role.editor, Role.exporter, Role.admin] as any } });
    tableId = table.id;
    const rec = await prisma.record.create({ data: { tableId, readonly: false, metaJson: {} } });
    recordId = rec.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('editor can upload and receive id', async () => {
    const buf = Buffer.from('hello-attachments');
    const resp = await request(http)
      .post('/api/attachments/upload')
      .set('Authorization', `Bearer ${editorToken}`)
      .field('tableId', String(tableId))
      .field('recordId', String(recordId))
      .attach('file', buf, 'hello.txt');
    expect([200,201]).toContain(resp.status);
    expect(resp.body.id).toBeTruthy();
    expect(resp.body.filename).toBe('hello.txt');
    expect(resp.body.size).toBe(buf.length);

    // Download and validate content
    const id = resp.body.id;
    const download = await request(http)
      .get(`/api/attachments/${id}/download`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(download.status).toBe(200);
    expect(download.text).toBe('hello-attachments');
  });

  it('viewer cannot upload (403)', async () => {
    const buf = Buffer.from('nope');
    const resp = await request(http)
      .post('/api/attachments/upload')
      .set('Authorization', `Bearer ${viewerToken}`)
      .field('tableId', String(tableId))
      .field('recordId', String(recordId))
      .attach('file', buf, 'nope.txt');
    expect([401,403]).toContain(resp.status);
  });
});