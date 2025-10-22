process.env.DATABASE_URL = 'file:F:\\trae\\sheets\\server\\prisma\\test-e2e.db';
process.env.JWT_SECRET = 'test-secret';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { Role, ViewType } from '@prisma/client';
import * as argon2 from 'argon2';

describe('Logs (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;

  let adminToken: string;
  let viewerToken: string;
  let tableId: number;
  let viewId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    // Clean database (keep order to respect FKs)
    await prisma.log.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.view.deleteMany();
    await prisma.cellValue.deleteMany();
    await prisma.record.deleteMany();
    await prisma.field.deleteMany();
    await prisma.table.deleteMany();
    await prisma.user.deleteMany();

    // Seed users
    const adminPwd = await argon2.hash('admin123');
    const viewerPwd = await argon2.hash('viewer123');
    await prisma.user.create({ data: { username: 'admin_e2e_logs', password: adminPwd, role: Role.admin } });
    await prisma.user.create({ data: { username: 'viewer_e2e_logs', password: viewerPwd, role: Role.viewer } });

    // Login
    const adminLogin = await request(http).post('/api/auth/login').send({ username: 'admin_e2e_logs', password: 'admin123' });
    expect([200,201]).toContain(adminLogin.status);
    adminToken = adminLogin.body.token;

    const viewerLogin = await request(http).post('/api/auth/login').send({ username: 'viewer_e2e_logs', password: 'viewer123' });
    expect([200,201]).toContain(viewerLogin.status);
    viewerToken = viewerLogin.body.token;

    // Create table via API (admin)
    const createTable = await request(http)
      .post('/api/tables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'T-Logs-Test', metaJson: {}, exportAllowedRoles: [Role.viewer, Role.editor, Role.exporter, Role.admin] });
    expect(createTable.status).toBe(201);
    tableId = createTable.body.id;

    // Create a view (admin)
    const createView = await request(http)
      .post(`/api/tables/${tableId}/views`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'V-Logs-Grid', type: ViewType.grid, configJson: {}, anonymousEnabled: false });
    expect(createView.status).toBe(201);
    viewId = createView.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('admin can list logs with pagination', async () => {
    const resp = await request(http)
      .get('/api/logs?page=1&size=50')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty('data');
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body).toHaveProperty('total');
    expect(resp.body.page).toBe(1);
    expect(resp.body.size).toBe(50);
    // Should include at least login and create_table/create_view
    const actions = new Set(resp.body.data.map((x: any) => x.action));
    expect(actions.size).toBeGreaterThanOrEqual(2);
  });

  it('admin can filter by action=login', async () => {
    const resp = await request(http)
      .get('/api/logs?action=login')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resp.status).toBe(200);
    expect(resp.body.data.length).toBeGreaterThanOrEqual(1);
    for (const item of resp.body.data) {
      expect(item.action).toBe('login');
    }
  });

  it('admin can filter by tableId and viewId', async () => {
    const byTable = await request(http)
      .get(`/api/logs?tableId=${tableId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byTable.status).toBe(200);
    for (const item of byTable.body.data) {
      expect(item.tableId).toBe(tableId);
    }

    const byView = await request(http)
      .get(`/api/logs?viewId=${viewId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byView.status).toBe(200);
    for (const item of byView.body.data) {
      expect(item.viewId).toBe(viewId);
    }
  });

  it('non-admin is forbidden to access logs', async () => {
    const resp = await request(http)
      .get('/api/logs')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(resp.status).toBe(403);
  });
});