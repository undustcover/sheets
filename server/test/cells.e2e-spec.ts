process.env.DATABASE_URL = 'file:./prisma/test-e2e.db';
process.env.JWT_SECRET = 'test-secret';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { Role, FieldType } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Cells (E2E) - M1-05 批量写入与公式重算
 * 覆盖点：
 * - 成功批量写入、revision 递增、公式字段重算
 * - 记录只读/字段只读阻止写入（403）
 * - revision 冲突（409）
 */
describe('Cells (E2E) - M1-05 batch write', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;

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
    // NOTE: Do not delete users to avoid cross-suite interference
    // await prisma.user.deleteMany();

    // Seed users
    const editorPwd = await argon2.hash('editor123');
    const editor = await prisma.user.create({
      data: { username: 'editor_e2e_cells', password: editorPwd, role: Role.editor },
    });

    // Editor login
    const loginResp = await request(http).post('/api/auth/login').send({ username: 'editor_e2e_cells', password: 'editor123' });
    expect(loginResp.status).toBe(201);
    const token = loginResp.body?.token;
    expect(token).toBeTruthy();
    editorToken = token;

    // Create table & fields
    const table = await prisma.table.create({
      data: {
        name: 'T-Cells-Test',
        metaJson: {},
        exportAllowedRoles: [Role.viewer, Role.editor, Role.exporter, Role.admin] as any,
      },
    });
    tableId = table.id;

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

    // Create records
    const rec1 = await prisma.record.create({ data: { tableId, readonly: false, metaJson: {} } });
    const rec2 = await prisma.record.create({ data: { tableId, readonly: false, metaJson: {} } });
    record1Id = rec1.id;
    record2Id = rec2.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('批量写入成功并触发公式重算，revision 递增', async () => {
    const tbl = await prisma.table.findUnique({ where: { id: tableId } });
    const currentRevision = tbl!.revision; // 0

    const writes = [
      { recordId: record1Id, fieldId: fieldAId, value: 10 },
      { recordId: record1Id, fieldId: fieldBId, value: 5 },
      { recordId: record1Id, fieldId: fieldSumId, formulaExpr: 'A + B' },
      { recordId: record2Id, fieldId: fieldAId, value: 3 },
      { recordId: record2Id, fieldId: fieldBId, value: 7 },
      { recordId: record2Id, fieldId: fieldSumId, formulaExpr: 'A + B' },
    ];

    const resp = await request(http)
      .post(`/api/tables/${tableId}/cells/batch`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ revision: currentRevision, writes });

    expect(resp.status).toBe(201);
    expect(resp.body?.success).toBe(true);
    expect(resp.body?.written).toBe(writes.length);
    expect(typeof resp.body?.revision).toBe('number');
    expect(resp.body?.revision).toBe(currentRevision + 1);

    // Verify computed SUM
    const cells1 = await prisma.cellValue.findMany({ where: { recordId: record1Id, fieldId: fieldSumId } });
    expect(cells1.length).toBe(1);
    expect(cells1[0].valueJson as any).toBe(15);

    const cells2 = await prisma.cellValue.findMany({ where: { recordId: record2Id, fieldId: fieldSumId } });
    expect(cells2.length).toBe(1);
    expect(cells2[0].valueJson as any).toBe(10);
  });

  it('记录只读阻止写入（403）', async () => {
    // Make record2 readonly
    await prisma.record.update({ where: { id: record2Id }, data: { readonly: true } });
    const tbl = await prisma.table.findUnique({ where: { id: tableId } });
    const currentRevision = tbl!.revision; // e.g. 1

    const resp = await request(http)
      .post(`/api/tables/${tableId}/cells/batch`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ revision: currentRevision, writes: [{ recordId: record2Id, fieldId: fieldAId, value: 99 }] });

    expect(resp.status).toBe(403);
  });

  it('字段只读阻止写入（403）', async () => {
    // Make fieldB readonly
    await prisma.field.update({ where: { id: fieldBId }, data: { readonly: true } });
    const tbl = await prisma.table.findUnique({ where: { id: tableId } });
    const currentRevision = tbl!.revision; // unchanged

    const resp = await request(http)
      .post(`/api/tables/${tableId}/cells/batch`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ revision: currentRevision, writes: [{ recordId: record1Id, fieldId: fieldBId, value: 123 }] });

    expect(resp.status).toBe(403);
  });

  it('revision 冲突返回 409 并包含冲突详情', async () => {
    const tbl = await prisma.table.findUnique({ where: { id: tableId } });
    const latest = tbl!.revision; // e.g. 1

    // 先写入一个值以创建冲突基础
    await prisma.cellValue.upsert({
      where: { recordId_fieldId: { recordId: record1Id, fieldId: fieldAId } },
      update: { valueJson: 10 },
      create: { recordId: record1Id, fieldId: fieldAId, valueJson: 10 },
    });

    // stale revision (latest - 1)
    const staleRevision = Math.max(0, latest - 1);

    const resp = await request(http)
      .post(`/api/tables/${tableId}/cells/batch`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ revision: staleRevision, writes: [{ recordId: record1Id, fieldId: fieldAId, value: 20 }] });

    expect(resp.status).toBe(409);
    expect(resp.body.details).toBeDefined();
    expect(resp.body.details.latestRevision).toBe(latest);
    expect(resp.body.details.conflicts).toBeDefined();
    expect(Array.isArray(resp.body.details.conflicts)).toBe(true);
    
    // 验证冲突详情包含具体的单元格信息
    if (resp.body.details.conflicts.length > 0) {
      const conflict = resp.body.details.conflicts[0];
      expect(conflict.recordId).toBe(record1Id);
      expect(conflict.fieldId).toBe(fieldAId);
      expect(conflict.currentValue).toBe(10);
      expect(conflict.attemptedValue).toBe(20);
    }
  });

  it('使用最新 revision 写入成功并重算公式', async () => {
    const tbl = await prisma.table.findUnique({ where: { id: tableId } });
    const latest = tbl!.revision;

    const resp = await request(http)
      .post(`/api/tables/${tableId}/cells/batch`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ revision: latest, writes: [{ recordId: record1Id, fieldId: fieldAId, value: 20 }] });

    expect(resp.status).toBe(201);
    expect(resp.body?.success).toBe(true);
    expect(resp.body?.revision).toBe(latest + 1);

    const sumCell = await prisma.cellValue.findFirst({ where: { recordId: record1Id, fieldId: fieldSumId } });
    expect(sumCell).toBeTruthy();
    expect(sumCell!.valueJson as any).toBe(25);
  });
});