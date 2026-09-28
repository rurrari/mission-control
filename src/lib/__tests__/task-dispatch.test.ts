import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { insertDispatchTokenUsage, pickProvider, resolveTaskDispatchModelOverride } from '@/lib/task-dispatch'

describe('insertDispatchTokenUsage', () => {
  it('persists dispatch usage using the current token_usage schema', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE token_usage (
        model TEXT NOT NULL,
        session_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        workspace_id INTEGER NOT NULL,
        cost_usd REAL
      )
    `)

    insertDispatchTokenUsage(db, {
      model: 'test-model',
      sessionId: 'task-42',
      inputTokens: 120,
      outputTokens: 30,
      workspaceId: 7,
    }, 1_700_000_000)

    expect(db.prepare('SELECT * FROM token_usage').get()).toEqual({
      model: 'test-model',
      session_id: 'task-42',
      input_tokens: 120,
      output_tokens: 30,
      created_at: 1_700_000_000,
      workspace_id: 7,
      cost_usd: 0,
    })
    db.close()
  })
})

describe('resolveTaskDispatchModelOverride', () => {
  it('returns null when the agent has no explicit dispatch model override', () => {
    expect(resolveTaskDispatchModelOverride({ agent_config: null })).toBeNull()
    expect(resolveTaskDispatchModelOverride({ agent_config: '{"openclawId":"main"}' })).toBeNull()
  })

  it('returns the explicit dispatch model override when present', () => {
    expect(
      resolveTaskDispatchModelOverride({
        agent_config: '{"openclawId":"main","dispatchModel":"openai-codex/gpt-5.4"}',
      })
    ).toBe('openai-codex/gpt-5.4')
  })

  it('ignores malformed agent config payloads', () => {
    expect(resolveTaskDispatchModelOverride({ agent_config: '{not json' })).toBeNull()
  })
})

describe('MiniMax direct dispatch routing', () => {
  it('selects the dedicated provider for both current model IDs', () => {
    expect(pickProvider('MiniMax-M3')).toBe('minimax')
    expect(pickProvider('minimax/MiniMax-M2.7')).toBe('minimax')
  })
})

describe('Ollama direct dispatch routing (Aegis review, D-03)', () => {
  it('routes the ollama/ prefixed model to the local provider', () => {
    expect(pickProvider('ollama/kimi-k2.5:cloud')).toBe('local')
  })

  it('routes the functionally identical local/ prefix to the local provider', () => {
    expect(pickProvider('local/kimi-k2.5:cloud')).toBe('local')
  })

  // Regression guard (RESEARCH.md Pitfall 2): this intentionally asserts the WRONG
  // routing. The bare model id is uncataloged and silently falls through to Anthropic —
  // which is exactly why the `ollama/` prefix is load-bearing and must never be
  // "cleaned up" out of AEGIS_REVIEW_DISPATCH_MODEL.
  it('routes the bare uncataloged model id to anthropic, not local (Pitfall 2 guard)', () => {
    expect(pickProvider('kimi-k2.5:cloud')).toBe('anthropic')
  })
})
