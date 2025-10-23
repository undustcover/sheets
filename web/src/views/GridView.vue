<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../services/api'
import 'luckysheet/dist/css/luckysheet.css'

const route = useRoute()
const viewId = computed(() => Number(route.params.viewId))

const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)
const view = ref<any | null>(null)
const records = ref<Array<{ id: number; values: Record<string, any> }>>([])
const page = ref(1)
const size = ref(20)
const total = ref(0)
const fields = ref<Array<{ id: number; name: string; type?: string }>>([])

// 冲突状态：记录发生冲突的单元格信息（M2-05b）
const conflicts = ref<Array<{
  recordId: number;
  fieldId: number;
  currentValue: any;
  attemptedValue: any;
  currentFormulaExpr?: string;
  attemptedFormulaExpr?: string;
}>>([])

let luckysheetLib: any | null = null

async function ensureLuckysheet() {
  if (luckysheetLib) return luckysheetLib
  const jQuery = await import('jquery')
  ;(window as any).$ = (jQuery as any).default || jQuery
  ;(window as any).jQuery = (jQuery as any).default || jQuery
  const mod = await import('luckysheet')
  luckysheetLib = (mod as any).default || mod
  return luckysheetLib
}

const columnIdsFromRecords = computed(() => {
  const set = new Set<string>()
  for (const r of records.value) {
    for (const k of Object.keys(r.values || {})) set.add(k)
  }
  return Array.from(set).sort((a, b) => {
    const na = Number(a)
    const nb = Number(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })
})

const columnIds = computed(() => {
  const ids = columnIdsFromRecords.value
  if (ids.length > 0) return ids
  // Fallback to all field ids when there is no record-derived columns
  return fields.value.map(f => String(f.id)).sort((a, b) => Number(a) - Number(b))
})

// 变更缓冲：记录用户在 Luckysheet 中的编辑（M2-04）
const dirtyWrites = ref<Array<{ recordId: number; fieldId: string; value: any; row: number; column: number }>>([])

function coordToKey(row: number, column: number): { recordId: number; fieldId: string } | null {
  // 行/列 0 为只读：列头与 ID 列
  if (row <= 0 || column <= 0) return null
  const rec = records.value[row - 1]
  const fid = columnIds.value[column - 1]
  if (!rec || !fid) return null
  return { recordId: rec.id, fieldId: fid }
}

function originalValue(row: number, column: number): any {
  if (row === 0 && column === 0) return 'ID'
  if (row === 0 && column > 0) {
    const name = fieldName(columnIds.value[column - 1])
    return name
  }
  if (row > 0 && column === 0) {
    const rec = records.value[row - 1]
    return rec?.id ?? ''
  }
  const rec = records.value[row - 1]
  const fid = columnIds.value[column - 1]
  return getCellValue(rec, fid)
}

function upsertDirtyWrite(recordId: number, fieldId: string, value: any, row: number, column: number) {
  const idx = dirtyWrites.value.findIndex(x => x.recordId === recordId && x.fieldId === fieldId)
  if (idx >= 0) {
    dirtyWrites.value[idx] = { recordId, fieldId, value, row, column }
  } else {
    dirtyWrites.value.push({ recordId, fieldId, value, row, column })
  }
}

function clearDirtyWrites() {
  dirtyWrites.value = []
}

async function renderLuckysheet() {
  const cols = columnIds.value
  const dataRows = records.value

  const celldata: Array<{ r: number; c: number; v: any }> = []
  celldata.push({ r: 0, c: 0, v: { v: 'ID', m: 'ID', bl: 1 } })
  for (let j = 0; j < cols.length; j++) {
    const name = fieldName(cols[j])
    celldata.push({ r: 0, c: j + 1, v: { v: name, m: name, bl: 1 } })
  }
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i]
    celldata.push({ r: i + 1, c: 0, v: { v: r.id, m: String(r.id) } })
    for (let j = 0; j < cols.length; j++) {
      const fid = cols[j]
      const v = getCellValue(r, fid)
      
      // 检查是否为冲突单元格（M2-05b）
      const isConflict = conflicts.value.some(conflict => 
        conflict.recordId === r.id && String(conflict.fieldId) === fid
      )
      
      const cellValue = { v, m: String(v) }
      
      // 为冲突单元格添加红色背景高亮
      if (isConflict) {
        cellValue.bg = '#ffebee' // 浅红色背景
        cellValue.fc = '#c62828' // 深红色文字
        cellValue.bl = 1 // 加粗
      }
      
      celldata.push({ r: i + 1, c: j + 1, v: cellValue })
    }
  }

  const container = document.getElementById('luckysheet')
  if (!container) return
  try { (window as any).luckysheet?.destroy?.() } catch {}

  const luckysheet = await ensureLuckysheet()

  luckysheet.create({
    container: 'luckysheet',
    lang: 'zh',
    showinfobar: false,
    data: [
      {
        name: view.value ? view.value.name : 'Sheet1',
        index: 0,
        status: 1,
        row: Math.max(dataRows.length + 2, 50),
        column: Math.max(cols.length + 2, 10),
        celldata,
      },
    ],
    hook: {
      // 捕获用户编辑后的更新事件，建立坐标到记录/字段的映射（M2-04）
      updated: (operate: any) => {
        try {
          const range = operate?.range?.[0]
          const r = range?.row?.[0]
          const c = range?.column?.[0]
          if (typeof r !== 'number' || typeof c !== 'number') return

          // 只读区域：列头与 ID 列，立即还原
          if (r === 0 || c === 0) {
            const ov = originalValue(r, c)
            ;(window as any).luckysheet?.setCellValue?.(r, c, ov)
            alert('该单元格为只读：列头/ID 列')
            return
          }

          const key = coordToKey(r, c)
          if (!key) return

          // 读取当前显示值作为写入值（v/m 取 m 的展示值）
          const cur = (window as any).luckysheet?.getCellValue?.(r, c, { type: 'm' })
          const ov = originalValue(r, c)
          // 去除无效编辑：与原值一致时清除缓冲
          if (String(cur ?? '') === String(ov ?? '')) {
            dirtyWrites.value = dirtyWrites.value.filter(x => !(x.recordId === key.recordId && x.fieldId === key.fieldId))
            return
          }
          upsertDirtyWrite(key.recordId, key.fieldId, cur, r, c)
        } catch (e) {
          console.warn('luckysheet.updated hook error', e)
        }
      }
    }
  })
}

function fieldName(fid: string) {
  const f = fields.value.find(x => String(x.id) === fid || x.name === fid)
  return f?.name ?? fid
}

function getCellValue(r: { values?: Record<string, any> }, fid: string) {
  const byId = r.values?.[fid]
  if (byId !== undefined && byId !== null) return byId
  // Try name-based access when values keyed by field name
  const name = fieldName(fid)
  const byName = r.values?.[name]
  return byName === undefined || byName === null ? '' : byName
}

// 筛选/排序面板状态（M2-06）
const showFilterPanel = ref(false)
const filterItems = ref<Array<{ fid: string; op: string; val?: any; val2?: any }>>([])
let sortItem: { fid: string; dir: 'asc' | 'desc' } | null = null
let didInitFromConfig = false

function toggleFilterPanel() { showFilterPanel.value = !showFilterPanel.value }
function addFilter() { filterItems.value.push({ fid: String(columnIds.value[0] || ''), op: 'eq', val: '' }) }
function removeFilter(idx: number) { filterItems.value.splice(idx, 1) }

// 类型辅助：根据字段 ID 获取类型
function fieldType(fid: string): string | undefined {
  const f = fields.value.find((x) => String(x.id) === String(fid))
  return f?.type
}

function opsForField(fid: string): Array<{ value: string; label: string }> {
  const t = fieldType(fid)
  if (t === 'number' || t === 'date') {
    return [
      { value: 'eq', label: '等于' },
      { value: 'ne', label: '不等于' },
      { value: 'lt', label: '＜' },
      { value: 'lte', label: '≤' },
      { value: 'gt', label: '＞' },
      { value: 'gte', label: '≥' },
      { value: 'between', label: '区间' },
      { value: 'is_null', label: '为空' },
      { value: 'is_not_null', label: '不为空' },
    ]
  }
  if (t === 'boolean') {
    return [
      { value: 'eq', label: '等于' },
      { value: 'ne', label: '不等于' },
      { value: 'is_null', label: '为空' },
      { value: 'is_not_null', label: '不为空' },
    ]
  }
  // text / select / multi_select / others
  return [
    { value: 'eq', label: '等于' },
    { value: 'ne', label: '不等于' },
    { value: 'contains', label: '包含' },
    { value: 'in', label: '属于集合' },
    { value: 'is_null', label: '为空' },
    { value: 'is_not_null', label: '不为空' },
  ]
}

function inputTypeForField(fid: string): string {
  const t = fieldType(fid)
  if (t === 'number') return 'number'
  if (t === 'date') return 'date'
  return 'text'
}

function serializeFiltersForQuery(): Array<{ fieldId: number; op: string; value?: any }> | undefined {
  if (!filterItems.value.length) return undefined
  return filterItems.value.map((it) => {
    const fieldId = Number(it.fid)
    let value: any
    const op = it.op === 'neq' ? 'ne' : it.op
    if (op === 'between') {
      value = [coerceValue(fieldId, it.val), coerceValue(fieldId, it.val2)]
    } else if (op === 'in') {
      const raw = (it.val ?? '')
      const arr = Array.isArray(raw) ? raw : String(raw).split(',')
      value = arr.map((x: any) => coerceValue(fieldId, typeof x === 'string' ? x.trim() : x))
    } else if (op === 'is_null' || op === 'is_not_null') {
      value = undefined
    } else {
      value = coerceValue(fieldId, it.val)
    }
    return { fieldId, op, value }
  })
}

function serializeSortForQuery(): { fieldId: number; direction: 'asc'|'desc' } | undefined {
  if (!sortItem || !sortItem.fid) return undefined
  return { fieldId: Number(sortItem.fid), direction: sortItem.dir }
}

function coerceValue(fieldId: number, raw: any): any {
  const f = fields.value.find((x) => x.id === fieldId)
  const t = f?.type
  if (raw === '' || raw === undefined) return undefined
  if (t === 'number') {
    const n = Number(raw)
    return Number.isNaN(n) ? undefined : n
  }
  if (t === 'boolean') {
    if (raw === true || raw === false) return raw
    if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase()
      if (s === 'true' || s === '是' || s === 'yes') return true
      if (s === 'false' || s === '否' || s === 'no') return false
    }
  }
  // date/select/text 等保持字符串由后端处理或按 ISO 比较
  return raw
}

// 数据加载：匿名视图数据 + 字段列表（用于列头显示）
async function load() {
  try {
    loading.value = true
    error.value = null
    const filters = serializeFiltersForQuery()
    const sort = serializeSortForQuery()
    const resp = await api.getViewData(viewId.value, { page: page.value, size: size.value, filters, sort })
    view.value = resp.view
    // 首次加载：从视图配置回显分页/筛选/排序
    const cfg = (resp.view?.configJson ?? {}) as any
    if (!didInitFromConfig && cfg) {
      if (typeof cfg.page === 'number') page.value = cfg.page
      if (typeof cfg.size === 'number') size.value = cfg.size
      if (Array.isArray(cfg.filters)) {
        filterItems.value = cfg.filters.map((f: any) => {
          const it: any = { fid: String(f.fieldId), op: String(f.op || 'eq'), val: undefined, val2: undefined }
          if (it.op === 'between' && Array.isArray(f.value)) {
            it.val = f.value[0]
            it.val2 = f.value[1]
          } else {
            it.val = f.value
          }
          return it
        })
      }
      if (cfg.sort && cfg.sort.fieldId) {
        sortItem = { fid: String(cfg.sort.fieldId), dir: cfg.sort.direction === 'desc' ? 'desc' : 'asc' }
      }
      didInitFromConfig = true
    }
    records.value = resp.data
    total.value = resp.total
    // 加载字段名与类型用于列头显示与类型适配
    const tableId = resp.view?.tableId ?? undefined
    if (tableId) {
      const fs = await api.listFields(tableId)
      fields.value = Array.isArray(fs) ? fs.map((f: any) => ({ id: f.id, name: f.name, type: f.type })) : []
    } else {
      fields.value = []
    }
    await renderLuckysheet()
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function applyFilterSort() { goto(1) }

async function saveViewConfig() {
  if (!view.value || !view.value.tableId) {
    alert('无法保存：缺少 tableId 或未加载视图信息')
    return
  }
  const confirmed = window.confirm('保存后将影响所有用户的视图配置，是否继续？')
  if (!confirmed) return
  try {
    const cfg: any = {
      page: page.value,
      size: size.value,
      filters: serializeFiltersForQuery(),
      sort: serializeSortForQuery(),
    }
    await api.updateView(view.value.tableId, view.value.id, { configJson: cfg })
    alert('视图配置已保存')
  } catch (e: any) {
    alert(e?.message || '保存视图配置失败（可能需要管理员权限）')
  }
}

async function goto(p: number) {
  page.value = Math.max(1, p)
  await load()
}

// 批量保存（M2-05）：发送变更缓冲到后端，处理并发冲突
async function saveDirty() {
  if (!view.value || dirtyWrites.value.length === 0) return
  const tableId = view.value.tableId
  const revision = view.value.revision
  const writes = dirtyWrites.value.map(w => ({ recordId: w.recordId, fieldId: Number(w.fieldId), value: w.value }))
  try {
    saving.value = true
    const resp = await api.batchCellsWrite(tableId, { revision, writes })
    // 成功：更新本地 revision，清空缓冲并重新加载
    view.value.revision = resp.revision
    clearDirtyWrites()
    await load()
    alert(`保存成功，revision 更新为 ${resp.revision}`)
  } catch (e: any) {
    // 并发冲突：提示最新版本并刷新视图数据，但保留缓冲以便用户确认后重试
    if (e?.status === 409) {
      const latest = e?.details?.latestRevision
      if (typeof latest === 'number') {
        view.value.revision = latest
      }
      
      // 存储冲突信息用于高亮显示（M2-05b）
      if (e?.details?.conflicts && Array.isArray(e.details.conflicts)) {
        conflicts.value = e.details.conflicts
      } else {
        conflicts.value = []
      }
      
      await load()
      await renderLuckysheet() // 重新渲染以应用冲突高亮
      
      const conflictCount = conflicts.value.length
      if (conflictCount > 0) {
        alert(`检测到版本冲突：已更新到最新数据，发现 ${conflictCount} 个冲突单元格（已高亮显示），请确认后重新保存。`)
      } else {
        alert('检测到版本冲突：已更新到最新数据，请确认后重新保存。')
      }
    } else if (e?.status === 403) {
      alert('保存失败：没有编辑权限或存在只读记录/字段。')
    } else {
      alert(e?.message || '保存失败')
    }
  } finally {
    saving.value = false
  }
}

// 冲突值格式化（M2-05b）
function formatConflictValue(value: any): string {
  if (value === null || value === undefined) {
    return '(空值)'
  }
  if (typeof value === 'string' && value === '') {
    return '(空字符串)'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

function formatValueDiff(currentValue: any, attemptedValue: any): string {
  const current = formatConflictValue(currentValue)
  const attempted = formatConflictValue(attemptedValue)
  
  if (typeof currentValue === 'number' && typeof attemptedValue === 'number') {
    const diff = attemptedValue - currentValue
    const sign = diff > 0 ? '+' : ''
    return `数值变化: ${current} → ${attempted} (${sign}${diff})`
  }
  
  if (typeof currentValue === 'string' && typeof attemptedValue === 'string') {
    if (currentValue.length !== attemptedValue.length) {
      return `文本长度变化: ${currentValue.length} → ${attemptedValue.length} 字符`
    }
    return `文本内容变化: "${current}" → "${attempted}"`
  }
  
  return `类型/值变化: ${current} → ${attempted}`
}

// 冲突解决（M2-05b）
async function resolveConflicts(strategy: 'accept-all-current' | 'accept-all-attempted' | 'accept-selected') {
  if (conflicts.value.length === 0) return

  try {
    if (strategy === 'accept-all-current') {
      // 保留服务器版本：清除所有相关的本地修改
      for (const conflict of conflicts.value) {
        dirtyWrites.value = dirtyWrites.value.filter(w => 
          !(w.recordId === conflict.recordId && String(w.fieldId) === String(conflict.fieldId))
        )
      }
      conflicts.value = []
      await renderLuckysheet()
      alert('已保留服务器版本，冲突已解决。')
      
    } else if (strategy === 'accept-all-attempted') {
      // 保留本地修改：更新 dirtyWrites 中的值为尝试写入的值
      for (const conflict of conflicts.value) {
        const existingWrite = dirtyWrites.value.find(w => 
          w.recordId === conflict.recordId && String(w.fieldId) === String(conflict.fieldId)
        )
        if (existingWrite) {
          existingWrite.value = conflict.attemptedValue
        } else {
          // 如果 dirtyWrites 中没有，需要找到对应的行列坐标
          const recordIndex = records.value.findIndex(r => r.id === conflict.recordId)
          const fieldIndex = columnIds.value.findIndex(fid => String(fid) === String(conflict.fieldId))
          if (recordIndex >= 0 && fieldIndex >= 0) {
            dirtyWrites.value.push({
              recordId: conflict.recordId,
              fieldId: String(conflict.fieldId),
              value: conflict.attemptedValue,
              row: recordIndex + 1,
              column: fieldIndex + 1
            })
          }
        }
      }
      conflicts.value = []
      await renderLuckysheet()
      alert('已保留您的修改，请重新保存。')
      
    } else if (strategy === 'accept-selected') {
      // 按用户选择解决：读取每个冲突的单选框选择
      for (let i = 0; i < conflicts.value.length; i++) {
        const conflict = conflicts.value[i]
        const radioName = `conflict-${i}`
        const selectedRadio = document.querySelector(`input[name="${radioName}"]:checked`) as HTMLInputElement
        
        if (selectedRadio?.value === 'current') {
          // 保留服务器版本：移除本地修改
          dirtyWrites.value = dirtyWrites.value.filter(w => 
            !(w.recordId === conflict.recordId && String(w.fieldId) === String(conflict.fieldId))
          )
        } else if (selectedRadio?.value === 'attempted') {
          // 保留本地修改：确保 dirtyWrites 中有对应条目
          const existingWrite = dirtyWrites.value.find(w => 
            w.recordId === conflict.recordId && String(w.fieldId) === String(conflict.fieldId)
          )
          if (!existingWrite) {
            const recordIndex = records.value.findIndex(r => r.id === conflict.recordId)
            const fieldIndex = columnIds.value.findIndex(fid => String(fid) === String(conflict.fieldId))
            if (recordIndex >= 0 && fieldIndex >= 0) {
              dirtyWrites.value.push({
                recordId: conflict.recordId,
                fieldId: String(conflict.fieldId),
                value: conflict.attemptedValue,
                row: recordIndex + 1,
                column: fieldIndex + 1
              })
            }
          }
        }
      }
      conflicts.value = []
      await renderLuckysheet()
      alert('冲突已按您的选择解决。')
    }
  } catch (e: any) {
    alert(e?.message || '解决冲突时发生错误')
  }
}

watch(columnIds, async () => {
  await renderLuckysheet()
})

onMounted(load)
</script>

<template>
  <div class="grid-view">
    <header class="toolbar">
      <div class="title">
        <strong>视图</strong>
        <span v-if="view">#{{ view.id }} {{ view.name }} (rev {{ view.revision }})</span>
      </div>
      <div class="actions">
        <label>
          每页：
          <select v-model.number="size" @change="goto(1)">
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="50">50</option>
          </select>
        </label>
        <button @click="goto(page - 1)">上一页</button>
        <span>第 {{ page }} 页 / 共 {{ Math.max(1, Math.ceil(total / size)) }} 页</span>
        <button @click="goto(page + 1)">下一页</button>
        <!-- M2-04：编辑缓冲状态显示与操作入口（保存留到 M2-05） -->
        <span v-if="dirtyWrites.length > 0" class="dirty-indicator">未保存变更 {{ dirtyWrites.length }} 项</span>
        <button :disabled="dirtyWrites.length === 0 || saving" @click="clearDirtyWrites">撤销全部</button>
        <button :disabled="dirtyWrites.length === 0 || saving" @click="saveDirty">{{ saving ? '保存中…' : '保存变更' }}</button>
        <!-- M2-06：筛选与排序入口 -->
        <button class="btn-secondary" @click="toggleFilterPanel">{{ showFilterPanel ? '隐藏条件' : '筛选/排序' }}</button>
        <button class="btn-primary" @click="applyFilterSort">应用条件</button>
      </div>
    </header>

    <!-- M2-06：筛选/排序面板 -->
    <section v-if="showFilterPanel" class="filter-panel">
      <div class="filters">
        <h4>筛选条件</h4>
        <div v-for="(it, idx) in filterItems" :key="idx" class="filter-row">
          <select v-model="it.fid">
            <option v-for="fid in columnIds" :key="fid" :value="String(fid)">{{ fieldName(fid) }}</option>
          </select>
          <select v-model="it.op">
            <option v-for="op in opsForField(it.fid)" :key="op.value" :value="op.value">{{ op.label }}</option>
          </select>
          <template v-if="it.op === 'between'">
            <input :type="inputTypeForField(it.fid)" v-model="it.val" placeholder="最小值/开始日期" />
            <input :type="inputTypeForField(it.fid)" v-model="it.val2" placeholder="最大值/结束日期" />
          </template>
          <template v-else-if="fieldType(it.fid) === 'boolean'">
            <select v-model="it.val">
              <option :value="true">真</option>
              <option :value="false">假</option>
            </select>
          </template>
          <template v-else>
            <input :type="inputTypeForField(it.fid)" v-model="it.val" placeholder="值（多个值用逗号分隔用于 in）" />
          </template>
          <button class="btn-secondary" @click="removeFilter(idx)">删除</button>
        </div>
        <button class="btn-secondary" @click="addFilter">新增条件</button>
      </div>
      <div class="sort">
        <h4>排序</h4>
        <div class="sort-row">
          <select v-model="(sortItem || (sortItem = { fid: String(columnIds[0] || ''), dir: 'asc' })).fid">
            <option v-for="fid in columnIds" :key="fid" :value="String(fid)">{{ fieldName(fid) }}</option>
          </select>
          <select v-model="(sortItem || (sortItem = { fid: String(columnIds[0] || ''), dir: 'asc' })).dir">
            <option value="asc">升序</option>
            <option value="desc">降序</option>
          </select>
        </div>
      </div>
    </section>

    <div class="filter-actions" v-if="showFilterPanel">
      <button class="btn-primary" @click="saveViewConfig">保存到视图配置</button>
    </div>
    <div v-if="loading" class="state">加载中…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>

    <!-- M2-05b：冲突解决面板 -->
    <div v-else-if="conflicts.length > 0" class="conflict-panel">
      <div class="conflict-header">
        <h3>🔥 检测到 {{ conflicts.length }} 个数据冲突</h3>
        <p>以下单元格在您编辑期间被其他用户修改，请选择保留哪个版本：</p>
      </div>
      <div class="conflict-list">
        <div v-for="(conflict, index) in conflicts" :key="`${conflict.recordId}-${conflict.fieldId}`" class="conflict-item">
          <div class="conflict-info">
            <strong>记录 #{{ conflict.recordId }} - {{ fieldName(String(conflict.fieldId)) }}</strong>
          </div>
          <div class="conflict-values">
             <div class="value-option current">
               <label>
                 <input type="radio" :name="`conflict-${index}`" value="current" checked>
                 <span class="label">服务器最新值：</span>
                 <div class="value-details">
                   <code class="value-code">{{ formatConflictValue(conflict.currentValue) }}</code>
                   <span v-if="conflict.currentFormulaExpr" class="formula-expr">
                     公式: <code>{{ conflict.currentFormulaExpr }}</code>
                   </span>
                 </div>
               </label>
             </div>
             <div class="value-option attempted">
               <label>
                 <input type="radio" :name="`conflict-${index}`" value="attempted">
                 <span class="label">您的修改值：</span>
                 <div class="value-details">
                   <code class="value-code">{{ formatConflictValue(conflict.attemptedValue) }}</code>
                   <span v-if="conflict.attemptedFormulaExpr" class="formula-expr">
                     公式: <code>{{ conflict.attemptedFormulaExpr }}</code>
                   </span>
                 </div>
               </label>
             </div>
             <!-- 差异对比 -->
             <div class="diff-summary">
               <strong>差异：</strong>
               <span v-if="conflict.currentValue === conflict.attemptedValue" class="diff-none">
                 值相同，但可能存在公式差异
               </span>
               <span v-else class="diff-exists">
                 {{ formatValueDiff(conflict.currentValue, conflict.attemptedValue) }}
               </span>
             </div>
           </div>
        </div>
      </div>
      <div class="conflict-actions">
        <button @click="resolveConflicts('accept-all-current')" class="btn-secondary">全部保留服务器版本</button>
        <button @click="resolveConflicts('accept-all-attempted')" class="btn-primary">全部保留我的修改</button>
        <button @click="resolveConflicts('accept-selected')" class="btn-primary">按选择解决冲突</button>
        <button @click="conflicts = []" class="btn-secondary">取消（清除冲突标记）</button>
      </div>
    </div>

    <div v-else id="luckysheet" style="height: calc(100vh - 140px);"></div>
  </div>
</template>

<style scoped>
.grid-view { padding: 16px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.title { font-size: 14px; }
.actions { display: flex; gap: 8px; align-items: center; }
.state { padding: 12px; color: #666; }
.error { color: #c00; }
.dirty-indicator { color: #b36b00; font-weight: 600; }

/* M2-05b：冲突面板样式 */
.conflict-panel {
  background: #fff3cd;
  border: 1px solid #ffeaa7;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.conflict-header h3 {
  margin: 0 0 8px 0;
  color: #856404;
  font-size: 18px;
}

.conflict-header p {
  margin: 0 0 16px 0;
  color: #856404;
  font-size: 14px;
}

.conflict-list {
  margin-bottom: 20px;
}

.conflict-item {
  background: white;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 12px;
}

.conflict-info {
  margin-bottom: 12px;
  color: #495057;
  font-size: 14px;
}

.conflict-values {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.value-option {
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid #dee2e6;
}

.value-option.current {
  background: #e8f5e8;
  border-color: #28a745;
}

.value-option.attempted {
  background: #fff3cd;
  border-color: #ffc107;
}

.value-option label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
}

.value-option .label {
  font-weight: 500;
  min-width: 100px;
}

.value-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.value-code {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
}

.formula-expr {
  font-size: 12px;
  color: #6c757d;
  font-style: italic;
}

.formula-expr code {
  background: rgba(0, 0, 0, 0.03);
  padding: 1px 4px;
  border-radius: 2px;
  font-family: 'Courier New', monospace;
  font-size: 11px;
}

.diff-summary {
  margin-top: 12px;
  padding: 8px 12px;
  background: #f8f9fa;
  border-radius: 4px;
  border-left: 3px solid #6c757d;
  font-size: 13px;
}

.diff-none {
  color: #28a745;
  font-style: italic;
}

.diff-exists {
  color: #dc3545;
  font-weight: 500;
}

.conflict-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.btn-primary {
  background: #007bff;
  color: white;
  border: 1px solid #007bff;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary:hover {
  background: #0056b3;
  border-color: #0056b3;
}

.btn-secondary {
  background: #6c757d;
  color: white;
  border: 1px solid #6c757d;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-secondary:hover {
  background: #545b62;
  border-color: #545b62;
}
</style>