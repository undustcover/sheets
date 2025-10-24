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
    const cached = getStoredViewId(tableId)
    if (cached && Number.isFinite(cached)) {
      router.push(`/grid/${cached}`)
      return
    }
    const v = await api.createView(tableId, { name: `Luckysheet视图-${Date.now()}`, type: 'grid', configJson: { page: 1, size: 50 }, anonymousEnabled: true })
    setStoredViewId(tableId, v.id)
    router.push(`/grid/${v.id}`)
  } catch (e: any) {
    error.value = e?.message || '打开 Luckysheet 失败'
  }
}

async function toggleAnonymous(table: any, enabled: boolean) {
  try {
    await api.updateTable(table.id, { anonymousEnabled: enabled })
    table.anonymousEnabled = enabled
  } catch (e: any) {
    error.value = e?.message || '更新匿名访问失败'
  }
}

onMounted(async () => {
  try {
    loading.value = true
    error.value = null
    tables.value = await api.listTables()
    // 管理页：不再自动跳转，展示开关与操作按钮
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
    const t = await api.createTable({ name: newTableName.value.trim(), anonymousEnabled: false })
    tables.value.push(t)
  } catch (e: any) {
    error.value = e?.message || '创建表失败'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div>
    <h2>表管理</h2>
    <div style="display:flex;gap:8px;align-items:center;">
      <input v-model="newTableName" placeholder="新表名称" />
      <button :disabled="creating" @click="createTableAndOpen">{{ creating ? '创建中…' : '创建' }}</button>
    </div>

    <div style="margin-top:16px;">
      <p v-if="loading">加载中...</p>
      <p v-if="error" style="color:#e74c3c">{{ error }}</p>
      <div v-if="!loading && !error">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">ID</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">名称</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">允许匿名访问</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in tables" :key="t.id">
              <td style="padding:8px;border-bottom:1px solid #f0f0f0;">{{ t.id }}</td>
              <td style="padding:8px;border-bottom:1px solid #f0f0f0;">{{ t.name }}</td>
              <td style="padding:8px;border-bottom:1px solid #f0f0f0;">
                <label style="display:flex;align-items:center;gap:6px;">
                  <input type="checkbox" :checked="!!t.anonymousEnabled" @change="toggleAnonymous(t, ($event.target as HTMLInputElement).checked)" />
                  <span>{{ t.anonymousEnabled ? '开启' : '关闭' }}</span>
                </label>
              </td>
              <td style="padding:8px;border-bottom:1px solid #f0f0f0;">
                <button @click="openLuckysheetForTable(t.id)">打开 Luckysheet</button>
              </td>
            </tr>
            <tr v-if="tables.length === 0">
              <td colspan="4" style="padding:12px;text-align:center;color:#666;">暂无表，请先创建。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 维持默认样式 */
</style>