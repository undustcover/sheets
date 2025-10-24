<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { hierarchy, type Project, type Workbook } from '../services/hierarchy'
import { api } from '../services/api'
import { useRouter } from 'vue-router'

const router = useRouter()

// 状态
const projects = ref<Project[]>([])
const currentProjectId = ref<string>('')
const workbooks = ref<Workbook[]>([])
const currentWorkbookId = ref<string>('')
// 项目展开状态
const expandedProjects = ref<Record<string, boolean>>({})

// 表数据
const tablesMap = ref<Record<number, { id: number; name: string; anonymousEnabled?: boolean; metaJson?: any }>>({})
const currentWorkbook = computed(() => workbooks.value.find(w => w.id === currentWorkbookId.value))

function refresh() {
  projects.value = hierarchy.listProjects()
  if (!currentProjectId.value && projects.value[0]) currentProjectId.value = projects.value[0].id
  for (const p of projects.value) {
    if (expandedProjects.value[p.id] === undefined) {
      expandedProjects.value[p.id] = p.id === currentProjectId.value
    }
  }
  workbooks.value = currentProjectId.value ? hierarchy.listWorkbooks(currentProjectId.value) : []
  if (!currentWorkbookId.value && workbooks.value[0]) currentWorkbookId.value = workbooks.value[0].id
}

onMounted(refresh)
watch(currentWorkbookId, async () => { await loadTablesForCurrentWorkbook() })

async function loadTablesForCurrentWorkbook() {
  const w = currentWorkbook.value
  if (!w) { tablesMap.value = {}; return }
  const map: Record<number, any> = {}
  for (const id of w.tableIds) {
    try { map[id] = await api.getTable(id) } catch { /* 忽略不可访问或不存在表 */ }
  }
  tablesMap.value = map
}

// 展开/收起项目下任务
function toggleProjectExpand(projectId: string) {
  expandedProjects.value[projectId] = !expandedProjects.value[projectId]
}

// 对话框：创建项目/任务
const dialogOpen = ref(false)
const dialogType = ref<'project'|'task'>('project')
const dialogInput = ref('')
function openCreateDialog(type: 'project'|'task') {
  if (type === 'task' && !currentProjectId.value) { alert('请先选择项目'); return }
  dialogType.value = type
  dialogInput.value = ''
  dialogOpen.value = true
}
function confirmDialog() {
  const name = dialogInput.value.trim()
  if (!name) return
  if (dialogType.value === 'project') {
    const p = hierarchy.createProject(name)
    currentProjectId.value = p.id
    expandedProjects.value[p.id] = true
  } else {
    const w = hierarchy.createWorkbook(currentProjectId.value, name)
    currentWorkbookId.value = w.id
  }
  dialogOpen.value = false
  refresh()
}
function cancelDialog() { dialogOpen.value = false }

// 新建表：弹窗输入名称与简述（meta.summary），修复刷新问题
const tableDialogOpen = ref(false)
const tableName = ref('')
const tableSummary = ref('')
function openTableDialog() {
  if (!currentWorkbook.value) { alert('请先选择任务'); return }
  tableName.value = ''
  tableSummary.value = ''
  tableDialogOpen.value = true
}
async function confirmCreateTable() {
  const w = currentWorkbook.value
  if (!w) { tableDialogOpen.value = false; return }
  if (w.tableIds.length >= 100) { alert('该任务已达到100张表的上限'); return }
  const name = tableName.value.trim()
  const summary = tableSummary.value.trim()
  if (!name) return
  try {
    const t = await api.createTable({ name, metaJson: summary ? { summary } : {} })
    hierarchy.addTableToWorkbook(w.id, t.id)
    // 先刷新工作簿，再加载表数据，确保新建表及时显示
    refresh()
    await loadTablesForCurrentWorkbook()
  } catch (e: any) {
    alert(e?.message || '创建表失败')
  } finally {
    tableDialogOpen.value = false
  }
}
function cancelCreateTable() { tableDialogOpen.value = false }

// Luckysheet 打开：复用/创建视图
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
    alert(e?.message || '打开 Luckysheet 失败')
  }
}

// 重命名表：弹窗
const renameDialogOpen = ref(false)
const renameTableId = ref<number | null>(null)
const renameInput = ref('')
function openRenameDialog(tableId: number) {
  renameTableId.value = tableId
  renameInput.value = tablesMap.value[tableId]?.name || ''
  renameDialogOpen.value = true
}
async function confirmRenameTable() {
  if (!renameTableId.value) { renameDialogOpen.value = false; return }
  const name = renameInput.value.trim()
  if (!name) return
  try {
    await api.updateTable(renameTableId.value, { name })
    renameDialogOpen.value = false
    await loadTablesForCurrentWorkbook()
  } catch (e: any) {
    alert(e?.message || '重命名失败')
  }
}
function cancelRenameTable() { renameDialogOpen.value = false; renameTableId.value = null }

// 删除表：后端删除，并移除任务关联
async function deleteTable(tableId: number) {
  if (!confirm('确认删除该表？此操作不可恢复。')) return
  try {
    await api.deleteTable(tableId)
    if (currentWorkbookId.value) hierarchy.removeTableFromWorkbook(currentWorkbookId.value, tableId)
    refresh()
    await loadTablesForCurrentWorkbook()
  } catch (e: any) {
    alert(e?.message || '删除表失败')
  }
}

// 其他开关/移除关联
async function toggleAnonymous(tableId: number) {
  const cur = tablesMap.value[tableId]
  const next = !cur?.anonymousEnabled
  try { await api.updateTable(tableId, { anonymousEnabled: next }); await loadTablesForCurrentWorkbook() } catch (e: any) { alert(e?.message || '更新匿名访问失败') }
}
async function removeTable(tableId: number) {
  if (!currentWorkbookId.value) return
  if (!confirm('移除当前任务的表关联（不删除服务端表）？')) return
  hierarchy.removeTableFromWorkbook(currentWorkbookId.value, tableId)
  await loadTablesForCurrentWorkbook()
  refresh()
}

// 删除项目/任务（移入 <script> 内）
function removeProject(p: Project) {
  if (confirm(`删除项目“${p.name}”？其下任务也将删除。`)) {
    hierarchy.deleteProject(p.id)
    if (currentProjectId.value === p.id) { currentProjectId.value = ''; currentWorkbookId.value = '' }
    refresh()
  }
}
function removeWorkbook(w: Workbook) {
  if (confirm(`删除任务“${w.name}”？不会影响服务端表，仅移除本地关联。`)) {
    hierarchy.deleteWorkbook(w.id)
    if (currentWorkbookId.value === w.id) currentWorkbookId.value = ''
    refresh()
  }
}
</script>

<template>
  <div class="manage">
    <aside class="sidebar">
      <div class="section">
        <div class="section-header">
          <span>项目</span>
          <span class="actions"><button title="新建项目" @click="openCreateDialog('project')">+</button></span>
        </div>
        <ul class="tree">
          <li v-for="p in projects" :key="p.id" :class="{active: currentProjectId===p.id}">
            <div class="row">
              <button class="twisty" @click.stop="toggleProjectExpand(p.id)">{{ expandedProjects[p.id] ? '▾' : '▸' }}</button>
              <span class="label" @click="currentProjectId=p.id; workbooks=hierarchy.listWorkbooks(p.id); currentWorkbookId=''; expandedProjects[p.id]=true">{{ p.name }}</span>
              <span class="icons"><button title="删除项目" @click="removeProject(p)">-</button></span>
            </div>
            <ul class="children" v-if="currentProjectId===p.id && expandedProjects[p.id]">
              <li class="row">
                <span class="label">任务</span>
                <span class="icons"><button title="新建任务" @click="openCreateDialog('task')">+</button></span>
              </li>
              <li v-for="w in workbooks" :key="w.id" :class="{active: currentWorkbookId===w.id}">
                <div class="row">
                  <span class="label" @click="currentWorkbookId=w.id">{{ w.name }}</span>
                  <span class="meta">表数：{{ w.tableIds.length }}/100</span>
                  <span class="icons"><button title="删除任务" @click="removeWorkbook(w)">-</button></span>
                </div>
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </aside>

    <main class="content">
      <h2>项目数据管理</h2>
      <div v-if="!currentWorkbookId" class="empty">请选择一个任务以查看表列表</div>
      <div v-else>
        <div class="toolbar">
          <button title="新建表" @click="openTableDialog">+</button>
        </div>
        <ul class="table-list">
          <li v-for="tid in (currentWorkbook?.tableIds || [])" :key="tid" class="table-row">
            <span class="tname clickable" @click="openLuckysheetForTable(tid)">{{ tablesMap[tid]?.name || '未命名表' }}</span>
            <span class="tsummary">{{ tablesMap[tid]?.metaJson?.summary || '（无内容简述）' }}</span>
            <span class="actions">
              <button @click="openRenameDialog(tid)">重命名</button>
              <button @click="toggleAnonymous(tid)">{{ tablesMap[tid]?.anonymousEnabled ? '关闭匿名' : '允许匿名' }}</button>
              <button @click="removeTable(tid)">移除关联</button>
              <button @click="deleteTable(tid)" style="color:#c0392b">删除表</button>
            </span>
          </li>
          <li v-if="(currentWorkbook?.tableIds || []).length===0" class="empty">该任务下暂无表</li>
        </ul>
      </div>
    </main>

    <!-- 新建项目/任务弹窗 -->
    <div v-if="dialogOpen" class="modal">
      <div class="modal-inner">
        <h3>新建{{ dialogType==='project' ? '项目' : '任务' }}</h3>
        <input v-model="dialogInput" placeholder="请输入名称" />
        <div class="modal-actions">
          <button @click="confirmDialog">确定</button>
          <button @click="cancelDialog">取消</button>
        </div>
      </div>
    </div>

    <!-- 新建表弹窗：名称 + 内容简述 -->
    <div v-if="tableDialogOpen" class="modal">
      <div class="modal-inner">
        <h3>新建表</h3>
        <input v-model="tableName" placeholder="请输入表名称" />
        <textarea v-model="tableSummary" placeholder="请输入表内容简述" rows="4" />
        <div class="modal-actions">
          <button @click="confirmCreateTable">确定</button>
          <button @click="cancelCreateTable">取消</button>
        </div>
      </div>
    </div>

    <!-- 重命名表弹窗 -->
    <div v-if="renameDialogOpen" class="modal">
      <div class="modal-inner">
        <h3>重命名表</h3>
        <input v-model="renameInput" placeholder="请输入新的表名称" />
        <div class="modal-actions">
          <button @click="confirmRenameTable">确定</button>
          <button @click="cancelRenameTable">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.manage { display:flex; height: calc(100vh - 72px); }
.sidebar { width: 320px; border-right: 1px solid #ddd; padding: 12px; overflow:auto; }
.content { flex: 1; padding: 12px; overflow:auto; }
.section-header { display:flex; align-items:center; justify-content:space-between; font-weight:bold; margin-bottom:8px; }
.actions button { width:24px; height:24px; line-height:22px; text-align:center; }
.tree { list-style:none; padding:0; margin:0; }
.row { display:flex; align-items:center; gap:8px; padding:6px 4px; }
.row .label { cursor:pointer; }
.row .icons button { width:24px; height:24px; }
.row .meta { margin-left:auto; font-size:12px; color:#666; }
.children { list-style:none; padding-left:12px; }
.active { background:#f7faff; border-radius:6px; }
.table-list { list-style:none; padding:0; margin:8px 0; }
.table-row { display:flex; align-items:center; gap:12px; padding:8px; border-bottom:1px solid #f0f0f0; }
.table-row .tname { flex: 0 0 240px; }
.table-row .tsummary { flex: 1; color:#555; }
.toolbar { margin-bottom:8px; }
.modal { position: fixed; inset: 0; display:flex; align-items:center; justify-content:center; background: rgba(0,0,0,0.35); }
.modal-inner { background:#fff; padding:16px; border-radius:8px; width: 420px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
.modal-inner textarea { width: 100%; box-sizing: border-box; margin-top: 8px; }
.modal-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }
.empty { color:#666; padding:8px; }
.twisty { width:24px; height:24px; border:1px solid #ddd; background:#fff; border-radius:4px; cursor:pointer; }
.clickable { cursor:pointer; color:#1f7aec; }
.clickable:hover { text-decoration: underline; }
</style>