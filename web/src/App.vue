<script setup lang="ts">
import { computed, ref } from 'vue'
import { clearToken, getToken } from './services/api'
import { useRouter } from 'vue-router'
import HierarchyDrawer from './components/HierarchyDrawer.vue'

const router = useRouter()
const authed = computed(() => !!getToken())

function logout() {
  clearToken()
  router.push('/login')
}

const showProjects = ref(false)
function toggleProjects() { showProjects.value = !showProjects.value }
</script>

<template>
  <header style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
    <h1 style="margin:0;font-size:20px;">轻量级多维表格</h1>
    <div style="margin-left:auto;display:flex;gap:8px;">
      <button v-if="authed" @click="toggleProjects">项目与工作簿</button>
      <button v-if="authed" @click="logout">退出登录</button>
    </div>
  </header>
  <router-view />
  <HierarchyDrawer v-if="authed && showProjects" />
</template>

<style scoped>
a { color: #42b883; }
</style>
