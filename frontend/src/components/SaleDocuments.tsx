import { useEffect, useState } from 'react'
import { Download, Paperclip } from 'lucide-react'
import { supabase, type Project, type Sale } from '@/lib/api'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

const allowed = ['application/pdf', 'image/jpeg', 'image/png']
const bucket = 'nexflow-sale-documents'

export function SaleDocuments({ project, sale, demo }: { project: Project; sale: Sale; demo: boolean }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const folder = `${project.id}/${sale.id}`
  useEffect(() => {
    if (!open || demo || !supabase) return
    let cancelled = false
    setLoading(true); setFiles([]); setError('')
    async function list() {
      const items: string[] = []
      for (let offset = 0; !cancelled; offset += 100) {
        const { data, error } = await supabase!.storage.from(bucket).list(folder, { offset, limit: 100, sortBy: { column: 'name', order: 'asc' } })
        if (error) throw error
        items.push(...data.map(row => row.name))
        if (data.length < 100) break
      }
      if (!cancelled) setFiles(items)
    }
    list().catch(() => { if (!cancelled) setError('Kunne ikke hente dokumentene. Kontroller tilgang og Storage-oppsett.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, demo, folder, version])

  async function upload(file: File) {
    setError('')
    if (!file.size || file.size > 5 * 1024 * 1024 || !allowed.includes(file.type)) {
      setError('Velg en PDF-, JPEG- eller PNG-fil på opptil 5 MB.'); return
    }
    setBusy(true)
    try {
      const safeName = file.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-120) || 'vedlegg'
      const { error } = await supabase!.storage.from(bucket).upload(`${folder}/${crypto.randomUUID()}_${safeName}`, file,
        { contentType: file.type, cacheControl: '0', upsert: false })
      if (error) throw error
      setVersion(n => n + 1)
    } catch { setError('Opplastingen mislyktes. Kontroller tilgangen og prøv på nytt.') }
    finally { setBusy(false) }
  }
  async function download(name: string) {
    setError(''); setBusy(true)
    try {
      const { data, error } = await supabase!.storage.from(bucket).download(`${folder}/${name}`)
      if (error) throw error
      const url = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url; link.download = name.slice(37); link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setError('Kunne ikke laste ned dokumentet.') }
    finally { setBusy(false) }
  }
  return <><Button variant="outline" size="sm" onClick={() => setOpen(true)}><Paperclip size={15} />Vedlegg</Button>
    <Dialog open={open} onOpenChange={setOpen} title="Salgsdokumenter" description={demo ? 'Opplasting av kundedokumenter krever innlogging i et tilkoblet prosjekt.' : 'Kvitteringer og dokumenter for dette salget.'}>
      {!demo && <div className="form-stack">
        <label>Legg til vedlegg<input type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={busy}
          onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file) }} /></label>
        <small>PDF, JPEG eller PNG · inntil 5 MB per fil</small>
        {error && <p role="alert">{error}</p>}{loading && <p>Henter vedlegg…</p>}
        {!loading && !error && !files.length && <p>Ingen vedlegg ennå.</p>}
        {files.map(name => <Button variant="outline" key={name} disabled={busy} onClick={() => download(name)}><Download size={15} />{name.slice(37)}</Button>)}
      </div>}
    </Dialog></>
}

