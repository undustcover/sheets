<script setup lang="ts">
import { ref } from 'vue'
import { api, setToken } from '../services/api'
import { useRouter } from 'vue-router'

const router = useRouter()
const username = ref('admin')
const password = ref('admin')
const error = ref<string | null>(null)
const loading = ref(false)

async function submit() {
  error.value = null
  loading.value = true
  try {
    const resp = await api.login(username.value, password.value)
    setToken(resp.token)
    router.push('/tables')
  } catch (e: any) {
    error.value = e?.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div style="max-width:360px;margin:40px auto;">
    <h2>登录</h2>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <label>
        用户名
        <input v-model="username" placeholder="用户名" />
      </label>
      <label>
        密码
        <input v-model="password" type="password" placeholder="密码" />
      </label>
      <button :disabled="loading" @click="submit">{{ loading ? '登录中...' : '登录' }}</button>
      <p v-if="error" style="color:#e74c3c;">{{ error }}</p>
    </div>
  </div>
</template>