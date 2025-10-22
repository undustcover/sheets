process.env.DATABASE_URL = 'file:F:\\trae\\sheets\\server\\prisma\\test-e2e.db';
process.env.JWT_SECRET = 'test-secret';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { Role, FieldType, ViewType } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Views (E2E) - 匿名读取与过滤/排序
 * 覆盖点：
 * - 管理员创建视图（grid），设置 configJson 的过滤与排序，anonymousEnabled=true
 * - 公共接口 GET /api/views/:id/data 返回数据，按配置且支持查询参数覆盖
 * - 视图更新 revision 递增
 */
describe('Views (E2E) - filters & sort & anonymous', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;

  let adminToken: string;

  let tableId: number;
  let fieldAId: number; // number
  let fieldBId: number; // number
  let fieldSumId: number; // formula
  let record1Id: number; // A=1,B=2
  let record2Id: number; // A=5,B=1

  let viewId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    // Clean non-user tables to isolate data; keep users to avoid cross-suite interference
    await prisma.log.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.view.deleteMany();
    await prisma.cellValue.deleteMany();
    await prisma.record.deleteMany();
    await prisma.field.deleteMany();
    await prisma.table.deleteMany();

    // Seed admin
    const adminPwd = await argon2.hash('admin123');
    await prisma.user.create({ data: { username: 'admin_e2e_views', password: adminPwd, role: Role.admin } });

    // Admin login
    const loginResp = await request(http).post('/api/auth/login').send({ username: 'admin_e2e_views', password: 'admin123' });
    expect([200, 201]).toContain(loginResp.status);
    expect(loginResp.body?.token).toBeTruthy();
    adminToken = loginResp.body.token;

    // Create table & fields
    const table = await prisma.table.create({
      data: {
        name: 'T-Views-Test',
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

    // Create records via API using admin token
    const resp1 = await request(http)
      .post(`/api/tables/${tableId}/records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ values: { [fieldAId]: 1, [fieldBId]: 2, [fieldSumId]: null }, formulas: { [fieldSumId]: 'A + B' } });
    expect(resp1.status).toBe(201);
    record1Id = resp1.body.id;

    const resp2 = await request(http)
      .post(`/api/tables/${tableId}/records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ values: { [fieldAId]: 5, [fieldBId]: 1, [fieldSumId]: null }, formulas: { [fieldSumId]: 'A + B' } });
    expect(resp2.status).toBe(201);
    record2Id = resp2.body.id;

    // Create a grid view with config filters/sort and anonymous enabled
    const createView = await request(http)
      .post(`/api/tables/${tableId}/views`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'V-Grid-1',
        type: ViewType.grid,
        configJson: {
          page: 1,
          size: 50,
          filters: [{ fieldId: fieldAId, op: 'gte', value: 1 }],
          sort: { fieldId: fieldBId, direction: 'desc' },
        },
        anonymousEnabled: true,
      });
    expect(createView.status).toBe(201);
    viewId = createView.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('匿名读取：按视图配置过滤与排序返回数据', async () => {
    const dataResp = await request(http).get(`/api/views/${viewId}/data`);
    expect(dataResp.status).toBe(200);
    expect(dataResp.body?.view?.id).toBe(viewId);
    expect(Array.isArray(dataResp.body?.data)).toBe(true);
    // Expect both records returned (A>=1), sorted by B desc => record1 first
    expect(dataResp.body.total).toBe(2);
    expect(dataResp.body.data[0].id).toBe(record1Id);
    expect(dataResp.body.data[0].values[String(fieldBId)]).toBe(2);
  });

  it('查询参数覆盖配置过滤与排序', async () => {
    const filters = encodeURIComponent(JSON.stringify([{ fieldId: fieldAId, op: 'gte', value: 2 }])); // expect only record2 (A=5)
    const sort = encodeURIComponent(JSON.stringify({ fieldId: fieldBId, direction: 'asc' })); // ascending => record2 (B=1) first among filtered
    const dataResp = await request(http).get(`/api/views/${viewId}/data?filters=${filters}&sort=${sort}`);
    expect(dataResp.status).toBe(200);
    expect(dataResp.body.total).toBe(1);
    expect(dataResp.body.data[0].id).toBe(record2Id);
    expect(dataResp.body.data[0].values[String(fieldAId)]).toBe(5);
    expect(dataResp.body.data[0].values[String(fieldBId)]).toBe(1);
  });

  it('更新视图：修改排序并验证 revision 递增', async () => {
    // Get current revision
    const getView = await request(http).get(`/api/tables/${tableId}/views/${viewId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(getView.status).toBe(200);
    const beforeRev = getView.body.revision;

    const update = await request(http)
      .put(`/api/tables/${tableId}/views/${viewId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ configJson: { sort: { fieldId: fieldAId, direction: 'asc' } } });
    expect(update.status).toBe(200);
    const afterRev = update.body.revision;
    expect(afterRev).toBe(beforeRev + 1);

    // Verify new sort applies via config when no query overrides
    const dataResp = await request(http).get(`/api/views/${viewId}/data`);
    expect(dataResp.status).toBe(200);
    // Ascending by A => record1 (A=1) first
    expect(dataResp.body.data[0].id).toBe(record1Id);
    expect(dataResp.body.data[0].values[String(fieldAId)]).toBe(1);
  });
});