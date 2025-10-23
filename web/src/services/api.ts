export const API_BASE = ''

export function getToken(): string | null {
  try { return localStorage.getItem('token') } catch { return null }
}

export function setToken(token: string) {
  try { localStorage.setItem('token', token) } catch {}
}

export function clearToken() {
  try { localStorage.removeItem('token') } catch {}
}

async function request(path: string, init?: RequestInit) {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const resp = await fetch(`${API_BASE}${path}`, { ...(init || {}), headers: { ...headers, ...(init?.headers || {}) } })
  if (!resp.ok) throw new Error(`${path} failed: ${resp.status}`)
  return resp.json()
}

export const api = {
  login: async (username: string, password: string) => {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  },
  listTables: async () => request('/api/tables'),
  getTable: async (id: number) => request(`/api/tables/${id}`),

  // Fields
  listFields: async (tableId: number) => request(`/api/tables/${tableId}/fields`),
  createField: async (
    tableId: number,
    payload: { name: string; type: 'text'|'number'|'boolean'|'select'|'multi_select'|'formula'; optionsJson?: any; readonly?: boolean }
  ) => {
    return request(`/api/tables/${tableId}/fields`, { method: 'POST', body: JSON.stringify(payload) })
  },
  updateField: async (
    tableId: number,
    fieldId: number,
    payload: { name?: string; type?: 'text'|'number'|'boolean'|'select'|'multi_select'|'formula'; optionsJson?: any; readonly?: boolean }
  ) => {
    return request(`/api/tables/${tableId}/fields/${fieldId}`, { method: 'PUT', body: JSON.stringify(payload) })
  },
  deleteField: async (tableId: number, fieldId: number) => {
    return request(`/api/tables/${tableId}/fields/${fieldId}`, { method: 'DELETE' })
  },

  // Records
  listRecords: async (tableId: number, page?: number, size?: number) => {
    const params = new URLSearchParams()
    if (page) params.set('page', String(page))
    if (size) params.set('size', String(size))
    return request(`/api/tables/${tableId}/records?${params.toString()}`)
  },
  createRecord: async (tableId: number, payload: { values: Record<string, any>, formulaExprs?: Record<string, string> }) => {
    return request(`/api/tables/${tableId}/records`, { method: 'POST', body: JSON.stringify(payload) })
  },
  updateRecord: async (tableId: number, recordId: number, payload: { values?: Record<string, any>, formulaExprs?: Record<string, string> }) => {
    return request(`/api/tables/${tableId}/records/${recordId}` , { method: 'PUT', body: JSON.stringify(payload) })
  },
  deleteRecord: async (tableId: number, recordId: number) => {
    return request(`/api/tables/${tableId}/records/${recordId}`, { method: 'DELETE' })
  },

  // Imports
  importCsv: async (
    tableId: number,
    file: File,
    opts?: {
      delimiter?: ',' | ';' | '\t'
      hasHeader?: boolean
      ignoreUnknownColumns?: boolean
      mapping?: Record<number, number | null>
      dryRun?: boolean
      rollbackOnError?: boolean
    }
  ) => {
    const token = getToken()
    const fd = new FormData()
    fd.append('file', file)
    fd.append('format', 'csv')
    if (opts?.delimiter) fd.append('delimiter', opts.delimiter)
    if (opts?.hasHeader !== undefined) fd.append('hasHeader', String(!!opts.hasHeader))
    if (opts?.ignoreUnknownColumns !== undefined) fd.append('ignoreUnknownColumns', String(!!opts.ignoreUnknownColumns))
    if (opts?.mapping) fd.append('mapping', JSON.stringify(opts.mapping))
    if (opts?.dryRun !== undefined) fd.append('dryRun', String(!!opts.dryRun))
    if (opts?.rollbackOnError !== undefined) fd.append('rollbackOnError', String(!!opts.rollbackOnError))
    const resp = await fetch(`${API_BASE}/api/tables/${tableId}/import`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    })
    if (!resp.ok) throw new Error(`Import failed: ${resp.status}`)
    return resp.json()
  },
  getImportProgress: async (tableId: number) => {
    return request(`/api/tables/${tableId}/import/progress`)
  },

  // Views
  getViewData: async (
    viewId: number,
    opts?: { page?: number; size?: number; filters?: Array<{ fieldId: number; op: string; value?: any }>; sort?: { fieldId: number; direction: 'asc'|'desc' } }
  ) => {
    const params = new URLSearchParams()
    if (opts?.page) params.set('page', String(opts.page))
    if (opts?.size) params.set('size', String(opts.size))
    if (opts?.filters) params.set('filters', JSON.stringify(opts.filters))
    if (opts?.sort) params.set('sort', JSON.stringify(opts.sort))
    return request(`/api/views/${viewId}/data?${params.toString()}`)
  },
  createView: async (
    tableId: number,
    payload: { name: string; type: 'grid' | 'kanban' | 'gallery'; configJson?: any; anonymousEnabled?: boolean }
  ) => {
    const token = getToken()
    const resp = await fetch(`${API_BASE}/api/tables/${tableId}/views`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) throw new Error(`Create view failed: ${resp.status}`)
    return resp.json()
  },
  updateView: async (
    tableId: number,
    viewId: number,
    payload: { name?: string; configJson?: any; anonymousEnabled?: boolean }
  ) => {
    const token = getToken()
    const resp = await fetch(`${API_BASE}/api/tables/${tableId}/views/${viewId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) throw new Error(`Update view failed: ${resp.status}`)
    return resp.json()
  },
  // 新增：下载导入失败清单 CSV（返回 Blob）
  downloadImportFailuresCsv: async (tableId: number): Promise<Blob> => {
    const token = getToken()
    const resp = await fetch(`${API_BASE}/api/tables/${tableId}/import/failures.csv`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (resp.status === 404) {
      throw new Error('暂无失败清单可下载')
    }
    if (!resp.ok) throw new Error(`Download failures CSV failed: ${resp.status}`)
    return resp.blob()
  },
}