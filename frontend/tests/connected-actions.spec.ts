import { expect, test, type Page } from '@playwright/test'

// Intercept only the dedicated e2e identity provider and local API.
// Run the actual login, forms, downloads and Storage client without customer accounts.
async function setup(page: Page, role = 'admin') {
  const id = '00000000-0000-4000-8000-000000000001'
  const seller = '00000000-0000-4000-8000-000000000002'
  const user = { id, email:'tester@example.invalid', aud:'authenticated', role:'authenticated', app_metadata:{}, user_metadata:{}, identities:[], created_at:new Date().toISOString() }
  const exp = Math.floor(Date.now()/1000)+3600
  const jwt = ['{"alg":"HS256","typ":"JWT"}', JSON.stringify({sub:id, aud:'authenticated', role:'authenticated', exp}), 'signature'].map(v => Buffer.from(v).toString('base64url')).join('.')
  let savedTeam = 'Nord'
  let object = ''
  let moved = false
  let refreshes = 0
  const unhandled: string[] = []
  await page.route('https://nexflow-e2e.invalid/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    if (path === '/auth/v1/token') {
      if (req.postDataJSON().password !== 'test-only-password') return route.fulfill({status:400,json:{error_code:'invalid_credentials',msg:'Invalid login credentials'}})
      return route.fulfill({json:{user, access_token:jwt, refresh_token:'test-refresh', token_type:'bearer', expires_in:3600, expires_at:exp}})
    }
    if (path === '/auth/v1/user') return route.fulfill({json:user})
    if (path === '/auth/v1/logout') return route.fulfill({status:204})
    if (path.includes('/object/list/')) return route.fulfill({json:object ? [{name:object}] : []})
    if (path.includes('/object/') && req.method()==='POST') {
      object = decodeURIComponent(path.split('/').pop()!)
      return route.fulfill({json:{Key:object}})
    }
    if (path.includes('/object/') && req.method()==='GET') return route.fulfill({contentType:'application/pdf',body:'%PDF-1.4 e2e'})
    unhandled.push(path); return route.fulfill({status:404})
  })
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api/v1','')
    if (req.headers().authorization !== 'Bearer '+jwt) return route.fulfill({status:401})
    if (path==='/projects') return route.fulfill({json:['one','two'].map((n,i) => ({id:n,name:i?'Prosjekt Sør':'Prosjekt Nord',role,active:true,kind:'b2b',project_type:'Direktesalg',partner_id:n,description:''}))})
    if (path.endsWith('/members/'+seller)) {
      savedTeam = req.postDataJSON().team_name; return route.fulfill({json:{id:seller,active:true,role:'seller'}})
    }
    if (path.endsWith('/assignments/move')) {
      moved = req.postDataJSON().user_id===seller && req.postDataJSON().target_project_id==='two'
      return route.fulfill({json:{moved}})
    }
    if (path.endsWith('/members')) return route.fulfill({json:[{id:seller,name:'Alex Test',role:'seller',team_name:savedTeam,strengths:'',active:!moved}]})
    if (path.endsWith('/leads')) {refreshes++; return route.fulfill({json:[]})}
    if (path.endsWith('/products') || path.endsWith('/meetings')) return route.fulfill({json:[]})
    if (path.endsWith('/sales')) return route.fulfill({json:[{id:'s1',lead_id:'l1',amount_ore:10000,allocation:{seller:1000,hub:2000,partner:7000},status:'approved',created_at:new Date().toISOString(),can_manage_documents:role==='admin'}]})
    unhandled.push(path); return route.fulfill({status:404})
  })
  await page.goto('/')
  return { unhandled, moved:()=>moved, refreshes:()=>refreshes }
}

async function login(page: Page, password: string) {
  await page.getByLabel('E-postadresse').fill('tester@example.invalid')
  await page.getByLabel('Passord',{exact:true}).fill(password)
  await page.getByRole('button',{name:'Logg inn',exact:true}).click()
}
async function go(page: Page, name: string) {
  const menu = page.getByRole('button',{name:'Åpne meny'})
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('navigation').getByRole('button',{name,exact:true}).click()
}

test('signed-in admin can retry login, refresh, update access, move seller and transfer a receipt', async ({page}) => {
  const service = await setup(page)
  await login(page,'wrong-password')
  await expect(page.getByRole('alert')).toContainText('passordet')
  await login(page,'test-only-password')
  await expect(page.getByLabel('Aktivt prosjekt')).toHaveValue('one')
  const count = service.refreshes()
  await page.getByRole('button',{name:'Oppdater prosjekt'}).click()
  await expect.poll(service.refreshes).toBeGreaterThan(count)
  await go(page,'Prosjekter')
  await page.getByRole('button',{name:/Alex Test/}).click()
  await page.getByLabel('Team',{exact:true}).fill('Vest')
  await page.getByRole('button',{name:'Lagre tilgang'}).click()
  await expect(page.locator('.access-members')).toContainText('Vest')
  await page.getByText('Flytt en selger til et annet prosjekt',{exact:true}).click()
  await page.getByRole('combobox',{name:'Selger',exact:true}).selectOption({label:'Alex Test'})
  await page.getByLabel('Nytt prosjekt').selectOption('two')
  await page.getByRole('button',{name:'Flytt selger',exact:true}).click()
  await expect.poll(service.moved).toBeTruthy()
  await go(page,'Salg og opptjening')
  await page.getByRole('button',{name:'Vedlegg'}).click()
  const file = page.getByLabel('Legg til vedlegg')
  await file.setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('test')})
  await expect(page.getByRole('alert')).toContainText('PDF')
  await file.setInputFiles({name:'kvittering.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 e2e')})
  const download = page.waitForEvent('download')
  await page.getByRole('button',{name:'kvittering.pdf'}).click()
  expect((await download).suggestedFilename()).toBe('kvittering.pdf')
  await page.getByRole('button',{name:'Lukk',exact:true}).click()
  await page.getByRole('button',{name:'Logg ut'}).click()
  await expect(page.getByRole('heading',{name:'Logg inn'})).toBeVisible()
  expect(service.unhandled).toEqual([])
})

test('partner has read-only sale view and no document or administrative actions', async ({page}) => {
  const service = await setup(page,'partner')
  // A completed demo guide must not suppress this account's first visit.
  await page.evaluate(() => localStorage.removeItem('nexflow:tour:v2:00000000-0000-4000-8000-000000000001'))
  await login(page,'test-only-password')
  const tour = page.getByRole('dialog', { name: 'Omvisning i Nexflow' })
  await expect(tour).toBeVisible()
  const headings = []
  while (true) {
    headings.push(await tour.getByRole('heading').innerText())
    if (await tour.getByRole('button', { name: 'Videre til Ringeliste' }).isVisible()) break
    expect(headings.length).toBeLessThan(16)
    await tour.getByRole('button', { name: 'Neste' }).click()
  }
  expect(headings).not.toContain('Legg til en kontakt')
  await tour.getByRole('button', { name: 'Hopp over' }).click()
  await expect(tour).toHaveCount(0)
  await go(page,'Salg og opptjening')
  await expect(page.getByRole('button',{name:'Vedlegg'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Godkjenn'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Eksporter CSV'})).toBeDisabled()
  await go(page,'Prosjekter')
  await expect(page.getByRole('button',{name:'Lagre tilgang'})).toHaveCount(0)
  expect(service.unhandled).toEqual([])
})


test('signed-in portfolio sends the selected team on every detail page and retries failed reads', async ({ page }) => {
  await setup(page)
  let attempts = 0
  await page.route('**/portfolio/sales?**', async route => {
    const params = new URL(route.request().url()).searchParams
    if (!params.has('metric')) return route.fulfill({ json: { count: 0, total_ore: 0, items: [], teams: ['Nord'],
      project_types: [], activity: { leads: 26, meetings: 0, calls: 0, buyers: 0 } } })
    expect(params.get('team')).toBe('Nord')
    expect(params.has('kind')).toBe(false)
    expect(params.get('metric')).toBe('leads')
    if (++attempts === 1) return route.fulfill({ status: 503, json: { detail: 'Midlertidig utilgjengelig' } })
    const next = params.get('offset') === '25'
    return route.fulfill({ json: { items: [{ id: next ? '26' : '1', company: next ? 'Siste bedrift' : 'Første bedrift', project: 'Prosjekt Nord' }], has_more: !next } })
  })
  await login(page, 'test-only-password')
  await go(page, 'Rapporter')
  const portfolio = page.getByRole('region', { name: 'Lederoversikt' })
  await portfolio.getByLabel('Team', { exact:true }).selectOption('Nord')
  await portfolio.getByRole('button', { name:'Leads 26' }).click()
  const dialog = page.getByRole('dialog', { name:'Leads' })
  await expect(dialog.getByRole('alert')).toContainText('Midlertidig utilgjengelig')
  await dialog.getByRole('button', { name:'Prøv igjen' }).click()
  await expect(dialog).toContainText('Første bedrift')
  await dialog.getByRole('button', { name:'Neste' }).click()
  await expect(dialog).toContainText('Siste bedrift')
  await dialog.getByRole('button', { name:'Forrige' }).click()
  await expect(dialog).toContainText('Første bedrift')
})

test('a manager opens an off-page customer in the correct project and returns to the original report', async ({ page }) => {
  await setup(page)
  const lead = { id:'specific',project_id:'two',company:'Havblikk Studio',contact:'Riktig kontakt',phone:'',kind:'b2b',
    status:'new',priority:0,industry:'Foto',city:'Bergen',summary:'',blocked:false,enrichment:{} }
  await page.route('**/portfolio/sales?**', route => {
    const params = new URL(route.request().url()).searchParams
    return route.fulfill({json:params.has('metric') ? {items:[{id:lead.id,lead_id:lead.id,project_id:'two',
      project:'Prosjekt Sør',company:lead.company,detail:lead.contact}],has_more:false} :
      {items:[],teams:['Vest'],project_types:[],count:0,total_ore:0,activity:{leads:1,calls:0,meetings:0,buyers:0}}})
  })
  await page.route('**/projects/two/customers?**', route => route.fulfill({json:{items:[],has_more:false}}))
  await page.route('**/projects/two/customers/specific', route => route.fulfill({json:{lead,step:1,org_number:null,calls:[],tasks:[],meetings:[],sales:[]}}))
  await login(page,'test-only-password')
  await go(page,'Rapporter')
  await page.getByLabel('Team',{exact:true}).selectOption('Vest')
  await page.getByRole('button',{name:'Leads 1',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:/Havblikk Studio/}).click()
  await expect(page.getByLabel('Aktivt prosjekt')).toHaveValue('two')
  await expect(page.getByRole('region',{name:'Kundeprofil'})).toContainText('Riktig kontakt')
  await page.getByRole('button',{name:/Tilbake til rapporten/}).click()
  await expect(page.getByRole('dialog',{name:'Leads'})).toContainText('Havblikk Studio')
  await page.getByRole('button',{name:'Lukk',exact:true}).click()
  await expect(page.getByLabel('Team',{exact:true})).toHaveValue('Vest')
  await expect(page.getByLabel('Aktivt prosjekt')).toHaveValue('one')
})
