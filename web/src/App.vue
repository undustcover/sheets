<script setup lang="ts">
import { ref } from 'vue'
import { clearToken, getToken } from './services/api'
import { useRouter } from 'vue-router'

const router = useRouter()
const authed = ref(!!getToken())

function logout() {
  clearToken()
  authed.value = false
  router.push('/login')
}
</script>

<template>
  <header style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
    <h1 style="margin:0;font-size:20px;">轻量级多维表格</h1>
    <nav style="display:flex;gap:8px;">
      <router-link to="/tables">表列表</router-link>
    </nav>
    <div style="margin-left:auto;">
      <button v-if="authed" @click="logout">退出登录</button>
    </div>
  </header>
  <router-view />
</template>

<style scoped>
a { color: #42b883; }
</style>
