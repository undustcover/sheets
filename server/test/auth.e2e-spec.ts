import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import * as argon2 from 'argon2';
import { Role } from '@prisma/client';

// Ensure env before module imports
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-me-please';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:F\\\\trae\\\\sheets\\\\server\\\\prisma\\\\test-e2e.db';

describe('Auth E2E (admin-check)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);

    // Seed two users: admin and viewer
    await prisma.user.deleteMany({});
    const adminPwd = await argon2.hash('admin123');
    const viewerPwd = await argon2.hash('viewer123');
    await prisma.user.create({ data: { username: 'admin_e2e_auth', password: adminPwd, role: Role.admin } });
    await prisma.user.create({ data: { username: 'viewer_e2e_auth', password: viewerPwd, role: Role.viewer } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('login returns token and me works', async () => {
    const loginResp = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin_e2e_auth', password: 'admin123' });
    expect([200, 201]).toContain(loginResp.status);
    expect(loginResp.body?.token).toBeTruthy();

    const meResp = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginResp.body.token}`);
    expect(meResp.status).toBe(200);
    expect(meResp.body?.user?.username).toBe('admin_e2e_auth');
  });

  it('admin-check: admin allowed, viewer forbidden', async () => {
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin_e2e_auth', password: 'admin123' });
    expect([200, 201]).toContain(adminLogin.status);
    const adminToken = adminLogin.body.token;

    const viewerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'viewer_e2e_auth', password: 'viewer123' });
    expect([200, 201]).toContain(viewerLogin.status);
    const viewerToken = viewerLogin.body.token;

    const adminCheckByAdmin = await request(app.getHttpServer())
      .get('/api/auth/admin-check')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminCheckByAdmin.status).toBe(200);

    const adminCheckByViewer = await request(app.getHttpServer())
      .get('/api/auth/admin-check')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect([401, 403]).toContain(adminCheckByViewer.status);
  });
});