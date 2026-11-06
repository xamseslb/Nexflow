import { useEffect, useState, type FormEvent } from 'react'
import { request, type Project } from '@/lib/api'
import { Button } from './ui/button'

const roles = { seller: 'Selger', booker: 'Møtebooker', closer: 'Closer', leader: 'Leder', partner: 'Partner', admin: 'Administrator' }
type Role = keyof typeof roles
type Member = { id: string; role: Role; name: string; active: boolean; team_name: string; strengths: string }

export function ProjectAccess({ projectId, admin, projects }: { projectId: string; admin: boolean; projects: Project[] }) {
  const [members, setMembers] = useState<Member[]>([])
  const [user, setUser] = useState('')
  const [role, setRole] = useState<Role>('seller')
  const [active, setActive] = useState(true)
  const [team, setTeam] = useState('')
  const [strengths, setStrengths] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [version, setVersion] = useState(0)
  const path = `/projects/${projectId}/members`
  useEffect(() => {
    let cancelled = false
    request<Member[]>(path).then(rows => { if (!cancelled) setMembers(rows) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [path, version])
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setStatus(''); setBusy(true)
    try {
      await request(`${path}/${encodeURIComponent(user.trim())}`, { method: 'PATCH', body: JSON.stringify({ role, active, team_name: team, strengths }) })
      setVersion(n => n + 1); setStatus('Prosjekttilgangen er lagret.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke lagre.') }
    finally { setBusy(false) }
  }
  const targets = projects.filter(p => p.id !== projectId && p.active && ['admin', 'leader'].includes(p.role))
  async function move(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true); setError(''); setStatus('')
    try {
      await request(`/projects/${projectId}/assignments/move`, { method: 'POST',
        body: JSON.stringify({ user_id: data.get('seller'), target_project_id: data.get('destination') }) })
      setVersion(n => n + 1); setStatus('Selgeren er flyttet. Ringelistene kan tildeles på nytt.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Flyttingen mislyktes.') }
    finally { setBusy(false) }
  }
  return <section className="panel report-panel"><h2>Prosjektteam</h2>{admin && <p>Velg et medlem, eller legg til en eksisterende Supabase-bruker med bruker-ID.</p>}
    <div className="access-members">{members.map(m => <div key={m.id}>{admin ? <Button  variant="outline" size="sm" onClick={() => { setUser(m.id); setRole(m.role); setActive(m.active); setTeam(m.team_name); setStrengths(m.strengths); setStatus('') }}>{m.name} · {roles[m.role]}{m.active ? '' : ' · Inaktiv'}</Button> : <strong>{m.name} · {roles[m.role]}</strong>}<p>{[m.team_name, m.strengths].filter(Boolean).join(' · ')}</p></div>)}</div>
    {admin && <form className="report-filters" onSubmit={save}>
      <label>Bruker-ID<input required value={user} onChange={e => setUser(e.target.value)} placeholder="UUID fra Supabase Auth" /></label>
      <label>Prosjektrolle<select value={role} onChange={e => setRole(e.target.value as Role)}>{Object.entries(roles).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>Tilgang<select value={String(active)} onChange={e => setActive(e.target.value === 'true')}><option value="true">Aktiv</option><option value="false">Deaktivert</option></select></label>
      <label>Team<input maxLength={80} value={team} onChange={e => setTeam(e.target.value)} /></label>
      <label>Faglige styrker<input maxLength={300} value={strengths} onChange={e => setStrengths(e.target.value)} placeholder="F.eks. møtebooking eller teknisk salg" /></label>
      <Button disabled={busy}>Lagre tilgang</Button>
    </form>}{error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {!!targets.length && <details><summary>Flytt en selger til et annet prosjekt</summary>
      <p>Selgeren mister tilgangen her. Eksisterende leads og ringelister blir i dette prosjektet.</p>
      <form className="report-filters" onSubmit={move}><label>Selger<select required name="seller" defaultValue=""><option value="">Velg selger</option>
        {members.filter(m => m.active && ['seller', 'booker', 'closer'].includes(m.role)).map(m => <option value={m.id} key={m.id}>{m.name}</option>)}
      </select></label><label>Nytt prosjekt<select required name="destination" defaultValue=""><option value="">Velg prosjekt</option>
        {targets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><Button disabled={busy}>Flytt selger</Button></form>
    </details>}
  </section>
}

