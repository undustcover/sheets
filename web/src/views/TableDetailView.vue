<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../services/api'

const route = useRoute()
const router = useRouter()
const tableId = computed(() => Number(route.params.id))

const loading = ref(true)
const error = ref<string | null>(null)
const table = ref<any | null>(null)
const fields = ref<any[]>([])
const records = ref<any[]>([])
const page = ref(1)
const size = ref(20)

async function load() {
  try {
    loading.value = true
    error.value = null
    table.value = await api.getTable(tableId.value)
    fields.value = await api.listFields(tableId.value)
    const list = await api.listRecords(tableId.value, page.value, size.value)
    records.value = list.data
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function fieldNameById(fid: number) {
  const f = fields.value.find((x) => x.id === fid)
  return f?.name ?? String(fid)
}

async function updateCell(recordId: number, fieldId: number, raw: any) {
  try {
    await api.updateRecord(tableId.value, recordId, { values: { [String(fieldId)]: raw } })
    await load()
  } catch (e: any) {
    alert(e?.message || '更新失败')
  }
}

// 测试与诊断：确保存在 A/B 字段并创建一条示例记录
const diagBusy = ref(false)
const diagMsg = ref<string | null>(null)
const diagErr = ref<string | null>(null)
const testA = ref<number | null>(1)
const testB = ref<number | null>(2)

async function ensureFieldByName(name: string) {
  let f = fields.value.find((x) => String(x.name).toLowerCase() === name.toLowerCase())
  if (f) return f
  f = await api.createField(tableId.value, { name, type: 'number', optionsJson: { precision: 0 }, readonly: false })
  // 刷新本地字段缓存
  fields.value = await api.listFields(tableId.value)
  return f
}

async function runDiagnostics() {
  try {
    diagBusy.value = true
    diagMsg.value = null
    diagErr.value = null

    // 1) 统计当前表的字段与记录数量
    const beforeFields = fields.value.length
    const beforeRecords = records.value.length

    // 2) 确保存在 A/B 字段
    const fa = await ensureFieldByName('A')
    const fb = await ensureFieldByName('B')

    // 3) 创建一条示例记录（A/B）
    const values: Record<string, any> = {}
    if (testA.value !== null && testA.value !== undefined) values[String(fa.id)] = testA.value
    if (testB.value !== null && testB.value !== undefined) values[String(fb.id)] = testB.value
    await api.createRecord(tableId.value, { values })

    // 4) 重新加载，得到创建后的字段与记录数量
    await load()
    const afterFields = fields.value.length
    const afterList = await api.listRecords(tableId.value, 1, size.value)
    const afterRecords = afterList.total ?? afterList.data?.length ?? records.value.length

    // 5) 输出诊断信息
    diagMsg.value = `诊断完成：字段数 ${beforeFields} → ${afterFields}；记录数 ${beforeRecords} → ${afterRecords}。`
  } catch (e: any) {
    diagErr.value = e?.message || '诊断执行失败'
  } finally {
    diagBusy.value = false
  }
}

async function openGridView() {
  try {
    const v = await api.createView(tableId.value, { name: `匿名网格视图-${Date.now()}`, type: 'grid', configJson: { page: 1, size: size.value }, anonymousEnabled: true })
    router.push({ path: `/grid/${v.id}` })
  } catch (e: any) {
    alert(e?.message || '创建视图失败')
  }
}

// 快速新增：字段与记录
const actionBusy = ref(false)

async function createFieldQuick() {
  const name = prompt('请输入新字段名称', '字段X')
  if (!name) return
  try {
    actionBusy.value = true
    await api.createField(tableId.value, { name, type: 'number', optionsJson: { precision: 0 }, readonly: false })
    fields.value = await api.listFields(tableId.value)
    alert(`字段已创建：${name}`)
  } catch (e: any) {
    alert(e?.message || '创建字段失败')
  } finally {
    actionBusy.value = false
  }
}

async function createRecordQuick() {
  try {
    actionBusy.value = true
    await api.createRecord(tableId.value, { values: {} })
    await load()
    alert('记录已创建')
  } catch (e: any) {
    alert(e?.message || '创建记录失败')
  } finally {
    actionBusy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="table-detail">
    <header>
      <h2>表 #{{ table?.id }} - {{ table?.name }}</h2>
      <small>revision: {{ table?.revision }}</small>
    </header>

    <div class="actions">
      <button :disabled="actionBusy" @click="createFieldQuick">新增字段</button>
      <button :disabled="actionBusy" @click="createRecordQuick">新增记录</button>
    </div>

    <section class="diagnostics">
      <h3>诊断与测试（网格显示）</h3>
      <p>用于快速判断“网格视图无显示”是因为表数据为空，还是网格功能异常。</p>
      <div class="form">
        <label>示例字段 A 值：<input type="number" v-model.number="testA" /></label>
        <label>示例字段 B 值：<input type="number" v-model.number="testB" /></label>
        <button :disabled="diagBusy" @click="runDiagnostics">运行诊断并填充一条测试记录</button>
        <button :disabled="diagBusy" @click="openGridView">创建匿名网格视图并打开</button>
      </div>
      <div v-if="diagBusy" class="state">诊断执行中…</div>
      <div v-else-if="diagErr" class="state error">{{ diagErr }}</div>
      <div v-else-if="diagMsg" class="state ok">{{ diagMsg }}</div>
    </section>

    <section>
      <h3>字段</h3>
      <ul>
        <li v-for="f in fields" :key="f.id">#{{ f.id }} {{ f.name }}</li>
      </ul>
    </section>

    <section>
      <h3>记录（第 {{ page }} 页 / 每页 {{ size }}）</h3>
      <table class="records">
        <thead>
          <tr>
            <th>ID</th>
            <th v-for="f in fields" :key="'h-'+f.id">{{ f.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.id">
            <td>{{ r.id }}</td>
            <td v-for="f in fields" :key="r.id+'-'+f.id">
              {{ r.values?.[String(f.id)] ?? '' }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.table-detail { padding: 16px; }
header { display: flex; align-items: baseline; gap: 8px; }
.actions { display: flex; gap: 8px; margin: 8px 0; }
.diagnostics { margin: 16px 0; padding: 12px; border: 1px solid #ddd; border-radius: 8px; }
.diagnostics .form { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
.state { padding: 8px; color: #666; }
.state.error { color: #b00; }
.state.ok { color: #0a0; }
.records { width: 100%; border-collapse: collapse; }
.records th, .records td { border: 1px solid #ddd; padding: 4px 8px; }
</style>