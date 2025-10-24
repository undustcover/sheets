import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import LoginView from './views/LoginView.vue'
import TablesView from './views/TablesView.vue'
import GridView from './views/GridView.vue'
import ManageView from './views/ManageView.vue'
import { getToken } from './services/api'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/manage' },
  { path: '/login', component: LoginView },
  { path: '/manage', component: ManageView },
  { path: '/tables', component: TablesView },
  // Anonymous grid view route
  { path: '/grid/:viewId', component: GridView, props: true },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const token = getToken()
  // allow login and anonymous grid view
  if (!token && to.path !== '/login' && !to.path.startsWith('/grid/')) {
    return '/login'
  }
  return true
})

export default router