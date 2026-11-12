export type WebsitePhone = {phone: string; source_url: string}

export function WebsitePhones({phones, status, checked, onChoose}: {
  phones?: WebsitePhone[] | null; status?: string | null; checked?: string | null; onChoose?: (phone: string) => void
}) {
  const items = (Array.isArray(phones) ? phones : []).filter(p=> {
    try {const url=new URL(p.source_url);return /^\+47[2-9]\d{7}$/.test(p.phone) && url.protocol==='https:' && !url.username && !url.password} catch {return false}
  })
  if (!status && !items.length) return null
  const stamp=checked && Number.isFinite(Date.parse(checked)) ? new Date(checked).toLocaleDateString('nb-NO') : ''
  return <section aria-label="Telefon fra nettsiden">
    <h4>Telefon fra nettsiden</h4>
    {items.length ? <>
      <p>Forslag fra bedriftens nettside. Kontroller kilden før nummeret tas i bruk.</p>
      <ul>{items.map(p=><li key={p.phone}>
        <strong>{p.phone}</strong>{' · '}<a href={p.source_url} target="_blank" rel="noopener noreferrer">Se kilde</a>
        {onChoose && <button type="button" className="website-phone-choice" onClick={()=>onChoose(p.phone)}>Bruk {p.phone}</button>}
      </li>)}</ul>
    </> : <p>{status==='missing_website' ? 'Ingen nettside registrert. Telefonnummer må kontrolleres manuelt.' : status==='not_found' ? 'Fant ikke et tydelig telefonnummer på sidene som ble undersøkt.' : 'Nettsiden kunne ikke undersøkes fullstendig. Nummeret må kontrolleres manuelt.'}</p>}
    {status==='temporary_error' && items.length>0 && <p>Kilden svarte ikke ved siste forsøk. Viser tidligere treff.</p>}
    {stamp && <small>Sist kontrollert {stamp}</small>}
  </section>
}
