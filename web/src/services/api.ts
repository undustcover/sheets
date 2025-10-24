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
  if (!resp.ok) {
    let body: any = null
    try { body = await resp.json() } catch {}
    const msg = body?.message || `${path} failed: ${resp.status}`
    const err: any = new Error(msg)
    err.status = resp.status
    err.code = body?.code
    err.details = body?.details
    throw err
  }
  return resp.json()
}

export const api = {
  login: async (username: string, password: string) => {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  },
  listTables: () => request('/api/tables'),
  getTable: (id: number) => request(`/api/tables/${id}`),
  updateTable: (id: number, payload: { name?: string; metaJson?: any; exportAllowedRoles?: string[]; anonymousEnabled?: boolean }) =>
    request(`/api/tables/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  listFields: (tableId: number) => request(`/api/tables/${tableId}/fields`),
  createField: (tableId: number, payload: { name: string; type: string; optionsJson?: any; readonly?: boolean }) =>
    request(`/api/tables/${tableId}/fields`, { method: 'POST', body: JSON.stringify(payload) }),
  removeField: (tableId: number, id: number) =>
    request(`/api/tables/${tableId}/fields/${id}`, { method: 'DELETE' }),
  listRecords: (tableId: number, page = 1, size = 20) => request(`/api/tables/${tableId}/records?page=${page}&size=${size}`),
  createRecord: (tableId: number, payload: { values: Record<string, any>; formulas?: Record<string, string> }) =>
    request(`/api/tables/${tableId}/records`, { method: 'POST', body: JSON.stringify(payload) }),
  updateRecord: (tableId: number, id: number, payload: any) => request(`/api/tables/${tableId}/records/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteRecord: (tableId: number, id: number) => request(`/api/tables/${tableId}/records/${id}`, { method: 'DELETE' }),
  importCsv: async (tableId: number, file: File, opts?: { delimiter?: string; hasHeader?: boolean; ignoreUnknownColumns?: boolean; mapping?: Record<string, number>; dryRun?: boolean; rollbackOnError?: boolean }) => {
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
  getViewData: async (
    viewId: number,
    opts?: { page?: number; size?: number; filters?: Array<{ fieldId: number; op: string; value?: any }>; sort?: { fieldId: number; direction: 'asc'|'desc' } }
  ) => {
    const params = new URLSearchParams()
    if (opts?.page) params.set('page', String(opts.page))
    if (opts?.size) params.set('size', String(opts.size))
    if (opts?.filters) params.set('filters', JSON.stringify(opts.filters))
    if (opts?.sort) params.set('sort', JSON.stringify(opts.sort))
    const token = getToken()
    const path = token ? `/api/views/${viewId}/data/authed` : `/api/views/${viewId}/data`
    const resp = await fetch(`${API_BASE}${path}?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!resp.ok) throw new Error(`View data failed: ${resp.status}`)
    return resp.json()
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
    id: number,
    payload: { name?: string; type?: 'grid' | 'kanban' | 'gallery'; configJson?: any; anonymousEnabled?: boolean }
  ) => {
    const token = getToken()
    const resp = await fetch(`${API_BASE}/api/tables/${tableId}/views/${id}`, {
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
  // 批量单元格写入（M2-05）
  batchCellsWrite: async (
    tableId: number,
    payload: { revision: number; writes: Array<{ recordId: number; fieldId: number; value?: any; formulaExpr?: string }> }
  ) => {
    const token = getToken()
    const resp = await fetch(`${API_BASE}/api/tables/${tableId}/cells/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    })
    if (resp.ok) return resp.json()
    let body: any = null
    try { body = await resp.json() } catch {}
    const err: any = new Error(`[${resp.status}] ${body?.message || 'Batch write failed'}`)
    err.status = resp.status
    err.details = body?.details
    throw err
  },
  // 新增：创建/删除表
  createTable: (payload: { name: string; metaJson?: any; anonymousEnabled?: boolean }) => request(`/api/tables`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteTable: (id: number) => request(`/api/tables/${id}`, { method: 'DELETE' }),
}