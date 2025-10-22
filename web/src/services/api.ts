// Force relative base in dev to ensure Vite proxy usage
const API_BASE = ''

export function getToken(): string | null {
  return localStorage.getItem('token')
}

export function setToken(token: string) {
  localStorage.setItem('token', token)
}

export function clearToken() {
  localStorage.removeItem('token')
}

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const resp = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const ct = resp.headers.get('content-type') || ''
  if (ct.includes('application/json')) return resp.json()
  return resp.text()
}

export const api = {
  login: async (username: string, password: string) => {
    const resp = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!resp.ok) throw new Error(`Login failed: ${resp.status}`)
    return resp.json()
  },
  listTables: () => request('/api/tables'),
  getTable: (id: number) => request(`/api/tables/${id}`),
  listFields: (tableId: number) => request(`/api/tables/${tableId}/fields`),
  listRecords: (tableId: number, page = 1, size = 20) => request(`/api/tables/${tableId}/records?page=${page}&size=${size}`),
  updateRecord: (tableId: number, id: number, payload: any) => request(`/api/tables/${tableId}/records/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  importCsv: async (tableId: number, file: File) => {
    const token = getToken()
    const fd = new FormData()
    fd.append('file', file)
    const resp = await fetch(`${API_BASE}/api/tables/${tableId}/import`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    })
    if (!resp.ok) throw new Error(`Import failed: ${resp.status}`)
    return resp.json()
  },
}