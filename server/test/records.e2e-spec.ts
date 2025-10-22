process.env.DATABASE_URL = 'file:F:\\trae\\sheets\\server\\prisma\\test-e2e.db';
process.env.JWT_SECRET = 'test-secret';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { Role, FieldType } from '@prisma/client';
import * as argon2 from 'argon2';

describe('Records (E2E) - M1-05', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;

  let viewerToken: string;
  let editorToken: string;

  let tableId: number;
  let fieldAId: number; // number
  let fieldBId: number; // number
  let fieldSumId: number; // formula
  let record1Id: number;
  let record2Id: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    await prisma.user.create({ data: { username: 'viewer', password: viewerPwd, role: Role.viewer } });
    await prisma.user.create({ data: { username: 'editor', password: editorPwd, role: Role.editor } });

    // Login to get tokens
    const viewerResp = await request(http).post('/api/auth/login').send({ username: 'viewer', password: 'viewer123' });
    expect(viewerResp.status).toBe(201);
    expect(viewerResp.body.token).toBeDefined();
    viewerToken = viewerResp.body.token;

    const editorResp = await request(http).post('/api/auth/login').send({ username: 'editor', password: 'editor123' });
    expect(editorResp.status).toBe(201);
    expect(editorResp.body.token).toBeDefined();
    editorToken = editorResp.body.token;

    // Verify tokens via /api/auth/me
    const viewerMe = await request(http).get('/api/auth/me').set('Authorization', `Bearer ${viewerToken}`);
    expect(viewerMe.status).toBe(200);
    const editorMe = await request(http).get('/api/auth/me').set('Authorization', `Bearer ${editorToken}`);
    expect(editorMe.status).toBe(200);

    // Create a table
    const table = await prisma.table.create({
      data: {
        name: 'T-Records-Test',
        metaJson: {},
        exportAllowedRoles: [Role.viewer, Role.editor, Role.exporter, Role.admin] as any,
      },
    });
    tableId = table.id;

    // Create fields: A(number), B(number), SUM(formula)
    const fieldA = await prisma.field.create({
      data: { tableId, name: 'A', type: FieldType.number, optionsJson: { precision: 0 }, readonly: false },
    });
    const fieldB = await prisma.field.create({
      data: { tableId, name: 'B', type: FieldType.number, optionsJson: { precision: 0 }, readonly: false },
    });
    const fieldSum = await prisma.field.create({
      data: { tableId, name: 'SUM', type: FieldType.formula, optionsJson: { precision: 2 }, readonly: false },
    });
    fieldAId = fieldA.id;
    fieldBId = fieldB.id;
    fieldSumId = fieldSum.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('ACL: viewer can list but cannot create', async () => {
    // Viewer list should 200
    const listResp = await request(http)
      .get(`/api/tables/${tableId}/records`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(listResp.status).toBe(200);
    expect(Array.isArray(listResp.body.data)).toBe(true);

    // Viewer create should 403
    const createResp = await request(http)
      .post(`/api/tables/${tableId}/records`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ values: { [fieldAId]: 1, [fieldBId]: 2, [fieldSumId]: null }, formulas: { [fieldSumId]: 'A + B' } });
    expect(createResp.status).toBe(403);
  });

  it('Editor can create record and formulas compute', async () => {
    const resp = await request(http)
      .post(`/api/tables/${tableId}/records`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ values: { [fieldAId]: 1, [fieldBId]: 2, [fieldSumId]: null }, formulas: { [fieldSumId]: 'A + B' } });
    expect(resp.status).toBe(201);
    record1Id = resp.body.id;

    const listResp = await request(http)
      .get(`/api/tables/${tableId}/records`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(listResp.status).toBe(200);
    expect(listResp.body.total).toBe(1);
    const r = listResp.body.data[0];
    expect(r.id).toBe(record1Id);
    expect(r.values[String(fieldAId)]).toBe(1);
    expect(r.values[String(fieldBId)]).toBe(2);
    // SUM is computed with precision 2 then cast to number => 3
    expect(r.values[String(fieldSumId)]).toBe(3);
  });

  it('Filtering and sorting work as expected', async () => {
    // Create a second record: A=1, B=1, SUM=A+B
    const resp2 = await request(http)
      .post(`/api/tables/${tableId}/records`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ values: { [fieldAId]: 1, [fieldBId]: 1, [fieldSumId]: null }, formulas: { [fieldSumId]: 'A + B' } });
    expect(resp2.status).toBe(201);
    record2Id = resp2.body.id;

    // Filter: A >= 1 should return 2 records
    const filters = encodeURIComponent(JSON.stringify([{ fieldId: fieldAId, op: 'gte', value: 1 }]));
    const listResp = await request(http)
      .get(`/api/tables/${tableId}/records?filters=${filters}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(listResp.status).toBe(200);
    expect(listResp.body.total).toBe(2);

    // Sort by B desc: first should be record1 (B=2)
    const sort = encodeURIComponent(JSON.stringify({ fieldId: fieldBId, direction: 'desc' }));
    const listSorted = await request(http)
      .get(`/api/tables/${tableId}/records?sort=${sort}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(listSorted.status).toBe(200);
    expect(listSorted.body.data[0].id).toBe(record1Id);
    expect(listSorted.body.data[0].values[String(fieldBId)]).toBe(2);
  });

  it('Update recomputes formula and GET/:id returns values', async () => {
    // Update record1: A=5 -> SUM should become 7
    const updateResp = await request(http)
      .put(`/api/tables/${tableId}/records/${record1Id}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ values: { [fieldAId]: 5 } });
    expect(updateResp.status).toBe(200);

    const getResp = await request(http)
      .get(`/api/tables/${tableId}/records/${record1Id}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(getResp.status).toBe(200);
    expect(getResp.body.values[String(fieldAId)]).toBe(5);
    expect(getResp.body.values[String(fieldBId)]).toBe(2);
    expect(getResp.body.values[String(fieldSumId)]).toBe(7);
  });
});