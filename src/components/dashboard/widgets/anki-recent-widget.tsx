'use client'

import { type DashboardData } from '../widget-primitives'

function formatAddedAt(ms: number): string {
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AnkiRecentWidget({ data }: { data: DashboardData }) {
  const { ankiCards, isAnkiLoading, ankiError } = data

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="text-sm font-semibold">Anki — последние слова</h3>
        {ankiCards && ankiCards.length > 0 && (
          <span className="text-2xs text-muted-foreground font-mono-tight">{ankiCards.length}</span>
        )}
      </div>
      <div className="panel-body">
        {isAnkiLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Загрузка...</p>
        ) : ankiError ? (
          <div className="text-center py-4 space-y-0.5">
            <p className="text-xs text-muted-foreground">{ankiError}</p>
            <p className="text-2xs text-muted-foreground/60">Задайте ANKI_COLLECTION_PATH в .env</p>
          </div>
        ) : !ankiCards || ankiCards.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Нет карточек</p>
        ) : (
          <div className="overflow-y-auto max-h-72">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-2xs text-muted-foreground uppercase tracking-wide text-left">
                  <th className="font-medium pb-1 pr-2">Добавлено</th>
                  <th className="font-medium pb-1 pr-2">Слово</th>
                  <th className="font-medium pb-1">Перевод</th>
                </tr>
              </thead>
              <tbody>
                {ankiCards.map((card) => (
                  <tr key={card.id} className="border-t border-border/40">
                    <td className="py-1 pr-2 text-muted-foreground font-mono-tight whitespace-nowrap">
                      {formatAddedAt(card.addedAt)}
                    </td>
                    <td className="py-1 pr-2 font-medium text-foreground/90 truncate max-w-[10rem]" title={card.front}>
                      {card.front}
                    </td>
                    <td className="py-1 text-muted-foreground truncate max-w-[10rem]" title={card.back}>
                      {card.back}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
