<script setup lang="ts">
import { onMounted, ref, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../services/api'
import ImportWizard from '../components/ImportWizard.vue'

const route = useRoute()
const router = useRouter()
const tableId = computed(() => Number(route.params.id))

const loading = ref(true)
const error = ref<string | null>(null)
const table = ref<any | null>(null)
const fields = ref<any[]>([])
const records = ref<any[]>([])
const page = ref(1)
const size = ref(20)
const total = ref(0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / size.value)))

const showImport = ref(false)

// 新增：行动提示
const actionBusy = ref(false)
const actionMsg = ref<string | null>(null)
const actionErr = ref<string | null>(null)

async function load() {
  try {
    loading.value = true
    error.value = null
    table.value = await api.getTable(tableId.value)
    fields.value = await api.listFields(tableId.value)
    const list = await api.listRecords(tableId.value, page.value, size.value)
    records.value = list.data
    total.value = list.total ?? (Array.isArray(list.data) ? list.data.length : 0)
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function fieldNameById(fid: number) {
  const f = fields.value.find((x) => x.id === fid)
  return f?.name ?? String(fid)
}

async function updateCell(recordId: number, fieldId: number, raw: any) {
  try {
    await api.updateRecord(tableId.value, recordId, { values: { [String(fieldId)]: raw } })
    await load()
  } catch (e: any) {
    alert(e?.message || '更新失败')
  }
}

// 分页操作
async function goPrev() {
  if (page.value > 1) {
    page.value -= 1
    await load()
  }
}
async function goNext() {
  if (page.value < pageCount.value) {
    page.value += 1
    await load()
  }
}

// 测试与诊断：确保存在 A/B 字段并创建一条示例记录
const diagBusy = ref(false)
const diagMsg = ref<string | null>(null)
const diagErr = ref<string | null>(null)
const testA = ref<number | null>(1)
const testB = ref<number | null>(2)

async function ensureFieldByName(name: string) {
  let f = fields.value.find((x) => String(x.name).toLowerCase() === name.toLowerCase())
  if (f) return f
  f = await api.createField(tableId.value, { name, type: 'number', optionsJson: { precision: 0 }, readonly: false })
  // 刷新本地字段缓存
  fields.value = await api.listFields(tableId.value)
  return f
}

async function runDiagnostics() {
  try {
    diagBusy.value = true
    diagMsg.value = null
    diagErr.value = null

    // 1) 统计当前表的字段与记录数量
    const beforeFields = fields.value.length
    const beforeRecords = records.value.length

    // 2) 确保存在 A/B 字段
    const fa = await ensureFieldByName('A')
    const fb = await ensureFieldByName('B')

    // 3) 创建一条示例记录（A/B）
    const values: Record<string, any> = {}
    if (testA.value !== null && testA.value !== undefined) values[String(fa.id)] = testA.value
    if (testB.value !== null && testB.value !== undefined) values[String(fb.id)] = testB.value
    await api.createRecord(tableId.value, { values })

    // 4) 重新加载，得到创建后的字段与记录数量
    await load()
    const afterFields = fields.value.length
    const afterList = await api.listRecords(tableId.value, 1, size.value)
    const afterRecords = afterList.total ?? afterList.data?.length ?? records.value.length

    // 5) 输出诊断信息
    diagMsg.value = `诊断完成：字段数 ${beforeFields} → ${afterFields}；记录数 ${beforeRecords} → ${afterRecords}。`
  } catch (e: any) {
    diagErr.value = e?.message || '诊断执行失败'
  } finally {
    diagBusy.value = false
  }
}

async function openGridView() {
  try {
    const v = await api.createView(tableId.value, { name: `匿名网格视图-${Date.now()}`, type: 'grid', configJson: { page: 1, size: size.value }, anonymousEnabled: true })
    router.push({ path: `/grid/${v.id}` })
  } catch (e: any) {
    alert(e?.message || '创建视图失败')
  }
}

// 快速录入：状态与方法
const newRecordValues = ref<Record<string, any>>({})
function resetNewRecordValues() {
  const v: Record<string, any> = {}
  for (const f of fields.value) {
    const key = String(f.id)
    if (f.type === 'boolean') v[key] = false
    else if (f.type === 'multi_select') v[key] = []
    else v[key] = ''
  }
  newRecordValues.value = v
}
function fieldStep(f: any): number {
  const p = Number(f?.optionsJson?.precision ?? 0)
  if (!p || Number.isNaN(p) || p <= 0) return 1
  return Number((1 / Math.pow(10, p)).toFixed(p))
}
function clearNewRecordForm() { resetNewRecordValues() }
watch(fields, () => resetNewRecordValues(), { immediate: true })

async function saveNewRecord() {
  try {
    actionBusy.value = true
    actionErr.value = null
    actionMsg.value = null
    const values: Record<string, any> = {}
    for (const f of fields.value) {
      const key = String(f.id)
      const t = f.type
      const v = newRecordValues.value[key]
      if (t === 'text') {
        if (v !== '' && v !== null && v !== undefined) values[key] = v
      } else if (t === 'number') {
        if (v !== '' && v !== null && v !== undefined) {
          const num = typeof v === 'number' ? v : parseFloat(String(v))
          if (!Number.isNaN(num)) values[key] = num
        }
      } else if (t === 'boolean') {
        values[key] = !!v
      } else if (t === 'select') {
        if (v !== '' && v !== null && v !== undefined) values[key] = v
      } else if (t === 'multi_select') {
        if (Array.isArray(v) && v.length) values[key] = v
      } else if (t === 'formula') {
        // 公式字段由后端计算，这里不提交
      } else {
        if (v !== '' && v !== null && v !== undefined) values[key] = v
      }
    }
    await api.createRecord(tableId.value, { values })
    // 成功后跳转到最后一页并刷新
    const latest = await api.listRecords(tableId.value, 1, size.value)
    const newTotal = latest.total ?? (Array.isArray(latest.data) ? latest.data.length : 0)
    page.value = Math.max(1, Math.ceil(newTotal / size.value))
    await load()
    actionMsg.value = '记录已创建'
    resetNewRecordValues()
  } catch (e: any) {
    actionErr.value = e?.message || '创建记录失败'
  } finally {
    actionBusy.value = false
  }
}

 // 快速新增：字段（无 prompt）
 const showAddField = ref(false)
 const newFieldName = ref('')
 const newFieldType = ref<'text'|'number'|'boolean'|'select'|'multi_select'|'formula'>('number')
 const newFieldReadonly = ref(false)
 // number 选项
 const numberMin = ref<string>('')
 const numberMax = ref<string>('')
 const numberPrecision = ref<string>('0')
 // select / multi_select 选项（每行一个）
 const selectOptionsText = ref('')
 // formula 选项
 const formulaPrecision = ref<string>('')
 // Chips 交互（取代 textarea）
 const selectOptions = ref<string[]>([])
 const selectInput = ref('')
 function addSelectOptionFromInput() {
   const v = selectInput.value.trim()
   if (v && !selectOptions.value.includes(v)) selectOptions.value.push(v)
   selectInput.value = ''
 }
 function removeSelectOption(idx: number) { selectOptions.value.splice(idx, 1) }
 function handleSelectInputKeydown(e: KeyboardEvent) {
   if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSelectOptionFromInput() }
   else if (e.key === 'Backspace' && !selectInput.value && selectOptions.value.length) { selectOptions.value.pop() }
 }

 async function createFieldConfirm() {
   const name = newFieldName.value.trim()
   if (!name) {
     actionErr.value = '请输入字段名称'
     actionMsg.value = null
     return
   }
   try {
     actionBusy.value = true
     actionErr.value = null
     actionMsg.value = null

     let optionsJson: any | undefined
     const t = newFieldType.value
     if (t === 'number') {
       const opts: any = {}
       const min = parseFloat(numberMin.value)
       const max = parseFloat(numberMax.value)
       const prec = parseInt(numberPrecision.value, 10)
       if (!Number.isNaN(min)) opts.min = min
       if (!Number.isNaN(max)) opts.max = max
       if (!Number.isNaN(prec)) opts.precision = prec
       optionsJson = opts
     } else if (t === 'select' || t === 'multi_select') {
       const lines = selectOptions.value.map(s => s.trim()).filter(Boolean)
       if (lines.length) optionsJson = { options: lines }
     } else if (t === 'formula') {
       const prec = parseInt(formulaPrecision.value, 10)
       if (!Number.isNaN(prec)) optionsJson = { precision: prec }
     }

     await api.createField(tableId.value, {
       name,
       type: t,
       ...(optionsJson ? { optionsJson } : {}),
       readonly: !!newFieldReadonly.value,
     })

     fields.value = await api.listFields(tableId.value)
     actionMsg.value = `字段已创建：${name}`
     // 重置表单
     showAddField.value = false
     newFieldName.value = ''
     newFieldType.value = 'number'
     newFieldReadonly.value = false
     numberMin.value = ''
     numberMax.value = ''
     numberPrecision.value = '0'
     selectOptionsText.value = ''
     selectOptions.value = []
     selectInput.value = ''
     formulaPrecision.value = ''
   } catch (e: any) {
     actionErr.value = e?.message || '创建字段失败'
   } finally {
     actionBusy.value = false
   }
 }

 async function createRecordQuick() {
   try {
     actionBusy.value = true
     actionErr.value = null
     actionMsg.value = null
     await api.createRecord(tableId.value, { values: {} })
     // 若总数已满一页，新增记录可能在后续页；为便于定位，跳到最后一页
     const latest = await api.listRecords(tableId.value, 1, size.value)
     const newTotal = (latest.total ?? 0) + 0
     page.value = Math.max(1, Math.ceil(newTotal / size.value))
     await load()
     actionMsg.value = '记录已创建'
   } catch (e: any) {
     actionErr.value = e?.message || '创建记录失败'
   } finally {
     actionBusy.value = false
   }
 }

 function onImportSuccess() {
   // 导入成功后刷新
   load()
 }

 
const editing = ref<{ rid: number; fid: number } | null>(null)
const editingValue = ref<any>(null)
function isEditingCell(rid: number, fid: number) {
  return editing.value && editing.value.rid === rid && editing.value.fid === fid
}
function startEdit(r: any, f: any) {
  if (f.type === 'boolean' || f.type === 'formula') return
  const key = String(f.id)
  editing.value = { rid: r.id, fid: f.id }
  const v = r.values?.[key]
  if (f.type === 'multi_select') {
    editingValue.value = Array.isArray(v) ? [...v] : []
    msInput.value = ''
  } else {
    editingValue.value = v ?? ''
  }
}
function cancelEdit() { editing.value = null }
async function commitEdit(f: any) {
  if (!editing.value) return
  const { rid, fid } = editing.value
  let val: any = editingValue.value
  if (f.type === 'text') {
    if (typeof val === 'string' && val.trim() === '') val = null
  } else if (f.type === 'number') {
    if (val === '' || val === null || val === undefined) val = null
    else {
      const num = typeof val === 'number' ? val : parseFloat(String(val))
      val = Number.isNaN(num) ? null : num
    }
  } else if (f.type === 'select') {
    if (val === '' || val === null || val === undefined) val = null
  } else if (f.type === 'multi_select') {
    if (!Array.isArray(val)) val = []
  }
  try {
    await updateCell(rid, fid, val)
  } finally {
    editing.value = null
  }
}
function onCellKeydown(e: KeyboardEvent, f: any) {
  if (e.key === 'Enter') { e.preventDefault(); commitEdit(f) }
  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
}
async function onToggleBoolean(rid: number, fid: number, checked: boolean) {
  await updateCell(rid, fid, !!checked)
}

// 键盘导航与活动单元格管理
const activeCell = ref<{ rowIndex: number; colIndex: number } | null>(null)
function setActiveCell(ri: number, ci: number) {
  activeCell.value = { rowIndex: ri, colIndex: ci }
}
function focusCellByIndex(ri: number, ci: number) {
  nextTick(() => {
    const el = document.getElementById(`cell-${ri}-${ci}`) as HTMLElement | null
    if (el) el.focus()
  })
}
function moveCell(ri: number, ci: number, dR: number, dC: number) {
  const rows = records.value.length
  const cols = fields.value.length
  let nr = ri + dR
  let nc = ci + dC
  if (nr < 0) nr = 0
  if (nr > rows - 1) nr = rows - 1
  if (nc < 0) nc = 0
  if (nc > cols - 1) nc = cols - 1
  setActiveCell(nr, nc)
  focusCellByIndex(nr, nc)
}
function onCellNavKeydown(e: KeyboardEvent, ri: number, ci: number, r: any, f: any) {
  // 非编辑态下处理方向键/Tab/Enter
  if (isEditingCell(r.id, f.id)) return
  if (e.key === 'Enter') { e.preventDefault(); startEdit(r, f); return }
  if (e.key === 'ArrowRight') { e.preventDefault(); moveCell(ri, ci, 0, 1); return }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); moveCell(ri, ci, 0,-1); return }
  if (e.key === 'ArrowDown')  { e.preventDefault(); moveCell(ri, ci, 1, 0); return }
  if (e.key === 'ArrowUp')    { e.preventDefault(); moveCell(ri, ci,-1, 0); return }
  if (e.key === 'Tab') { e.preventDefault(); moveCell(ri, ci, 0, e.shiftKey ? -1 : 1); return }
}

// 多选 Chips 编辑
const msInput = ref<string>('')
function msAddFromInput() {
  const s = msInput.value.trim()
  if (!s) return
  if (!Array.isArray(editingValue.value)) editingValue.value = []
  if (!(editingValue.value as any[]).includes(s)) {
    editingValue.value = [ ...(editingValue.value as any[]), s ]
  }
  msInput.value = ''
}
function msRemove(idx: number) {
  if (!Array.isArray(editingValue.value)) return
  editingValue.value = (editingValue.value as any[]).filter((_, i) => i !== idx)
}
function msKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); msAddFromInput(); return }
  if (e.key === 'Backspace' && msInput.value === '' && Array.isArray(editingValue.value) && (editingValue.value as any[]).length) {
    editingValue.value = (editingValue.value as any[]).slice(0, -1)
  }
}
function onMsBlur(_e: FocusEvent, f: any) {
  msAddFromInput()
  commitEdit(f)
}

</script>

<template>
  <div class="table-detail">
    <header>
      <h2>表 #{{ table?.id }} - {{ table?.name }}</h2>
      <small>revision: {{ table?.revision }}</small>
    </header>

    <div class="actions">
      <template v-if="!showAddField">
        <button :disabled="actionBusy" @click="showAddField = true">新增字段</button>
      </template>
      <template v-else>
        <input placeholder="字段名称" v-model="newFieldName" />
        <select v-model="newFieldType" title="字段类型">
          <option value="text">text</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
          <option value="select">select</option>
          <option value="multi_select">multi_select</option>
          <option value="formula">formula</option>
        </select>
    
        <template v-if="newFieldType === 'number'">
          <input style="width:100px" placeholder="min" v-model="numberMin" />
          <input style="width:100px" placeholder="max" v-model="numberMax" />
          <input style="width:100px" placeholder="precision" v-model="numberPrecision" />
        </template>
        <template v-else-if="newFieldType === 'select' || newFieldType === 'multi_select'">
        <div class="chips">
          <span v-for="(opt, idx) in selectOptions" :key="opt+idx" class="chip">
            {{ opt }}
            <button type="button" class="remove" @click.stop="removeSelectOption(idx)">×</button>
          </span>
          <input
            class="chip-input"
            v-model="selectInput"
            placeholder="输入后回车或逗号添加"
            @keydown="handleSelectInputKeydown"
            @blur="addSelectOptionFromInput"
          />
        </div>
      </template>
        <template v-else-if="newFieldType === 'formula'">
          <input style="width:120px" placeholder="precision（可选）" v-model="formulaPrecision" />
        </template>
    
        <label style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" v-model="newFieldReadonly" /> 只读
        </label>
    
        <button :disabled="actionBusy" @click="createFieldConfirm">保存</button>
        <button :disabled="actionBusy" @click="() => { showAddField = false; newFieldName = ''; newFieldType = 'number'; newFieldReadonly = false; numberMin=''; numberMax=''; numberPrecision='0'; selectOptionsText=''; selectOptions=[]; selectInput=''; formulaPrecision='' }">取消</button>
      </template>
      <button :disabled="actionBusy" @click="createRecordQuick">新增记录</button>
      <button @click="showImport = true">导入 CSV</button>
    </div>
    <div v-if="actionBusy" class="state">执行中…</div>
    <div v-else-if="actionErr" class="state error">{{ actionErr }}</div>
    <div v-else-if="actionMsg" class="state ok">{{ actionMsg }}</div>
    <section v-if="fields.length" class="quick-entry">
      <h3>快速录入（支持表格内联编辑）</h3>
      <div class="qe-row">
        <div v-for="f in fields" :key="'qe-'+f.id" class="qe-cell">
          <div class="qe-label">{{ f.name }}</div>
          <template v-if="f.type === 'text'">
            <input v-model="newRecordValues[String(f.id)]" />
          </template>
          <template v-else-if="f.type === 'number'">
            <input type="number"
                   v-model.number="newRecordValues[String(f.id)]"
                   :min="f.optionsJson?.min"
                   :max="f.optionsJson?.max"
                   :step="fieldStep(f)" />
          </template>
          <template v-else-if="f.type === 'boolean'">
            <label class="qe-checkbox">
              <input type="checkbox" v-model="newRecordValues[String(f.id)]" />
              <span>是/否</span>
            </label>
          </template>
          <template v-else-if="f.type === 'select'">
            <select v-model="newRecordValues[String(f.id)]">
              <option value="" disabled>请选择</option>
              <option v-for="opt in (f.optionsJson?.options || [])" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </template>
          <template v-else-if="f.type === 'multi_select'">
            <select multiple v-model="newRecordValues[String(f.id)]">
              <option v-for="opt in (f.optionsJson?.options || [])" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </template>
          <template v-else-if="f.type === 'formula'">
            <input disabled placeholder="公式字段，自动计算" />
          </template>
          <template v-else>
            <input v-model="newRecordValues[String(f.id)]" />
          </template>
        </div>
      </div>
      <div class="qe-actions">
        <button :disabled="actionBusy" @click="saveNewRecord">保存记录</button>
        <button :disabled="actionBusy" @click="clearNewRecordForm">清空</button>
      </div>
    </section>
 
    <section class="diagnostics">
      <h3>诊断与测试（网格显示）</h3>
      <p>用于快速判断“网格视图无显示”是因为表数据为空，还是网格功能异常。</p>
      <div class="form">
        <label>示例字段 A 值：<input type="number" v-model.number="testA" /></label>
        <label>示例字段 B 值：<input type="number" v-model.number="testB" /></label>
        <button :disabled="diagBusy" @click="runDiagnostics">运行诊断并填充一条测试记录</button>
        <button :disabled="diagBusy" @click="openGridView">创建匿名网格视图并打开</button>
      </div>
      <div v-if="diagBusy" class="state">诊断执行中…</div>
      <div v-else-if="diagErr" class="state error">{{ diagErr }}</div>
      <div v-else-if="diagMsg" class="state ok">{{ diagMsg }}</div>
    </section>

    <section>
      <h3>字段</h3>
      <ul>
        <li v-for="f in fields" :key="f.id">#{{ f.id }} {{ f.name }}</li>
      </ul>
    </section>

    <section>
      <h3>记录（第 {{ page }} / 共 {{ pageCount }} 页，每页 {{ size }}，总数 {{ total }}）</h3>
      <div class="pager">
        <button @click="goPrev" :disabled="page <= 1">上一页</button>
        <button @click="goNext" :disabled="page >= pageCount">下一页</button>
      </div>
      <table class="records">
        <thead>
          <tr>
            <th>ID</th>
            <th v-for="f in fields" :key="'h-'+f.id">{{ f.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, ri) in records" :key="r.id">
            <td>{{ r.id }}</td>
            <td v-for="(f, ci) in fields"
                :key="r.id+'-'+f.id"
                :id="'cell-'+ri+'-'+ci"
                tabindex="0"
                @focus="setActiveCell(ri, ci)"
                @keydown="onCellNavKeydown($event, ri, ci, r, f)"
                :class="['cell', { editing: isEditingCell(r.id, f.id) }]"
                @click="startEdit(r, f)">
               <template v-if="f.type === 'boolean'">
                 <input type="checkbox"
                        :checked="!!r.values?.[String(f.id)]"
                        @change.stop="onToggleBoolean(r.id, f.id, ($event.target as HTMLInputElement).checked)" />
               </template>
 
               <template v-else-if="isEditingCell(r.id, f.id)">
                 <template v-if="f.type === 'text'">
                   <input v-model="editingValue" @keydown="onCellKeydown($event, f)" @blur="commitEdit(f)" autofocus @click.stop />
                 </template>
                 <template v-else-if="f.type === 'number'">
                   <input type="number"
                          v-model.number="editingValue"
                          :min="f.optionsJson?.min"
                          :max="f.optionsJson?.max"
                          :step="fieldStep(f)"
                          @keydown="onCellKeydown($event, f)"
                          @blur="commitEdit(f)"
                          autofocus @click.stop />
                 </template>
                 <template v-else-if="f.type === 'select'">
                   <select v-model="editingValue" @change="commitEdit(f)" @blur="commitEdit(f)" autofocus @click.stop>
                     <option value="">请选择</option>
                     <option v-for="opt in (f.optionsJson?.options || [])" :key="opt" :value="opt">{{ opt }}</option>
                   </select>
                 </template>
                <template v-else-if="f.type === 'multi_select'">
                  <div class="cell-chips" @click.stop>
                    <span class="chip" v-for="(opt, idx) in editingValue || []" :key="opt+idx">
                      {{ opt }}
                      <button type="button" class="remove" @mousedown.prevent @click.stop="msRemove(idx)">×</button>
                    </span>
                    <input class="chip-input"
                           v-model="msInput"
                           placeholder="输入后回车/逗号添加"
                           @keydown="msKeydown"
                           @blur="onMsBlur($event, f)"
                           autofocus />
                  </div>
                </template>
                 <template v-else>
                   <input v-model="editingValue" @keydown="onCellKeydown($event, f)" @blur="commitEdit(f)" autofocus @click.stop />
                 </template>
               </template>
 
               <template v-else>
                 <span>
                   {{ Array.isArray(r.values?.[String(f.id)])
                        ? (r.values?.[String(f.id)] || []).join(', ')
                        : (r.values?.[String(f.id)] ?? '') }}
                 </span>
               </template>
             </td>
           </tr>
        </tbody>
      </table>
    </section>

    <ImportWizard :open="showImport" :table-id="tableId" :fields="fields" @close="showImport=false" @success="onImportSuccess" />
  </div>
</template>

<style scoped>
.table-detail { padding: 16px; }
header { display: flex; align-items: baseline; gap: 8px; }
.actions { display: flex; gap: 8px; margin: 8px 0; }
.diagnostics { margin: 16px 0; padding: 12px; border: 1px solid #ddd; border-radius: 8px; }
.diagnostics .form { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
.state { padding: 8px; color: #666; }
.state.error { color: #b00; }
.state.ok { color: #0a0; }
.records { width: 100%; border-collapse: collapse; }
.records th, .records td { border: 1px solid #ddd; padding: 4px 8px; }
.pager { display:flex; gap:8px; margin:6px 0 12px; }
.chips { display:flex; gap:6px; align-items:center; flex-wrap:wrap; min-height:32px; padding:6px; border:1px solid #ddd; border-radius:6px; }
.chip { background:#f0f0f0; padding:2px 6px; border-radius:12px; display:inline-flex; align-items:center; gap:4px; }
.chip .remove { border:none; background:transparent; cursor:pointer; font-size:14px; line-height:1; }
.chip-input { border:none; outline:none; min-width:140px; }
.quick-entry { margin: 16px 0; padding: 12px; border: 1px dashed #ccc; border-radius: 8px; }
.qe-row { display: flex; gap: 12px; flex-wrap: wrap; }
.qe-cell { display: flex; flex-direction: column; gap: 6px; min-width: 160px; }
.qe-label { font-size: 12px; color: #666; }
.qe-checkbox { display: inline-flex; align-items: center; gap: 6px; }
/* grid inline edit */
.records td.cell { cursor: text; }
.records td.cell.editing { background: #fff7e6; outline: 1px solid #f0ad4e; }
.records td.cell input,
.records td.cell select { width: 100%; box-sizing: border-box; }
.cell-chips { display:flex; gap:6px; align-items:center; flex-wrap:wrap; min-height:24px; padding:4px; border:1px solid #ddd; border-radius:4px; }
.cell-chips .chip { background:#f0f0f0; padding:2px 6px; border-radius:12px; display:inline-flex; align-items:center; gap:4px; }
.cell-chips .remove { border:none; background:transparent; cursor:pointer; font-size:14px; line-height:1; }
.cell-chips .chip-input { border:none; outline:none; min-width:100px; }
 /* chips/nav */
 </style>