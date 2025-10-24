export type Project = { id: string; name: string }
export type Workbook = { id: string; projectId: string; name: string; tableIds: number[] }

const KEY = 'hierarchy'

type State = { projects: Project[]; workbooks: Workbook[] }

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { projects: [], workbooks: [] }
    const parsed = JSON.parse(raw)
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      workbooks: Array.isArray(parsed.workbooks) ? parsed.workbooks : [],
    }
  } catch {
    return { projects: [], workbooks: [] }
  }
}

function save(state: State) {
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch {}
}

function uid() { return Math.random().toString(36).slice(2, 10) }

export const hierarchy = {
  getState: (): State => load(),
  listProjects: (): Project[] => load().projects,
  listWorkbooks: (projectId: string): Workbook[] => load().workbooks.filter(w => w.projectId === projectId),
  createProject: (name: string): Project => {
    const state = load()
    const p: Project = { id: uid(), name: name.trim() || '未命名项目' }
    state.projects.push(p)
    save(state)
    return p
  },
  renameProject: (id: string, name: string) => {
    const state = load()
    const p = state.projects.find(x => x.id === id)
    if (p) { p.name = name.trim() || p.name; save(state) }
  },
  deleteProject: (id: string) => {
    const state = load()
    state.projects = state.projects.filter(x => x.id !== id)
    // 同时删除其下的工作簿
    state.workbooks = state.workbooks.filter(w => w.projectId !== id)
    save(state)
  },
  createWorkbook: (projectId: string, name: string): Workbook => {
    const state = load()
    const w: Workbook = { id: uid(), projectId, name: name.trim() || '未命名工作簿', tableIds: [] }
    state.workbooks.push(w)
    save(state)
    return w
  },
  renameWorkbook: (id: string, name: string) => {
    const state = load()
    const w = state.workbooks.find(x => x.id === id)
    if (w) { w.name = name.trim() || w.name; save(state) }
  },
  deleteWorkbook: (id: string) => {
    const state = load()
    state.workbooks = state.workbooks.filter(x => x.id !== id)
    save(state)
  },
  addTableToWorkbook: (workbookId: string, tableId: number) => {
    const state = load()
    const w = state.workbooks.find(x => x.id === workbookId)
    if (w && !w.tableIds.includes(tableId)) { w.tableIds.push(tableId); save(state) }
  },
  removeTableFromWorkbook: (workbookId: string, tableId: number) => {
    const state = load()
    const w = state.workbooks.find(x => x.id === workbookId)
    if (w) { w.tableIds = w.tableIds.filter(id => id !== tableId); save(state) }
  },
}