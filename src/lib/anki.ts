import Database from 'better-sqlite3'
import { copyFileSync, existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export interface AnkiRecentCard {
  id: number
  addedAt: number
  front: string
  back: string
}

function resolveCollectionPath(): string {
  return process.env.ANKI_COLLECTION_PATH
    || join(homedir(), '.local', 'share', 'anki', 'English', 'collection.anki2')
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Reads the most recently added notes directly from the Anki SQLite
 * collection (read-only). Anki note ids are millisecond epoch timestamps,
 * so ordering by id also orders by creation time.
 */
export function getRecentAnkiCards(limit = 20): { cards: AnkiRecentCard[]; error?: string } {
  const sourcePath = resolveCollectionPath()
  if (!existsSync(sourcePath)) {
    return { cards: [], error: `Коллекция Anki не найдена: ${sourcePath}` }
  }

  // better-sqlite3 needs to create/probe a rollback-journal file next to the
  // database on the *first query* even in readonly mode — SQLITE_CANTOPEN
  // results if that directory is mounted read-only (as ours deliberately is,
  // see docker-compose.yml). Copy into the container's writable tmpfs first
  // so SQLite's own locking machinery has somewhere to work.
  const path = join(tmpdir(), 'mc-anki-collection.anki2')
  try {
    copyFileSync(sourcePath, path)
  } catch (err: any) {
    return { cards: [], error: err?.message || 'Не удалось скопировать коллекцию Anki во временный каталог' }
  }

  let db: Database.Database | null = null
  try {
    db = new Database(path, { readonly: true, fileMustExist: true })
    const rows = db
      .prepare('SELECT id, flds FROM notes ORDER BY id DESC LIMIT ?')
      .all(limit) as { id: number; flds: string }[]

    const cards: AnkiRecentCard[] = rows.map((row) => {
      const parts = row.flds.split('\x1f')
      const front = stripHtml(parts[0] ?? '')
      const back = stripHtml((parts[1] ?? '').split('<br>')[0] || '')
      return { id: row.id, addedAt: row.id, front, back }
    })

    return { cards }
  } catch (err: any) {
    return { cards: [], error: err?.message || 'Не удалось прочитать коллекцию Anki' }
  } finally {
    db?.close()
  }
}
