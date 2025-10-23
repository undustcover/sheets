<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick } from 'vue'
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

// M2-09：滚动懒加载与基础虚拟化状态
const combinedRecords = ref<Array<{ id: number; values: Record<string, any> }>>([])
const nextPageToLoad = ref(2)
const isLoadingMore = ref(false)
const autoLoadMore = ref(true)
const hasMore = computed(() => combinedRecords.value.length < total.value)
let scrollEl: HTMLElement | null = null

// 冲突状态：记录发生冲突的单元格信息（M2-05b）
const conflicts = ref<Array<{
  recordId: number;
  fieldId: number;
  currentValue: any;
  attemptedValue: any;
  currentFormulaExpr?: string;
  attemptedFormulaExpr?: string;
}>>([])

// 变更缓冲：记录用户在 Luckysheet 中的编辑（M2-04）
const dirtyWrites = ref<Array<{ recordId: number; fieldId: string; value: any; row: number; column: number }>>([])

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
  for (const r of (combinedRecords.value.length ? combinedRecords.value : records.value)) {
    for (const k of Object.keys(r.values || {})) set.add(k)
  }
  return Array.from(set).sort((a, b) => {
    const na = Number(a), nb = Number(b)
    const aIsNum = !isNaN(na), bIsNum = !isNaN(nb)
    if (aIsNum && bIsNum) return na - nb
    if (aIsNum) return -1
    if (bIsNum) return 1
    return String(a).localeCompare(String(b))
  })
})

const columnIds = computed(() => columnIdsFromRecords.value)

// 筛选/排序面板状态（M2-06）
const showFilterPanel = ref(false)
const filterItems = ref<Array<{ fid: string; op: string; val?: any; val2?: any }>>([])
let sortItem: { fid: string; dir: 'asc' | 'desc' } | null = null
let didInitFromConfig = false
let didInitQueryFromConfig = false

// 新增：冻结与列宽缓存（M2-10）
const freezeFirstRow = ref(true)
const freezeFirstColumn = ref(true)
const rememberColumnWidth = ref(true)
let saveColWidthTimer: any = null

function columnWidthCacheKey() {
  try { return `sheets:colwidth:${String(viewId.value || '')}` } catch { return 'sheets:colwidth:default' }
}
function loadCachedColumnWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(columnWidthCacheKey())
    if (!raw) return {}
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object') return obj
  } catch {}
  return {}
}
function saveCachedColumnWidths(widths: Record<string, number>) {
  try { localStorage.setItem(columnWidthCacheKey(), JSON.stringify(widths || {})) } catch {}
}
function readCurrentColumnWidths(): Record<string, number> {
  try {
    const sheets = (window as any).luckysheet?.getAllSheets?.()
    const conf = sheets?.[0]?.config
    const cl = conf?.columnlen || {}
    return cl
  } catch { return {} }
}
function scheduleSaveColumnWidths() {
  if (!rememberColumnWidth.value) return
  if (saveColWidthTimer) clearTimeout(saveColWidthTimer)
  saveColWidthTimer = setTimeout(() => {
    // 仍然保留本地缓存作为回退
    const curRaw = readCurrentColumnWidths()
    saveCachedColumnWidths(curRaw)
    // 同步保存到后端（按字段 ID）
    saveViewUIConfigDebounced()
  }, 300)
}
function applyFreeze() {
  try {
    const api = (window as any).luckysheet
    if (!api) return
    api.cancelFrozen?.()
    if (freezeFirstRow.value && freezeFirstColumn.value) {
      api.setBothFrozen?.(false)
    } else if (freezeFirstRow.value) {
      api.setHorizontalFrozen?.(false)
    } else if (freezeFirstColumn.value) {
      api.setVerticalFrozen?.(false)
    }
  } catch {}
}

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
  return raw
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

// 修正：坐标映射与原始值读取以合并数据为准（M2-09）
function dataSourceForRender() {
  return combinedRecords.value.length ? combinedRecords.value : records.value
}

function coordToKeyFixed(row: number, column: number): { recordId: number; fieldId: string } | null {
  if (row <= 0 || column <= 0) return null
  const src = dataSourceForRender()
  const rec = src[row - 1]
  const fid = columnIds.value[column - 1]
  if (!rec || !fid) return null
  return { recordId: rec.id, fieldId: fid }
}

function originalValueFixed(row: number, column: number): any {
  if (row === 0 && column === 0) return 'ID'
  if (row === 0 && column > 0) {
    const name = fieldName(columnIds.value[column - 1])
    return name
  }
  const src = dataSourceForRender()
  if (row > 0 && column === 0) {
    const rec = src[row - 1]
    return rec?.id ?? ''
  }
  const rec = src[row - 1]
  const fid = columnIds.value[column - 1]
  return getCellValue(rec, fid)
}

// Remove duplicate definitions to avoid redeclaration errors
// (kept earlier single-line aliases)
function coordToKey(row: number, column: number) { return coordToKeyFixed(row, column) }
function originalValue(row: number, column: number) { return originalValueFixed(row, column) }

// 批量保存（M2-05）：发送变更缓冲到后端，处理并发冲突
async function saveDirty() {
  if (!view.value || dirtyWrites.value.length === 0) return
  const tableId = view.value.tableId
  const revision = view.value.revision
  const writes = dirtyWrites.value.map(w => ({ recordId: w.recordId, fieldId: Number(w.fieldId), value: w.value }))
  try {
    saving.value = true
    const resp = await api.batchCellsWrite(tableId, { revision, writes })
    view.value.revision = resp.revision
    clearDirtyWrites()
    // 优化流畅度：不再强制全量 reload；保持当前网格内容，减少抖动
    // 如需从服务端回填格式化值，后续可做增量刷新
    console.info('保存成功，revision 更新为', resp.revision)
  } catch (e: any) {
    if (e?.status === 409) {
      const latest = e?.details?.latestRevision
      if (typeof latest === 'number') {
        view.value.revision = latest
      }
      if (e?.details?.conflicts && Array.isArray(e.details.conflicts)) {
        conflicts.value = e.details.conflicts
      } else {
        conflicts.value = []
      }
      await load()
      await renderLuckysheet()
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

function formatConflictValue(value: any): string {
  if (value === null || value === undefined) return '(空值)'
  if (typeof value === 'string' && value === '') return '(空字符串)'
  if (typeof value === 'object') return JSON.stringify(value)
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

async function resolveConflicts(strategy: 'accept-all-current' | 'accept-all-attempted' | 'accept-selected') {
  if (conflicts.value.length === 0) return
  try {
    if (strategy === 'accept-all-current') {
      for (const conflict of conflicts.value) {
        dirtyWrites.value = dirtyWrites.value.filter(w => 
          !(w.recordId === conflict.recordId && String(w.fieldId) === String(conflict.fieldId))
        )
      }
      conflicts.value = []
      await renderLuckysheet()
      alert('已保留服务器版本，冲突已解决。')
    } else if (strategy === 'accept-all-attempted') {
      for (const conflict of conflicts.value) {
        const existingWrite = dirtyWrites.value.find(w => 
          w.recordId === conflict.recordId && String(w.fieldId) === String(conflict.fieldId)
        )
        if (existingWrite) {
          existingWrite.value = conflict.attemptedValue
        } else {
          const src = dataSourceForRender()
          const recordIndex = src.findIndex(r => r.id === conflict.recordId)
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
      for (let i = 0; i < conflicts.value.length; i++) {
        const conflict = conflicts.value[i]
        const radioName = `conflict-${i}`
        const selectedRadio = document.querySelector(`input[name="${radioName}"]:checked`) as HTMLInputElement
        if (selectedRadio?.value === 'current') {
          dirtyWrites.value = dirtyWrites.value.filter(w => 
            !(w.recordId === conflict.recordId && String(w.fieldId) === String(conflict.fieldId))
          )
        } else if (selectedRadio?.value === 'attempted') {
          const existingWrite = dirtyWrites.value.find(w => 
            w.recordId === conflict.recordId && String(w.fieldId) === String(conflict.fieldId)
          )
          if (!existingWrite) {
            const src = dataSourceForRender()
            const recordIndex = src.findIndex(r => r.id === conflict.recordId)
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

// --- 新增：单击即编辑（mouseup 判定 + 阈值 + 修饰键跳过） ---
let lastMouseDownPos: { x: number; y: number } | null = null
let mouseDownTime = 0
let boundHandlers: { mousedown?: any; mousemove?: any; mouseup?: any } | null = null

function getActiveRange(): { r0: number; c0: number } | null {
  try {
    const api = (window as any).luckysheet
    const rng: any = api?.getRange?.()
    if (!rng) return null
    let first: any = rng
    if (Array.isArray(rng) && rng.length) first = rng[0]
    const r0 = (typeof first?.row_focus === 'number') ? first.row_focus : (Array.isArray(first?.row) ? first.row[0] : undefined)
    const c0 = (typeof first?.column_focus === 'number') ? first.column_focus : (Array.isArray(first?.column) ? first.column[0] : undefined)
    if (typeof r0 === 'number' && typeof c0 === 'number') return { r0, c0 }
  } catch {}
  return null
}

async function waitForEditorBox(timeout = 200): Promise<HTMLElement | null> {
  const rootSel = '#luckysheet .luckysheet-input-box, .luckysheet-input-box'
  const start = Date.now()
  return new Promise((resolve) => {
    const tick = () => {
      const root = document.querySelector(rootSel) as HTMLElement | null
      if (root) {
        const style = window.getComputedStyle(root)
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && root.offsetWidth > 0 && root.offsetHeight > 0
        if (visible) return resolve(root)
      }
      if (Date.now() - start >= timeout) return resolve(null)
      requestAnimationFrame(tick)
    }
    tick()
  })
}

function placeCaretToEnd() {
  const root = (document.querySelector('#luckysheet .luckysheet-input-box') as HTMLElement | null) ||
               (document.querySelector('.luckysheet-input-box') as HTMLElement | null)
  if (!root) return
  const ce = root.querySelector('[contenteditable="true"], .luckysheet-input-box-text') as HTMLElement | null
  const ta = root.querySelector('textarea, input') as HTMLTextAreaElement | HTMLInputElement | null
  if (ta) {
    const len = ta.value?.length ?? 0
    try { ta.setSelectionRange(len, len) } catch {}
    ta.focus()
    return
  }
  if (ce) {
    const range = document.createRange()
    range.selectNodeContents(ce)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    ;(ce as HTMLElement).focus()
  }
}

function isEditorVisible(): boolean {
  const el = (document.querySelector('#luckysheet .luckysheet-input-box') as HTMLElement | null) ||
             (document.querySelector('.luckysheet-input-box') as HTMLElement | null)
  if (!el) return false
  const style = window.getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0
}

function dispatchDblClickAtPoint(x: number, y: number) {
  const target = document.elementFromPoint(x, y) as HTMLElement | null
  if (!target) return
  const ev = new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y })
  target.dispatchEvent(ev)
}

async function triggerEnterEditWithFocus() {
  const api = (window as any).luckysheet
  if (!api) return
  if (isEditorVisible()) { requestAnimationFrame(() => setTimeout(placeCaretToEnd, 0)); return }
  let triggered = false
  if (typeof api.enterEdit === 'function') {
    try { api.enterEdit(); triggered = true } catch {}
  }
  if (!triggered) {
    try {
      const evt = new KeyboardEvent('keydown', { key: 'F2', code: 'F2', keyCode: 113, which: 113, bubbles: true }) as any
      document.dispatchEvent(evt)
      const grid = document.querySelector('#luckysheet .luckysheet-grid-window')
      if (grid) (grid as HTMLElement).dispatchEvent(evt)
      triggered = true
    } catch {}
  }
  let box = await waitForEditorBox(400)
  if (!box && lastMouseDownPos) {
    try { dispatchDblClickAtPoint(lastMouseDownPos.x, lastMouseDownPos.y) } catch {}
    box = await waitForEditorBox(350)
  }
  requestAnimationFrame(() => setTimeout(placeCaretToEnd, 0))
}

function attachSingleClickEdit() {
  const container = document.getElementById('luckysheet')
  if (!container) return
  if (boundHandlers) {
    container.removeEventListener('mousedown', boundHandlers.mousedown)
    container.removeEventListener('mousemove', boundHandlers.mousemove)
    container.removeEventListener('mouseup', boundHandlers.mouseup)
  }
  const threshold = 7
  const onMousedown = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if ((target.closest && target.closest('.luckysheet-input-box')) || (target as any).isContentEditable) return
    lastMouseDownPos = { x: e.clientX, y: e.clientY }
    mouseDownTime = Date.now()
  }
  const onMousemove = (_e: MouseEvent) => {}
  const onMouseup = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!lastMouseDownPos) return
    const dx = e.clientX - lastMouseDownPos.x
    const dy = e.clientY - lastMouseDownPos.y
    const dist = Math.hypot(dx, dy)
    if (e.shiftKey || e.ctrlKey || e.metaKey) { lastMouseDownPos = null; return }
    if (dist > threshold) { lastMouseDownPos = null; return }
    if ((target.closest && target.closest('.luckysheet-input-box')) || (target as any).isContentEditable) { lastMouseDownPos = null; return }
    // 让出一帧时间给 Luckysheet 自己处理选择与滚动
    requestAnimationFrame(() => setTimeout(() => {
      const active = getActiveRange()
      if (!active) { lastMouseDownPos = null; return }
      const { r0, c0 } = active
      if (r0 === 0 || c0 === 0) { lastMouseDownPos = null; return }
      triggerEnterEditWithFocus()
      lastMouseDownPos = null
    }, 60))
  }
  boundHandlers = { mousedown: onMousedown, mousemove: onMousemove, mouseup: onMouseup }
  container.addEventListener('mousedown', onMousedown)
  container.addEventListener('mousemove', onMousemove)
  container.addEventListener('mouseup', onMouseup)
}

async function renderLuckysheet() {
  const cols = columnIds.value
  const dataRows = combinedRecords.value.length ? combinedRecords.value : records.value

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
      const isConflict = conflicts.value.some(conflict => 
        conflict.recordId === r.id && String(conflict.fieldId) === fid
      )
      const cellValue: any = { v, m: String(v) }
      if (isConflict) {
        cellValue.bg = '#ffebee'
        cellValue.fc = '#c62828'
        cellValue.bl = 1
      }
      celldata.push({ r: i + 1, c: j + 1, v: cellValue })
    }
  }

  const container = document.getElementById('luckysheet')
  if (!container) return
  try { (window as any).luckysheet?.destroy?.() } catch {}

  const luckysheet = await ensureLuckysheet()
  // 使用后端配置（按字段 ID）还原列宽；若没有则回退本地缓存
  initUiFromConfigOnce()
  const fromConfig = buildColumnlenFromConfig()
  const cachedColumnlen = Object.keys(fromConfig).length ? fromConfig : loadCachedColumnWidths()

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
        config: { columnlen: cachedColumnlen },
      },
    ],
    hook: {
      workbookCreateAfter: () => {
        applyFreeze()
        // 首次渲染后保存一次列宽（如果有缓存则已加载）
        scheduleSaveColumnWidths()
      },
      updated: (_operate: any) => {
        try {
          // 列宽保存节流：避免在非调整列宽的操作里频繁触发
          scheduleSaveColumnWidths()
          const range = _operate?.range?.[0]
          const r = range?.row?.[0]
          const c = range?.column?.[0]
          if (typeof r !== 'number' || typeof c !== 'number') return
          // 仅当确实有值更新时再处理（避免选区移动等触发）
          const hasValue = (typeof _operate?.value !== 'undefined') || (typeof _operate?.v !== 'undefined') || (_operate?.op === 'updateCell') || (_operate?.type === 'v') || (_operate?.t === 'v')
          if (!hasValue) return
          if (r === 0 || c === 0) {
            const ov = originalValue(r, c)
            ;(window as any).luckysheet?.setCellValue?.(r, c, ov)
            // 不再 alert，避免阻塞交互
            return
          }
          const key = coordToKey(r, c)
          if (!key) return
          const cur = (window as any).luckysheet?.getCellValue?.(r, c, { type: 'm' })
          const ov = originalValue(r, c)
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

  await nextTick()
  attachScrollListener()
  if (singleClickEdit.value) attachSingleClickEdit()
}

// 同步冻结设置到后端
watch([freezeFirstRow, freezeFirstColumn], () => {
  applyFreeze()
  saveViewUIConfigDebounced()
})

function attachScrollListener() {
  try {
    const container = document.getElementById('luckysheet')
    if (!container) return
    // Luckysheet 内部滚动容器尝试选择
    const candidate = container.querySelector('.luckysheet-grid-window') as HTMLElement | null
    scrollEl = candidate || container
    // 先移除旧监听
    scrollEl.removeEventListener('scroll', onScrollCheck)
    scrollEl.addEventListener('scroll', onScrollCheck)
  } catch {}
}

function nearBottom(el: HTMLElement, threshold = 200) {
  const st = el.scrollTop
  const h = el.clientHeight
  const sh = el.scrollHeight
  return st + h >= sh - threshold
}

async function onScrollCheck() {
  if (!autoLoadMore.value || !scrollEl) return
  if (!hasMore.value || isLoadingMore.value) return
  if (nearBottom(scrollEl)) {
    await loadMore()
  }
}

async function loadMore() {
  if (!hasMore.value) return
  try {
    isLoadingMore.value = true
    const filters = serializeFiltersForQuery()
    const sort = serializeSortForQuery()
    const resp = await api.getViewData(viewId.value, { page: nextPageToLoad.value, size: size.value, filters, sort })
    const newRows = resp.data || []
    total.value = resp.total
    const startIdx = combinedRecords.value.length
    combinedRecords.value = combinedRecords.value.concat(newRows)
    // 追加渲染到 Luckysheet
    const cols = columnIds.value
    for (let i = 0; i < newRows.length; i++) {
      const r = newRows[i]
      const rowIndex = startIdx + i + 1 // +1 因为第一行是表头
      ;(window as any).luckysheet?.setCellValue?.(rowIndex, 0, { v: r.id, m: String(r.id) })
      for (let j = 0; j < cols.length; j++) {
        const fid = cols[j]
        const v = getCellValue(r, fid)
        ;(window as any).luckysheet?.setCellValue?.(rowIndex, j + 1, { v, m: String(v) })
      }
    }
    nextPageToLoad.value += 1
  } catch (e: any) {
    console.warn('加载更多失败', e)
  } finally {
    isLoadingMore.value = false
  }
}

function fieldName(fid: string) {
  const f = fields.value.find(x => String(x.id) === fid || x.name === fid)
  return f?.name ?? fid
}

function getCellValue(r: { values?: Record<string, any> }, fid: string) {
  const byId = r.values?.[fid]
  if (byId !== undefined && byId !== null) return byId
  const name = fieldName(fid)
  const byName = r.values?.[name]
  return byName === undefined || byName === null ? '' : byName
}

// 记忆列宽开关变化时也同步保存
watch(rememberColumnWidth, () => {
  saveViewUIConfigDebounced()
})

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
            <option :value="100">100</option>
            <option :value="200">200</option>
          </select>
        </label>
        <button @click="goto(page - 1)">上一页</button>
        <span>第 {{ page }} 页 / 共 {{ Math.max(1, Math.ceil(total / size)) }} 页</span>
        <button @click="goto(page + 1)">下一页</button>
        <span v-if="hasMore" style="margin-left:8px;color:#666;">已加载 {{ combinedRecords.length }}/{{ total }}</span>
        <label style="display:flex;align-items:center;gap:6px;margin-left:8px;">
          <input type="checkbox" v-model="autoLoadMore" /> 自动加载更多
        </label>
        <button @click="loadMore" :disabled="!hasMore || isLoadingMore">{{ isLoadingMore ? '加载中…' : '加载更多' }}</button>

        <label style="display:flex;align-items:center;gap:6px;margin-left:8px;">
          <input type="checkbox" v-model="freezeFirstRow" /> 冻结首行
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin-left:8px;">
          <input type="checkbox" v-model="freezeFirstColumn" /> 冻结首列
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin-left:8px;">
          <input type="checkbox" v-model="rememberColumnWidth" /> 列宽记忆
        </label>

        <span v-if="dirtyWrites.length" class="dirty-indicator">未保存：{{ dirtyWrites.length }} 处</span>
        <button @click="saveDirty" :disabled="saving || !dirtyWrites.length">{{ saving ? '保存中…' : '保存' }}</button>
        <button @click="clearDirtyWrites" :disabled="!dirtyWrites.length">清空未保存编辑</button>
        <button @click="toggleFilterPanel">筛选/排序</button>
        <button @click="applyFilterSort">应用筛选与排序</button>
        <button @click="saveViewConfig">保存视图配置</button>
      </div>
    </header>

    <section v-if="showFilterPanel" class="panel">
      <div class="panel-header">筛选条件</div>
      <div class="panel-body">
        <div v-for="(it, idx) in filterItems" :key="idx" class="filter-row">
          <select v-model="it.fid">
            <option v-for="fid in columnIds" :key="fid" :value="fid">{{ fieldName(fid) }}</option>
          </select>
          <select v-model="it.op">
            <option v-for="op in opsForField(it.fid)" :key="op.value" :value="op.value">{{ op.label }}</option>
          </select>
          <template v-if="it.op === 'between'">
            <input :type="inputTypeForField(it.fid)" v-model="it.val" placeholder="最小值" />
            <input :type="inputTypeForField(it.fid)" v-model="it.val2" placeholder="最大值" />
          </template>
          <template v-else-if="it.op === 'in'">
            <input type="text" v-model="it.val" placeholder="用逗号分隔的集合值" />
          </template>
          <template v-else-if="it.op !== 'is_null' && it.op !== 'is_not_null'">
            <input :type="inputTypeForField(it.fid)" v-model="it.val" placeholder="值" />
          </template>
          <button @click="removeFilter(idx)">移除</button>
        </div>
        <div><button @click="addFilter">新增筛选</button></div>
      </div>
      <div class="panel-header" style="margin-top:8px;">排序</div>
      <div class="panel-body">
        <div class="sort-row">
          <select v-model="(sortItem ||= { fid: String(columnIds[0] || ''), dir: 'asc' }).fid">
            <option v-for="fid in columnIds" :key="fid" :value="String(fid)">{{ fieldName(fid) }}</option>
          </select>
          <select v-model="(sortItem ||= { fid: String(columnIds[0] || ''), dir: 'asc' }).dir">
            <option value="asc">升序</option>
            <option value="desc">降序</option>
          </select>
        </div>
      </div>
    </section>

    <section v-if="conflicts.length" class="conflict-panel">
      <div class="panel-header">检测到 {{ conflicts.length }} 个冲突</div>
      <div class="panel-body">
        <div v-for="(c, i) in conflicts" :key="i" class="conflict-row">
          <div class="conflict-meta">记录 #{{ c.recordId }} / 字段 {{ c.fieldId }}</div>
          <div class="conflict-values">
            <label>
              <input type="radio" :name="`conflict-${i}`" value="current" checked />
              服务器值：{{ formatConflictValue(c.currentValue) }}
            </label>
            <label>
              <input type="radio" :name="`conflict-${i}`" value="attempted" />
              我的修改：{{ formatConflictValue(c.attemptedValue) }}
            </label>
          </div>
          <div class="conflict-diff">{{ formatValueDiff(c.currentValue, c.attemptedValue) }}</div>
        </div>
      </div>
      <div class="panel-footer">
        <button @click="resolveConflicts('accept-all-current')">全部保留服务器值</button>
        <button @click="resolveConflicts('accept-all-attempted')">全部保留我的修改</button>
        <button @click="resolveConflicts('accept-selected')">按上面选择处理</button>
      </div>
    </section>

    <div v-if="loading" class="state">加载中...</div>
    <div v-else-if="error" class="state error">{{ error }}</div>

    <div v-else id="luckysheet" style="height: calc(100vh - 260px);"></div>
  </div>
</template>

<style scoped>
.grid-view { padding: 16px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.title { font-size: 14px; }
.actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.state { padding: 12px; color: #666; }
.error { color: #c00; }
.dirty-indicator { color: #b36b00; font-weight: 600; }

.panel { border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 12px; }
.panel-header { background: #f9fafb; padding: 8px 10px; font-weight: 600; }
.panel-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.filter-row, .sort-row { display: flex; gap: 8px; align-items: center; }
.conflict-panel { border-color: #f2d7d9; }
.conflict-row { border-bottom: 1px dashed #eee; padding: 8px 0; display:flex; flex-direction: column; gap:6px; }
.conflict-meta { color:#555; }
.conflict-values { display:flex; gap:16px; align-items:center; }
.conflict-diff { color:#666; font-size:12px; }
.panel-footer { padding: 8px 10px; display: flex; gap: 8px; }

/* 内联视觉：让编辑框看起来在单元格内 */
:deep(#luckysheet .luckysheet-input-box) {
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
}
:deep(#luckysheet .luckysheet-input-box textarea),
:deep(#luckysheet .luckysheet-input-box input),
:deep(#luckysheet .luckysheet-input-box [contenteditable="true"]) {
  background: transparent !important;
  border: none !important;
  outline: none !important;
  padding: 0 2px !important;
  box-shadow: none !important;
}
</style>

<style>
/* Global overrides for inline editor; and soften selection visuals in editing mode */
.luckysheet-input-box,
.luckysheet-input-box .luckysheet-input-box-text,
.luckysheet-input-box .luckysheet-input-box-text,
.luckysheet-input-box .luckysheet-input-text,
.luckysheet-input-box .luckysheet-input-box-inner {
  background: transparent !important;
  border: 0 !important;
  outline: none !important;
  box-shadow: none !important;
  border-radius: 0 !important;
}
.luckysheet-input-box textarea,
.luckysheet-input-box input,
.luckysheet-input-box [contenteditable="true"] {
  background: transparent !important;
  border: 0 !important;
  outline: none !important;
  padding: 0 2px !important;
  box-shadow: none !important;
}
/* 降低编辑态下选中框的视觉存在感（可按需调整或移除）*/
body.ls-editing .luckysheet-selection, body.ls-editing .luckysheet-selection-copy {
  opacity: 0.2 !important;
}
</style>

<script setup lang="ts">
// 在编辑框显示/隐藏时给 body 加类名，便于样式控制
import { onMounted as _onMounted2, onBeforeUnmount } from 'vue'
let mo: MutationObserver | null = null
_onMounted2(() => {
  const el = document.body
  mo = new MutationObserver(() => {
    const vis = isEditorVisible()
    if (vis) document.body.classList.add('ls-editing')
    else document.body.classList.remove('ls-editing')
  })
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
})
onBeforeUnmount(() => { try { mo?.disconnect() } catch {} })
</script>