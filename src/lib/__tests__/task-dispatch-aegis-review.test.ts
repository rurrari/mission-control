import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  AEGIS_REVIEWABLE_TASKS_SQL,
  AEGIS_REVIEW_DISPATCH_MODEL,
  AEGIS_GRADUATION_THRESHOLD,
  recordAegisVerdictForProject,
  pickProvider,
} from '@/lib/task-dispatch'

function makeFixtureDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE workspaces (
      id INTEGER PRIMARY KEY,
      isolation TEXT NOT NULL
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      ticket_prefix TEXT,
      consecutive_aegis_approvals INTEGER NOT NULL DEFAULT 0,
      aegis_graduated_at INTEGER
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      priority TEXT,
      resolution TEXT,
      assigned_to TEXT,
      workspace_id INTEGER NOT NULL,
      project_id INTEGER,
      project_ticket_no INTEGER,
      metadata TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE agents (
      name TEXT NOT NULL,
      workspace_id INTEGER NOT NULL,
      config TEXT
    );
  `)
  db.prepare(`INSERT INTO workspaces (id, isolation) VALUES (1, 'shared')`).run()
  return db
}

let taskId = 0
function insertTask(
  db: Database.Database,
  overrides: Partial<{
    status: string
    metadata: string | null
    workspace_id: number
  }> = {}
) {
  taskId += 1
  db.prepare(
    `INSERT INTO tasks (id, title, status, workspace_id, metadata, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    taskId,
    `Task ${taskId}`,
    overrides.status ?? 'review',
    overrides.workspace_id ?? 1,
    overrides.metadata === undefined ? null : overrides.metadata,
    taskId
  )
  return taskId
}

describe('AEGIS_REVIEWABLE_TASKS_SQL (GATE-01)', () => {
  it('never returns a task tagged metadata.category = always_human', () => {
    const db = makeFixtureDb()
    insertTask(db, { metadata: JSON.stringify({ category: 'always_human' }) })
    const rows = db.prepare(AEGIS_REVIEWABLE_TASKS_SQL).all()
    expect(rows).toHaveLength(0)
    db.close()
  })

  it('returns a task tagged metadata.category = default', () => {
    const db = makeFixtureDb()
    const id = insertTask(db, { metadata: JSON.stringify({ category: 'default' }) })
    const rows = db.prepare(AEGIS_REVIEWABLE_TASKS_SQL).all() as Array<{ id: number }>
    expect(rows.map(r => r.id)).toContain(id)
    db.close()
  })

  it('returns a task with metadata = NULL (fail-open for pre-Phase-3 rows)', () => {
    const db = makeFixtureDb()
    const id = insertTask(db, { metadata: null })
    const rows = db.prepare(AEGIS_REVIEWABLE_TASKS_SQL).all() as Array<{ id: number }>
    expect(rows.map(r => r.id)).toContain(id)
    db.close()
  })

  it('returns a task with valid JSON metadata but no category key', () => {
    const db = makeFixtureDb()
    const id = insertTask(db, { metadata: JSON.stringify({ intent: 'x' }) })
    const rows = db.prepare(AEGIS_REVIEWABLE_TASKS_SQL).all() as Array<{ id: number }>
    expect(rows.map(r => r.id)).toContain(id)
    db.close()
  })

  it('does not return a task with status other than review', () => {
    const db = makeFixtureDb()
    const id = insertTask(db, { status: 'in_progress', metadata: JSON.stringify({ category: 'default' }) })
    const rows = db.prepare(AEGIS_REVIEWABLE_TASKS_SQL).all() as Array<{ id: number }>
    expect(rows.map(r => r.id)).not.toContain(id)
    db.close()
  })

  it('does not return a task in an isolated workspace', () => {
    const db = makeFixtureDb()
    db.prepare(`INSERT INTO workspaces (id, isolation) VALUES (2, 'isolated')`).run()
    const id = insertTask(db, { workspace_id: 2, metadata: JSON.stringify({ category: 'default' }) })
    const rows = db.prepare(AEGIS_REVIEWABLE_TASKS_SQL).all() as Array<{ id: number }>
    expect(rows.map(r => r.id)).not.toContain(id)
    db.close()
  })

  it('is implemented with json_extract and does not reference a bare t.category column', () => {
    expect(AEGIS_REVIEWABLE_TASKS_SQL).toContain('json_extract')
    expect(AEGIS_REVIEWABLE_TASKS_SQL).not.toContain('t.category')
  })
})

describe('Aegis review dispatch model (D-03)', () => {
  it('is pinned to local/deepseek/deepseek-v4.1-flash (OpenRouter, after Ollama Cloud free-tier retirement)', () => {
    expect(AEGIS_REVIEW_DISPATCH_MODEL).toBe('local/deepseek/deepseek-v4.1-flash')
  })

  it('routes through the local direct-dispatch provider', () => {
    expect(pickProvider(AEGIS_REVIEW_DISPATCH_MODEL)).toBe('local')
  })
})

describe('recordAegisVerdictForProject (GATE-02, D-04/D-05/D-06)', () => {
  let db: Database.Database
  let projectId: number

  beforeEach(() => {
    db = makeFixtureDb()
    projectId = 1
    db.prepare(
      `INSERT INTO projects (id, workspace_id, ticket_prefix, consecutive_aegis_approvals, aegis_graduated_at)
       VALUES (?, 1, 'TST', 0, NULL)`
    ).run(projectId)
  })

  function getProjectRow() {
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as {
      consecutive_aegis_approvals: number
      aegis_graduated_at: number | null
    }
  }

  it('graduation threshold is 5', () => {
    expect(AEGIS_GRADUATION_THRESHOLD).toBe(5)
  })

  it('does not graduate on any of the first five approvals, but sets the counter and timestamp on the fifth', () => {
    for (let i = 1; i <= 4; i++) {
      const result = recordAegisVerdictForProject(db, projectId, 'approved')
      expect(result.graduated).toBe(false)
    }
    const fifth = recordAegisVerdictForProject(db, projectId, 'approved')
    expect(fifth.graduated).toBe(false)
    const row = getProjectRow()
    expect(row.consecutive_aegis_approvals).toBe(5)
    expect(row.aegis_graduated_at).not.toBeNull()
    expect(typeof row.aegis_graduated_at).toBe('number')
    db.close()
  })

  it('graduates on the sixth consecutive approval', () => {
    for (let i = 1; i <= 5; i++) recordAegisVerdictForProject(db, projectId, 'approved')
    const sixth = recordAegisVerdictForProject(db, projectId, 'approved')
    expect(sixth.graduated).toBe(true)
    expect(sixth.consecutiveApprovals).toBe(6)
    db.close()
  })

  it('a rejection before graduation resets the counter and returns graduated:false', () => {
    for (let i = 1; i <= 4; i++) recordAegisVerdictForProject(db, projectId, 'approved')
    const rejected = recordAegisVerdictForProject(db, projectId, 'rejected')
    expect(rejected.graduated).toBe(false)
    const row = getProjectRow()
    expect(row.consecutive_aegis_approvals).toBe(0)
    expect(row.aegis_graduated_at).toBeNull()
    db.close()
  })

  it('after graduation, a rejection still auto-applies (graduated:true), resets the counter, keeps the graduation timestamp', () => {
    for (let i = 1; i <= 5; i++) recordAegisVerdictForProject(db, projectId, 'approved')
    const beforeReject = getProjectRow()
    const rejected = recordAegisVerdictForProject(db, projectId, 'rejected')
    expect(rejected.graduated).toBe(true)
    const row = getProjectRow()
    expect(row.consecutive_aegis_approvals).toBe(0)
    expect(row.aegis_graduated_at).toBe(beforeReject.aegis_graduated_at)
    db.close()
  })

  it('projectId = null writes nothing and returns graduated:false, consecutiveApprovals:0', () => {
    const before = db.prepare('SELECT * FROM projects').all()
    const result = recordAegisVerdictForProject(db, null, 'approved')
    expect(result).toEqual({ graduated: false, consecutiveApprovals: 0 })
    const after = db.prepare('SELECT * FROM projects').all()
    expect(after).toEqual(before)
    db.close()
  })

  it('an unknown projectId returns graduated:false and does not throw', () => {
    expect(() => {
      const result = recordAegisVerdictForProject(db, 999999, 'approved')
      expect(result.graduated).toBe(false)
    }).not.toThrow()
    db.close()
  })
})
