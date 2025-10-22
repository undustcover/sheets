import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import LoginView from './views/LoginView.vue'
import TablesView from './views/TablesView.vue'
import TableDetailView from './views/TableDetailView.vue'
import { getToken } from './services/api'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/tables' },
  { path: '/login', component: LoginView },
  { path: '/tables', component: TablesView },
  { path: '/tables/:id', component: TableDetailView, props: true },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const token = getToken()
  if (!token && to.path !== '/login') {
    return '/login'
  }
  return true
})

export default router