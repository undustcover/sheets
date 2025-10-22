process.env.DATABASE_URL = 'file:F:\\trae\\sheets\\server\\prisma\\test-e2e.db'
process.env.JWT_SECRET = 'test-secret'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from './../src/app.module'
import { PrismaService } from './../src/prisma/prisma.service'
import { Role, FieldType } from '@prisma/client'
import * as argon2 from 'argon2'
import * as fs from 'fs'
import * as path from 'path'

// Ensure DB file directory exists and file is accessible before Nest init
const dbUrl = process.env.DATABASE_URL as string
const dbPath = dbUrl.replace(/^file:/, '')
const dir = path.dirname(dbPath)
try {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '')
} catch {}

/**
 * Import (E2E) - 表级CSV导入
 */
describe('Import (E2E) - table csv', () => {
  let app: INestApplication
  let prisma: PrismaService
  let http: any
  let adminToken: string
  let tableId: number
  let fieldAId: number
  let fieldBId: number

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleFixture.createNestApplication()
    await app.init()
    http = app.getHttpServer()
    prisma = app.get(PrismaService)

    // Clean database
    await prisma.log.deleteMany()
    await prisma.attachment.deleteMany()
    await prisma.view.deleteMany()
    await prisma.cellValue.deleteMany()
    await prisma.record.deleteMany()
    await prisma.field.deleteMany()
    await prisma.table.deleteMany()
    await prisma.user.deleteMany()

    // Seed admin
    const adminPwd = await argon2.hash('admin123')
    await prisma.user.create({ data: { username: 'admin_e2e_import', password: adminPwd, role: Role.admin } })
    const loginResp = await request(http).post('/api/auth/login').send({ username: 'admin_e2e_import', password: 'admin123' })
    expect([200, 201]).toContain(loginResp.status)
    adminToken = loginResp.body.token

    // Create table & fields (A,B numbers)
    const table = await prisma.table.create({ data: { name: 'T-Import-Table-Test', metaJson: {}, exportAllowedRoles: [Role.viewer, Role.editor, Role.exporter, Role.admin] as any } })
    tableId = table.id
    const fieldA = await prisma.field.create({ data: { tableId, name: 'A', type: FieldType.number, optionsJson: { precision: 0 }, readonly: false } })
    const fieldB = await prisma.field.create({ data: { tableId, name: 'B', type: FieldType.number, optionsJson: { precision: 0 }, readonly: false } })
    fieldAId = fieldA.id
    fieldBId = fieldB.id
  })

  afterAll(async () => {
    await app.close()
  })

  it('admin can import CSV with header as field names', async () => {
    const csv = 'A,B\n5,9\n2,3\n'
    const buf = Buffer.from(csv, 'utf8')

    const resp = await request(http)
      .post(`/api/tables/${tableId}/import`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buf, 'import.csv')

    expect([200,201]).toContain(resp.status)
    expect(resp.body.count).toBe(2)

    const list = await request(http)
      .get(`/api/tables/${tableId}/records`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(list.status).toBe(200)
    expect(list.body.total).toBe(2)

    const values0 = list.body.data[0].values
    const values1 = list.body.data[1].values
    expect(values0[String(fieldAId)]).toBe(5)
    expect(values0[String(fieldBId)]).toBe(9)
    expect(values1[String(fieldAId)]).toBe(2)
    expect(values1[String(fieldBId)]).toBe(3)
  })

  it('editor can import; viewer cannot (403)', async () => {
    const editorPwd = await argon2.hash('editor123')
    const viewerPwd = await argon2.hash('viewer123')
    await prisma.user.create({ data: { username: 'editor_e2e_import', password: editorPwd, role: Role.editor } })
    await prisma.user.create({ data: { username: 'viewer_e2e_import', password: viewerPwd, role: Role.viewer } })
    const editorLogin = await request(http).post('/api/auth/login').send({ username: 'editor_e2e_import', password: 'editor123' })
    const viewerLogin = await request(http).post('/api/auth/login').send({ username: 'viewer_e2e_import', password: 'viewer123' })
    expect([200,201]).toContain(editorLogin.status)
    expect([200,201]).toContain(viewerLogin.status)
    const editorToken = editorLogin.body.token
    const viewerToken = viewerLogin.body.token

    const buf = Buffer.from('A,B\n1,1\n', 'utf8')
    const ok = await request(http)
      .post(`/api/tables/${tableId}/import`)
      .set('Authorization', `Bearer ${editorToken}`)
      .attach('file', buf, 'import2.csv')
    expect([200,201]).toContain(ok.status)

    const denied = await request(http)
      .post(`/api/tables/${tableId}/import`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .attach('file', buf, 'import3.csv')
    expect([401,403]).toContain(denied.status)
  })
})