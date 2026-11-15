import { cn } from '@/lib/utils'

export const labels: Record<string, string> = {
  new: 'Ny',
  callback: 'Ring tilbake',
  meeting: 'Møte booket',
  sold: 'Salg',
  declined: 'Ikke aktuell',
  blocked: 'Sperret',
  review: 'Må gjennomgås',
  registered: 'Til godkjenning',
  approved: 'Godkjent',
  awaiting_confirmation: 'Venter på bekreftelse',
}

export function Badge({ status }: { status: string }) {
  return <span className={cn('badge', `badge-${status}`)}>{labels[status] || status}</span>
}
