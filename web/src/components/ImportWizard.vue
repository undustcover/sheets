<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { api } from '../services/api'

const props = defineProps<{
  open: boolean
  tableId: number
  fields: Array<{ id: number; name: string }>
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'success', payload: any): void
}>()

const step = ref<1 | 2 | 3>(1)
const busy = ref(false)
const error = ref<string | null>(null)

// file & parse options
const file = ref<File | null>(null)
const encoding = ref<'utf-8'>('utf-8') // 简化：仅 utf-8
const delimiter = ref<'auto' | ',' | ';' | '\t'>('auto')
const hasHeader = ref(true)
const ignoreUnknownColumns = ref(true)

// preview
const previewRows = ref<string[][]>([])
const columns = computed(() => {
  const row0 = previewRows.value[0] || []
  return row0.map((_, i) => i)
})

// mapping: csv column index -> field id or null (skip)
const mapping = ref<Record<number, number | null>>({})

// validation & progress
const validation = ref<null | { dryRun: boolean; totalRows: number; valid: number; invalid: number; errors: Array<{ rowIndex: number; issues: Array<{ columnIndex: number; fieldId?: number; message: string }> }> }>(null)
const importSummary = ref<any | null>(null)
const progress = ref(0)
let progressTimer: any = null
let pollTimer: any = null

// 失败问题类型统计（基于 message 文本的启发式分类）
const errorTypeStats = computed(() => {
  const stats: Record<string, number> = {}
  const inc = (k: string) => { stats[k] = (stats[k] || 0) + 1 }
  const labelMap: Record<string, string> = {
    required: '必填缺失',
    type: '类型不匹配/格式错误',
    unknown: '未知列/未映射',
    formula: '公式字段不可编辑',
    attachment: '附件字段不支持导入',
    other: '其他',
  }
  if (!validation.value || !validation.value.errors) return [] as Array<{ key: string; label: string; count: number }>
  for (const row of validation.value.errors) {
    for (const iss of row.issues) {
      const m = (iss.message || '').toLowerCase()
      if (/必填|required/.test(m)) inc('required')
      else if (/未知|unknown|未映射/.test(m)) inc('unknown')
      else if (/公式/.test(m)) inc('formula')
      else if (/附件/.test(m)) inc('attachment')
      else if (/类型|需要|必须是|type|boolean|number|数值|数字|选项无效/.test(m)) inc('type')
      else inc('other')
    }
  }
  return Object.keys(stats).map((k) => ({ key: k, label: labelMap[k] || k, count: stats[k] }))
})

function resetAll() {
  step.value = 1
  busy.value = false
  error.value = null
  file.value = null
  encoding.value = 'utf-8'
  delimiter.value = 'auto'
  hasHeader.value = true
  ignoreUnknownColumns.value = true
  previewRows.value = []
  mapping.value = {}
  validation.value = null
  importSummary.value = null
  progress.value = 0
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

watch(() => props.open, (o) => { if (o) resetAll() })

function autoDetectDelimiter(text: string): ',' | ';' | '\t' {
  const firstLine = text.split(/\r?\n/)[0] || ''
  const candidates: Array<{ d: ',' | ';' | '\t'; count: number }> = [
    { d: ',', count: (firstLine.match(/,/g) || []).length },
    { d: ';', count: (firstLine.match(/;/g) || []).length },
    { d: '\t', count: (firstLine.match(/\t/g) || []).length },
  ]
  candidates.sort((a, b) => b.count - a.count)
  return candidates[0].d
}

function parseCsv(text: string, d: ',' | ';' | '\t', maxLines = 50): string[][] {
  const rows: string[][] = []
  let i = 0
  let field = ''
  let row: string[] = []
  let inQuote = false
  const sep = d === '\t' ? '\t' : d
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { rows.push(row); row = [] }
  for (let idx = 0; idx < text.length; idx++) {
    const ch = text[idx]
    const next = text[idx + 1]
    if (inQuote) {
      if (ch === '"' && next === '"') { field += '"'; idx++; continue }
      if (ch === '"') { inQuote = false; continue }
      field += ch
    } else {
      if (ch === '"') { inQuote = true; continue }
      if (ch === sep) { pushField(); continue }
      if (ch === '\n') {
        pushField(); pushRow(); i++; if (i >= maxLines) break; continue
      }
      if (ch === '\r') { continue }
      field += ch
    }
  }
  if (field.length > 0 || row.length > 0) { pushField(); pushRow() }
  return rows
}

async function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0] || null
  if (!f) return
  file.value = f
  error.value = null
  // 仅读取前 256KB 进行预览
  const blob = f.slice(0, 256 * 1024)
  const text = await blob.text()
  const d = delimiter.value === 'auto' ? autoDetectDelimiter(text) : delimiter.value
  const rows = parseCsv(text, d as any)
  previewRows.value = rows
  // 初始化映射：按表字段顺序猜测
  const header = hasHeader.value && rows.length > 0 ? rows[0] : []
  const fieldNameToId = new Map(props.fields.map(f => [f.name.toLowerCase(), f.id]))
  const map: Record<number, number | null> = {}
  const colCount = (rows[0] || []).length
  for (let i = 0; i < colCount; i++) {
    const name = String(header[i] || '').trim().toLowerCase()
    if (name && fieldNameToId.has(name)) {
      map[i] = fieldNameToId.get(name) || null
    } else {
      map[i] = null
    }
  }
  mapping.value = map
}

function toStep2() {
  if (!file.value) { error.value = '请先选择 CSV 文件'; return }
  if (previewRows.value.length === 0) { error.value = '无法解析文件内容'; return }
  error.value = null
  step.value = 2
}

function toStep3() { validation.value = null; importSummary.value = null; step.value = 3 }

async function submitImport() {
  if (!file.value) { error.value = '缺少文件'; return }
  try {
    busy.value = true
    error.value = null

    // 计算实际分隔符
    let d: ',' | ';' | '\t'
    if (delimiter.value === 'auto') {
      const text = previewRows.value.map(r => r.join(',')).join('\n')
      d = autoDetectDelimiter(text)
    } else {
      d = delimiter.value as any
    }

    // 预校验（dryRun）
    const opts = {
      delimiter: d,
      hasHeader: hasHeader.value,
      ignoreUnknownColumns: ignoreUnknownColumns.value,
      mapping: mapping.value,
      dryRun: true,
      rollbackOnError: true,
    } as any

    validation.value = await api.importCsv(props.tableId, file.value, opts)
    if (validation.value && (validation.value as any).invalid > 0) {
      // 有错误则停留在当前步骤，展示问题
      busy.value = false
      return
    }

    // 真正导入，改为轮询后端进度
    progress.value = 0
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }

    const runOpts = { ...opts, dryRun: false }

    // 启动轮询（每 500ms）
    const startPolling = () => {
      pollTimer = setInterval(async () => {
        try {
          const p = await api.getImportProgress(props.tableId)
          if (typeof p?.percent === 'number') progress.value = Math.max(0, Math.min(100, Math.round(p.percent)))
          if (p?.status === 'done' || p?.status === 'error') {
            clearInterval(pollTimer); pollTimer = null
          }
        } catch {}
      }, 500)
    }

    startPolling()

    // 启动真实导入（不阻塞轮询）
    const runPromise = api.importCsv(props.tableId, file.value, runOpts)

    importSummary.value = await runPromise

    // 结束轮询并补齐进度
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    progress.value = 100

    // 发出成功事件，供外层刷新；不自动关闭，便于查看摘要
    emit('success', importSummary.value)
  } catch (e: any) {
    error.value = e?.message || '导入失败'
  } finally {
    busy.value = false
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  }
}

async function downloadFailures() {
  try {
    const blob = await api.downloadImportFailuresCsv(props.tableId)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const ts = new Date()
    const name = `import_failures_${props.tableId}_${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}-${String(ts.getDate()).padStart(2,'0')}_${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}${String(ts.getSeconds()).padStart(2,'0')}.csv`
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    alert(e?.message || '下载失败清单失败')
  }
}

function close() { if (!busy.value) emit('close') }
</script>

<template>
  <div v-if="open" class="iwz-mask">
    <div class="iwz-panel">
      <header class="iwz-header">
        <h3>导入 CSV</h3>
        <button class="close" @click="close">×</button>
      </header>
      <section class="iwz-body">
        <p v-if="error" class="err">
          {{ error }}
          <button class="link" @click="downloadFailures" style="margin-left:8px;" title="如果有失败清单，可点击下载">下载失败清单（CSV）</button>
        </p>
        <div v-if="step === 1" class="step">
          <div class="row">
            <label>选择文件：<input type="file" accept=".csv,text/csv" @change="handleFileChange" /></label>
          </div>
          <div class="row">
            <label>分隔符：
              <select v-model="delimiter">
                <option value="auto">自动</option>
                <option value=",">逗号 ,</option>
                <option value=";">分号 ;</option>
                <option value="\t">制表符 TAB</option>
              </select>
            </label>
            <label style="margin-left:12px;">
              <input type="checkbox" v-model="hasHeader" /> 首行为表头
            </label>
            <label style="margin-left:12px;">
              <input type="checkbox" v-model="ignoreUnknownColumns" /> 忽略未知列
            </label>
          </div>
          <div v-if="previewRows.length > 0" class="preview">
            <div class="hint">预览（最多 50 行，仅供参考；实际解析由后端完成）</div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th v-for="c in columns" :key="'h-'+c">{{ hasHeader ? (previewRows[0]?.[c] ?? '') : ('列'+(c+1)) }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(r,ri) in (hasHeader ? previewRows.slice(1) : previewRows)" :key="'r-'+ri">
                    <td v-for="(v,ci) in r" :key="'c-'+ci">{{ v }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div v-else-if="step === 2" class="step">
          <h4>字段映射</h4>
          <div class="map-grid">
            <div class="map-row head">
              <div class="col">CSV 列</div>
              <div class="col">映射到字段</div>
            </div>
            <div class="map-row" v-for="c in columns" :key="'m-'+c">
              <div class="col">{{ hasHeader ? (previewRows[0]?.[c] ?? ('列'+(c+1))) : ('列'+(c+1)) }}</div>
              <div class="col">
                <select v-model="(mapping as any)[c]">
                  <option :value="null">跳过</option>
                  <option v-for="f in fields" :key="f.id" :value="f.id">#{{ f.id }} {{ f.name }}</option>
                </select>
              </div>
            </div>
          </div>
          <p class="tip">提示：未映射的列将被忽略；若关闭“忽略未知列”，未映射且非空的列会被标记为错误。</p>
        </div>

        <div v-else class="step">
          <p>确认导入到表 #{{ tableId }}，开始前会进行预校验。</p>
          <div v-if="validation">
            <p>预校验：共 {{ validation.totalRows }} 行，
              <span style="color:#2e7d32">有效 {{ validation.valid }}</span>，
              <span :style="{color: validation.invalid>0 ? '#b00' : '#333'}">无效 {{ validation.invalid }}</span>
            </p>
            <div v-if="validation.invalid > 0" class="errlist">
              <div v-for="(er, i) in validation.errors" :key="'er-'+i" class="errrow">
                第 {{ er.rowIndex }} 行：
                <span v-for="(iss, j) in er.issues" :key="'iss-'+j" class="issue">[列 {{ iss.columnIndex + 1 }}] {{ iss.message }}</span>
              </div>
              <div class="actions">
                <button class="link" @click="downloadFailures">下载失败清单（CSV）</button>
              </div>
              <div class="tip" style="margin-top:6px;">
                问题类型统计：
                <span v-for="s in errorTypeStats" :key="s.key" style="margin-right:10px;">{{ s.label }}：{{ s.count }}</span>
              </div>
              <p style="color:#b00;">请修正 CSV 或映射后重试。</p>
            </div>
          </div>
          <div v-if="busy" class="prog">
            <div class="bar"><div class="fill" :style="{width: progress+'%'}"></div></div>
            <div class="txt">{{ progress < 100 ? '导入中…' : '完成' }}</div>
          </div>

          <!-- 导入完成统计摘要 -->
          <div v-if="!busy && importSummary" class="summary">
            <h4>导入完成统计</h4>
            <p>
              总行数：{{ importSummary.totalRows }}；
              成功：<span style="color:#2e7d32">{{ importSummary.inserted ?? 0 }}</span>；
              失败：<span :style="{color: (importSummary.invalid ?? 0) > 0 ? '#b00' : '#333'}">{{ importSummary.invalid ?? 0 }}</span>；
              回滚：<span>{{ importSummary.rolledBack ? '是' : '否' }}</span>
            </p>
            <p class="tip">当前版本仅支持“新增”导入，更新/跳过统计为 0。</p>
            <div class="actions">
              <button class="link" v-if="(importSummary.invalid ?? 0) > 0" @click="downloadFailures">下载失败清单（CSV）</button>
              <button style="margin-left:8px;" @click="close">完成</button>
            </div>
          </div>
        </div>
      </section>
      <footer class="iwz-footer">
        <div class="left">
          <span v-if="busy">导入中…</span>
        </div>
        <div class="right">
          <button @click="close" :disabled="busy">取消</button>
          <button v-if="step===1" @click="toStep2" :disabled="!file">下一步</button>
          <button v-else-if="step===2" @click="toStep3">下一步</button>
          <button v-else @click="submitImport" :disabled="busy || !file">{{ validation && validation.invalid>0 ? '重新预校验' : '开始导入' }}</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.iwz-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; z-index: 1000; }
.iwz-panel { width: 880px; max-width: 96vw; max-height: 90vh; background: #fff; border-radius: 10px; display:flex; flex-direction:column; box-shadow: 0 6px 24px rgba(0,0,0,0.2); }
.iwz-header { display:flex; align-items:center; padding: 12px 16px; border-bottom: 1px solid #eee; }
.iwz-header h3 { margin: 0; font-size: 16px; }
.iwz-header .close { margin-left:auto; border:none; background:transparent; font-size: 20px; cursor: pointer; }
.iwz-body { padding: 12px 16px; overflow: auto; }
.err { color:#b00; margin: 6px 0; }
.step .row { margin: 8px 0; }
.preview .hint { color:#666; font-size: 12px; margin-bottom: 8px; }
.table-wrap { overflow:auto; border:1px solid #eee; border-radius: 6px; }
.table-wrap table { border-collapse: collapse; width: 100%; }
.table-wrap th, .table-wrap td { border: 1px solid #eee; padding: 4px 8px; font-size: 12px; }
.map-grid { display:flex; flex-direction:column; gap:8px; }
.map-row { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items:center; }
.map-row.head { font-weight: bold; }
.tip { color: #666; font-size: 12px; }
.iwz-footer { display:flex; align-items:center; justify-content:space-between; padding: 10px 16px; border-top: 1px solid #eee; }
.iwz-footer .right button { margin-left: 8px; }
.errlist { background: #fff7f7; border: 1px solid #f0c2c2; border-radius: 6px; padding: 8px 10px; max-height: 200px; overflow:auto; }
.errrow { font-size: 12px; color: #b00; margin: 4px 0; }
.issue { margin-right: 8px; }
.actions { margin-top: 8px; }
.link { background: transparent; border: none; color: #1976d2; cursor: pointer; text-decoration: underline; font-size: 12px; padding: 0; }
.prog { display:flex; align-items:center; gap:8px; }
.bar { width: 240px; height: 8px; background: #eee; border-radius: 6px; overflow:hidden; }
.fill { height: 100%; background: #42b883; width: 0; transition: width .2s ease; }
.summary { background: #f8fbff; border: 1px solid #cfe3ff; border-radius: 6px; padding: 10px; margin-top: 8px; }
</style>