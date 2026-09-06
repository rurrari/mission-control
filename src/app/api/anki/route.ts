import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getRecentAnkiCards } from '@/lib/anki'
import { logger } from '@/lib/logger'

/**
 * GET /api/anki?limit=20
 * Returns the most recently added Anki notes for the "recent words" widget.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const limitParam = parseInt(searchParams.get('limit') || '20', 10)
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20

    const { cards, error } = getRecentAnkiCards(limit)
    if (error) return NextResponse.json({ error, cards: [] }, { status: 404 })

    return NextResponse.json({ cards })
  } catch (err: any) {
    logger.error({ err }, 'GET /api/anki error')
    return NextResponse.json({ error: err.message || 'Failed to fetch Anki cards' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
