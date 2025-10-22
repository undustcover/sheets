<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../services/api'

const route = useRoute()
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

const importing = ref(false)
const importError = ref<string | null>(null)
async function importCsv(ev: Event) {
  const inp = ev.target as HTMLInputElement
  const f = inp.files?.[0]
  if (!f) return
  importing.value = true
  importError.value = null
  try {
    await api.importCsv(tableId.value, f)
    await load()
    inp.value = ''
    alert('导入成功')
  } catch (e: any) {
    importError.value = e?.message || '导入失败'
  } finally {
    importing.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <h2>表详情：{{ table?.name }} (#{{ table?.id }})</h2>
    <p v-if="loading">加载中...</p>
    <p v-if="error" style="color:#e74c3c">{{ error }}</p>

    <div v-if="!loading && !error">
      <div style="margin-bottom:12px;display:flex;gap:12px;align-items:center;">
        <label>
          导入 CSV：
          <input type="file" accept=".csv,text/csv" @change="importCsv" :disabled="importing" />
        </label>
        <span v-if="importing">导入中...</span>
        <span v-if="importError" style="color:#e74c3c">{{ importError }}</span>
      </div>

      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <thead>
          <tr>
            <th>ID</th>
            <th v-for="f in fields" :key="f.id">{{ f.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.id">
            <td>{{ r.id }}</td>
            <td v-for="f in fields" :key="f.id">
              <input
                :value="r.values?.[String(f.id)] ?? ''"
                @change="(e:any) => updateCell(r.id, f.id, coerceInput(e.target.value, f.type))"
                :readonly="f.readonly"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script lang="ts">
// Provide basic coercion consistent with backend expectations for simple fields
export default {
  methods: {
    coerceInput(v: any, type: string) {
      switch (type) {
        case 'number': {
          const n = Number(v)
          return Number.isFinite(n) ? n : 0
        }
        case 'boolean': {
          return v === 'true' || v === true
        }
        default:
          return v
      }
    },
  },
}
</script>