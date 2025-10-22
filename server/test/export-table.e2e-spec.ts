process.env.DATABASE_URL = 'file:F:\\trae\\sheets\\server\\prisma\\test-e2e.db';
process.env.JWT_SECRET = 'test-secret';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { Role, FieldType } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Export (E2E) - 表级CSV导出
 */
describe('Export (E2E) - table csv', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;
  let adminToken: string;

  let tableId: number;
  let fieldAId: number; // number
  let fieldBId: number; // number
  let fieldSumId: number; // formula

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    // Clean non-user data
    await prisma.log.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.view.deleteMany();
    await prisma.cellValue.deleteMany();
    await prisma.record.deleteMany();
    await prisma.field.deleteMany();
    await prisma.table.deleteMany();
    await prisma.user.deleteMany();

    // Seed admin
    const adminPwd = await argon2.hash('admin123');
    await prisma.user.create({ data: { username: 'admin_e2e_export_table', password: adminPwd, role: Role.admin } });
    const loginResp = await request(http).post('/api/auth/login').send({ username: 'admin_e2e_export_table', password: 'admin123' });
    expect([200, 201]).toContain(loginResp.status);
    adminToken = loginResp.body.token;

    // Create table & fields
    const table = await prisma.table.create({
      data: {
        name: 'T-Export-Table-Test',
        metaJson: {},
        exportAllowedRoles: [Role.viewer, Role.editor, Role.exporter, Role.admin] as any,
      },
    });
    tableId = table.id;
    const fieldA = await prisma.field.create({ data: { tableId, name: 'A', type: FieldType.number, optionsJson: { precision: 0 }, readonly: false } });
    const fieldB = await prisma.field.create({ data: { tableId, name: 'B', type: FieldType.number, optionsJson: { precision: 0 }, readonly: false } });
    const fieldSum = await prisma.field.create({ data: { tableId, name: 'SUM', type: FieldType.formula, optionsJson: { precision: 2 }, readonly: false } });
    fieldAId = fieldA.id;
    fieldBId = fieldB.id;
    fieldSumId = fieldSum.id;

    // Create records via API
    const r1 = await request(http)
      .post(`/api/tables/${tableId}/records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ values: { [fieldAId]: 5, [fieldBId]: 9, [fieldSumId]: null }, formulas: { [fieldSumId]: 'A + B' } });
    expect(r1.status).toBe(201);
    const r2 = await request(http)
      .post(`/api/tables/${tableId}/records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ values: { [fieldAId]: 1, [fieldBId]: 4, [fieldSumId]: null }, formulas: { [fieldSumId]: 'A + B' } });
    expect(r2.status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/tables/:id/export returns CSV with headers', async () => {
    const resp = await request(http)
      .post(`/api/tables/${tableId}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ format: 'csv' });
    expect([200, 201]).toContain(resp.status);
    expect(resp.headers['content-type']).toContain('text/csv');
    expect(resp.headers['content-disposition']).toContain('.csv');
    const body: string = resp.text;
    const firstLine = body.split('\n')[0];
    expect(firstLine).toContain('A');
    expect(firstLine).toContain('B');
    expect(firstLine).toContain('SUM');
  });
});