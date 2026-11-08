import { useState } from 'react'
import { Download, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { request, type Meeting } from '@/lib/api'

const outcomes: Record<string, string> = {
  booked: 'Booket', cancelled: 'Avlyst', qualified: 'Kvalifisert', not_qualified: 'Ikke kvalifisert',
  no_show: 'Ikke møtt', offer_sent: 'Tilbud sendt', sold: 'Salg'
}
export const meetingOutcomeLabel = (outcome: string) => outcomes[outcome] || outcome

// RFC 5545 content lines fold at 75 UTF-8 octets, including the continuation space.
function foldLine(value: string) {
  const encoder = new TextEncoder()
  let output = ''
  let size = 0
  for (const character of value) {
    const length = encoder.encode(character).length
    if (size + length > 75) { output += '\r\n '; size = 1 }
    output += character
    size += length
  }
  return output
}

function calendarText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[,;]/g, '\\$&').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

const timestamp = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

function downloadCalendar(meeting: Meeting, company: string) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nexflow//CRM//NB', 'BEGIN:VEVENT',
    `UID:${meeting.id}@nexflow`, `DTSTAMP:${timestamp(new Date().toISOString())}`,
    `DTSTART:${timestamp(meeting.starts_at)}`, `DTEND:${timestamp(meeting.ends_at)}`,
    `SUMMARY:${calendarText('Kvalifiseringsmøte · ' + company)}`,
    `STATUS:${meeting.outcome === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR']
  const url = URL.createObjectURL(new Blob([lines.map(foldLine).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = `mote-${meeting.id}.ics`; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function MeetingActions({ meeting, projectId, company, demo, sold, role, onChange }: {
  meeting: Meeting & { can_record_outcome?: boolean }; projectId: string; company: string
  demo: boolean; sold?: boolean; role: string; onChange: (outcome: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mayRecord = ['closer','leader','admin'].includes(role) && (demo || meeting.can_record_outcome)
  async function submit() {
    if (!result || busy) return
    setError(''); setBusy(true)
    try {
      if (demo && result === 'sold' && !sold) throw new Error('Registrer salget på leadkortet først.')
      if (!demo) await request(`/projects/${projectId}/meetings/${meeting.id}/outcome`, {
        method: 'PATCH', body: JSON.stringify({ outcome: result })
      })
      onChange(result); setOpen(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke registrere møteutfallet.') }
    finally { setBusy(false) }
  }
  return <div className="mt-4 flex flex-wrap gap-2">
    <Button data-tour="calendar" size="sm" variant="outline" onClick={() => downloadCalendar(meeting, company)}><Download/>Last ned kalenderfil</Button>
    {mayRecord && meeting.outcome === 'booked' && <Button size="sm" variant="outline" onClick={() => { setError(''); setOpen(true) }}>Registrer møteutfall</Button>}
    <Dialog open={open} onOpenChange={value => {if (!busy) setOpen(value)}} title="Registrer møteutfall" description={company}>
      {new Date(meeting.ends_at).getTime() > Date.now() ? <p>Møteutfallet kan registreres etter møtets slutt.</p> :
        <form className="form-stack" onSubmit={event => {event.preventDefault(); void submit()}}>
          <label>Møteutfall<select value={result} required onChange={event => setResult(event.target.value)}>
            <option value="">Velg utfall</option>{['qualified','not_qualified','no_show','offer_sent','sold'].map(id => <option key={id} value={id}>{outcomes[id]}</option>)}
          </select></label>
          {error && <p role="alert">{error}</p>}<Button disabled={busy || !result}><Check/>Lagre møteutfall</Button>
        </form>}
    </Dialog>
  </div>
}
