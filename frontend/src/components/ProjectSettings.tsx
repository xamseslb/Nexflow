import { useState, type FormEvent } from 'react'
import { Pencil } from 'lucide-react'
import { request, type Project } from '@/lib/api'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

export function ProjectSettings({ project, demo, onSaved }: {
  project: Project; demo: boolean; onSaved: (value: string) => void
}) {
  const [edit, setEdit] = useState<{ expected: string; draft: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = project.project_type || ''

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!edit || busy) return
    setError(''); setBusy(true)
    try {
      const change = { project_type: edit.draft.trim(), expected: edit.expected }
      const saved = demo ? change : await request<{ project_type: string }>(`/projects/${project.id}/settings`, {
        method: 'PATCH', body: JSON.stringify(change)
      })
      onSaved(saved.project_type); setEdit(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke lagre prosjekttypen.')
    } finally { setBusy(false) }
  }
  return <div className="my-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
    <div><small className="block text-slate-600">Prosjekttype</small><strong className="text-sm">{current || 'Ikke angitt'}</strong></div>
    {['leader','admin'].includes(project.role) && <Button size="sm" variant="ghost" aria-label={'Endre prosjekttype for ' + project.name}
      onClick={() => {setError(''); setEdit({ expected: current, draft: current })}}><Pencil/>Endre</Button>}
    <Dialog open={edit !== null} onOpenChange={open => { if (!open && !busy) setEdit(null) }} title="Endre prosjekttype" description={project.name}>
      <form className="form-stack" onSubmit={save}><label>Prosjekttype<input maxLength={80} value={edit?.draft || ''} placeholder="F.eks. møtebooking"
        onChange={event => { if (edit) setEdit({ ...edit, draft: event.target.value }) }}/></label>
        {error && <p role="alert">{error}</p>}<Button disabled={busy || !edit || edit.draft.trim() === edit.expected}>Lagre prosjekttype</Button>
      </form>
    </Dialog>
  </div>
}
