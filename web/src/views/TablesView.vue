<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../services/api'

const loading = ref(true)
const error = ref<string | null>(null)
const tables = ref<any[]>([])

onMounted(async () => {
  try {
    loading.value = true
    tables.value = await api.listTables()
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <h2>表列表（管理员）</h2>
    <p v-if="loading">加载中...</p>
    <p v-if="error" style="color:#e74c3c">{{ error }}</p>
    <ul v-if="!loading && !error" style="display:flex;flex-direction:column;gap:6px;">
      <li v-for="t in tables" :key="t.id" style="display:flex;align-items:center;gap:8px;">
        <router-link :to="`/tables/${t.id}`">{{ t.name }} (#{{ t.id }})</router-link>
      </li>
    </ul>
  </div>
</template>