<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../services/api'

const router = useRouter()
const loading = ref(true)
const error = ref<string | null>(null)
const tables = ref<any[]>([])
const creating = ref(false)
const newTableName = ref('新表')

function getStoredViewId(tableId: number): number | null {
  try {
    const v = localStorage.getItem(`gridViewId:${tableId}`)
    return v ? Number(v) : null
  } catch { return null }
}
function setStoredViewId(tableId: number, viewId: number) {
  try { localStorage.setItem(`gridViewId:${tableId}`, String(viewId)) } catch {}
}

async function openLuckysheetForTable(tableId: number) {
  try {
    // 尝试复用之前创建的视图
    const cached = getStoredViewId(tableId)
    if (cached && Number.isFinite(cached)) {
      router.push(`/grid/${cached}`)
      return
    }
    // 创建匿名网格视图并打开
    const v = await api.createView(tableId, { name: `Luckysheet视图-${Date.now()}`, type: 'grid', configJson: { page: 1, size: 50 }, anonymousEnabled: true })
    setStoredViewId(tableId, v.id)
    router.push(`/grid/${v.id}`)
  } catch (e: any) {
    error.value = e?.message || '打开 Luckysheet 失败'
  }
}

onMounted(async () => {
  try {
    loading.value = true
    error.value = null
    tables.value = await api.listTables()
    if (tables.value.length > 0) {
      // 登录后直接进入 Luckysheet，取第一个表
      await openLuckysheetForTable(tables.value[0].id)
    }
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
})

async function createTableAndOpen() {
  if (!newTableName.value.trim()) return
  try {
    creating.value = true
    const t = await api.createTable({ name: newTableName.value.trim() })
    await openLuckysheetForTable(t.id)
  } catch (e: any) {
    error.value = e?.message || '创建表失败'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div>
    <h2>表创建</h2>
    <div style="display:flex;gap:8px;align-items:center;">
      <input v-model="newTableName" placeholder="新表名称" />
      <button :disabled="creating" @click="createTableAndOpen">{{ creating ? '创建中…' : '创建并打开 Luckysheet' }}</button>
    </div>

    <div style="margin-top:16px;">
      <p v-if="loading">加载中...</p>
      <p v-if="error" style="color:#e74c3c">{{ error }}</p>
      <p v-if="!loading && !error && tables.length === 0">暂无表，请先创建。</p>
      <p v-else-if="tables.length > 0">正在打开 Luckysheet 视图…</p>
    </div>
  </div>
</template>