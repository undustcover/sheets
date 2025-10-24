<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { hierarchy, type Project, type Workbook } from '../services/hierarchy'
import { api } from '../services/api'

const open = ref(false)
const projects = ref<Project[]>([])
const currentProjectId = ref<string>('')
const workbooks = ref<Workbook[]>([])
const currentWorkbookId = ref<string>('')

function refresh() {
  projects.value = hierarchy.listProjects()
  if (!currentProjectId.value && projects.value[0]) currentProjectId.value = projects.value[0].id
  workbooks.value = currentProjectId.value ? hierarchy.listWorkbooks(currentProjectId.value) : []
  if (!currentWorkbookId.value && workbooks.value[0]) currentWorkbookId.value = workbooks.value[0].id
}

onMounted(refresh)

function toggleDrawer() { open.value = !open.value }

// 项目操作
const newProjectName = ref('')
function addProject() {
  const p = hierarchy.createProject(newProjectName.value)
  newProjectName.value = ''
  currentProjectId.value = p.id
  refresh()
}
function renameProject(p: Project) {
  const name = prompt('重命名项目', p.name)
  if (name !== null) { hierarchy.renameProject(p.id, name); refresh() }
}
function removeProject(p: Project) {
  if (confirm(`删除项目“${p.name}”？其下工作簿也将删除。`)) { hierarchy.deleteProject(p.id); if (currentProjectId.value === p.id) currentProjectId.value = ''; refresh() }
}

// 工作簿操作
const newWorkbookName = ref('')
function addWorkbook() {
  if (!currentProjectId.value) { alert('请先选择项目'); return }
  const w = hierarchy.createWorkbook(currentProjectId.value, newWorkbookName.value)
  newWorkbookName.value = ''
  currentWorkbookId.value = w.id
  refresh()
}
function renameWorkbook(w: Workbook) {
  const name = prompt('重命名工作簿', w.name)
  if (name !== null) { hierarchy.renameWorkbook(w.id, name); refresh() }
}
function removeWorkbook(w: Workbook) {
  if (confirm(`删除工作簿“${w.name}”？不影响服务端表数据，仅移除本地关联。`)) { hierarchy.deleteWorkbook(w.id); if (currentWorkbookId.value === w.id) currentWorkbookId.value = ''; refresh() }
}

// 表操作（使用服务端 API），限制每工作簿最多100张表
const tablesMap = ref<Record<number, { id: number; name: string; anonymousEnabled?: boolean }>>({})
const currentWorkbook = computed(() => workbooks.value.find(w => w.id === currentWorkbookId.value))

async function loadTablesForCurrentWorkbook() {
  const w = currentWorkbook.value
  if (!w) return
  // 拉取表详情（根据已关联的表ID）
  const map: Record<number, any> = {}
  for (const id of w.tableIds) {
    try { map[id] = await api.getTable(id) } catch { /* 忽略不可访问或不存在表 */ }
  }
  tablesMap.value = map
}

async function createTableInWorkbook() {
  const w = currentWorkbook.value
  if (!w) { alert('请先选择工作簿'); return }
  if (w.tableIds.length >= 100) { alert('该工作簿已达到100张表的上限'); return }
  const name = prompt('新建表格名称', '未命名表格')
  if (!name) return
  try {
    const t = await api.createTable({ name })
    hierarchy.addTableToWorkbook(w.id, t.id)
    await loadTablesForCurrentWorkbook()
    refresh()
  } catch (e: any) {
    alert(e?.message || '创建表失败')
  }
}

async function renameTable(tableId: number) {
  const cur = tablesMap.value[tableId]
  const name = prompt('重命名表格', cur?.name || '')
  if (name === null) return
  try { await api.updateTable(tableId, { name }); await loadTablesForCurrentWorkbook() } catch (e: any) { alert(e?.message || '重命名失败') }
}

async function deleteTable(tableId: number) {
  if (!confirm('删除表格后不可恢复，确认删除？')) return
  try {
    // 后端删除接口：DELETE /api/tables/:id （若暂未提供，可保留为本地移除）
    // await api.deleteTable(tableId)
    hierarchy.removeTableFromWorkbook(currentWorkbookId.value, tableId)
    await loadTablesForCurrentWorkbook()
    refresh()
  } catch (e: any) { alert(e?.message || '删除失败或接口未实现，已从工作簿移除关联') }
}

async function toggleAnonymous(tableId: number) {
  const cur = tablesMap.value[tableId]
  const next = !cur?.anonymousEnabled
  try { await api.updateTable(tableId, { anonymousEnabled: next }); await loadTablesForCurrentWorkbook() } catch (e: any) { alert(e?.message || '更新匿名访问失败') }
}
</script>

<template>
  <div>
    <button @click="toggleDrawer">项目与工作簿</button>
    <div v-if="open" class="drawer">
      <div class="drawer-content">
        <div class="sidebar">
          <div class="section">
            <div class="section-header">项目</div>
            <div class="section-body">
              <ul>
                <li v-for="p in projects" :key="p.id" :class="{active: currentProjectId===p.id}">
                  <span @click="currentProjectId=p.id; currentWorkbookId=''; workbooks=hierarchy.listWorkbooks(p.id)">{{ p.name }}</span>
                  <span class="actions">
                    <button @click="renameProject(p)">重命名</button>
                    <button @click="removeProject(p)">删除</button>
                  </span>
                </li>
              </ul>
              <div class="create-row">
                <input v-model="newProjectName" placeholder="新建项目名称" />
                <button @click="addProject">创建</button>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-header">工作簿</div>
            <div class="section-body">
              <ul>
                <li v-for="w in workbooks" :key="w.id" :class="{active: currentWorkbookId===w.id}">
                  <span @click="currentWorkbookId=w.id; loadTablesForCurrentWorkbook()">{{ w.name }}</span>
                  <span class="meta">表数：{{ w.tableIds.length }}/100</span>
                  <span class="actions">
                    <button @click="renameWorkbook(w)">重命名</button>
                    <button @click="removeWorkbook(w)">删除</button>
                  </span>
                </li>
              </ul>
              <div class="create-row">
                <input v-model="newWorkbookName" placeholder="新建工作簿名称" />
                <button @click="addWorkbook">创建</button>
              </div>
            </div>
          </div>
        </div>

        <div class="content">
          <div v-if="!currentWorkbookId" class="empty">请选择一个工作簿</div>
          <div v-else>
            <div class="toolbar">
              <button @click="createTableInWorkbook">新建表格</button>
            </div>
            <table class="simple">
              <thead>
                <tr>
                  <th>表ID</th>
                  <th>名称</th>
                  <th>匿名访问</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tid in (currentWorkbook?.tableIds || [])" :key="tid">
                  <td>{{ tid }}</td>
                  <td>{{ tablesMap[tid]?.name || '-' }}</td>
                  <td>{{ tablesMap[tid]?.anonymousEnabled ? '已开启' : '未开启' }}</td>
                  <td>
                    <button @click="renameTable(tid)">重命名</button>
                    <button @click="toggleAnonymous(tid)">{{ tablesMap[tid]?.anonymousEnabled ? '关闭匿名' : '允许匿名' }}</button>
                    <button @click="deleteTable(tid)">移除关联/删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <button class="close" @click="toggleDrawer">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drawer { position: fixed; inset: 0; background: rgba(0,0,0,0.25); display:flex; }
.drawer-content { margin-left:auto; width: 80%; max-width: 1024px; height: 100%; background: #fff; display:flex; flex-direction: row; box-shadow: -4px 0 16px rgba(0,0,0,0.2); }
.sidebar { width: 36%; border-right: 1px solid #ddd; padding: 12px; overflow:auto; }
.content { flex: 1; padding: 12px; overflow:auto; }
.section { margin-bottom: 16px; }
.section-header { font-weight: bold; margin-bottom: 8px; }
.section-body ul { list-style: none; padding: 0; margin: 0; }
.section-body li { display:flex; align-items:center; gap: 8px; padding: 6px 4px; border-radius: 4px; }
.section-body li.active { background: #f5f8ff; }
.section-body .actions { margin-left:auto; display:flex; gap:6px; }
.section-body .meta { font-size: 12px; color: #666; }
.create-row { display:flex; gap:6px; margin-top:8px; }
.simple { width:100%; border-collapse: collapse; }
.simple th, .simple td { border: 1px solid #ddd; padding: 6px; }
.toolbar { margin-bottom: 8px; display:flex; gap:8px; }
.close { position:absolute; top:12px; right:12px; }
.empty { color:#666; }
</style>