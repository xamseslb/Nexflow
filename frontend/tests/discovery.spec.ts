import { expect, test } from '@playwright/test'

test('company discovery saves industries, pauses, reviews and links to the queue', async ({page}, testInfo) => {
  const id='00000000-0000-4000-8000-000000000001'
  const user={id,email:'tester@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}
  const exp=Math.floor(Date.now()/1000)+3600
  const jwt=['{"alg":"HS256"}',JSON.stringify({sub:id,exp}),'test'].map(s=>Buffer.from(s).toString('base64url')).join('.')
  let settings={enabled:false,industries:[] as string[],call_list_id:'cold',area:'Oslo',daily_limit:20,imported_today:2,last_run_at:null,next_run_at:null,last_error:null,last_summary:{}}
  let reviewStatus='review'
  let failReview=true
  const bodies: unknown[]=[]
  const queries:string[]=[]
  await page.route('https://nexflow-e2e.invalid/**', route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/user') ? user : {user,access_token:jwt,refresh_token:'test',token_type:'bearer',expires_in:3600,expires_at:exp}}))
  await page.route('**/api/v1/**', async route=>{
    const req=route.request(), url=new URL(req.url()), path=url.pathname.replace('/api/v1','')
    if(path==='/projects') return route.fulfill({json:[{id:'pilot',name:'Pilot – bedrifter',role:'admin',active:true,kind:'b2b',project_type:'Direktesalg',partner_id:'partner',description:''}]})
    if(path.endsWith('/discovery/records/record/review')) {
      bodies.push(req.postDataJSON())
      if(failReview){failReview=false;return route.fulfill({status:422,json:{detail:'Kontroller bedriftsnummeret'}})}
      reviewStatus='imported';return route.fulfill({json:{status:reviewStatus,lead_id:'lead'}})
    }
    if(path.endsWith('/discovery/records')) {
      queries.push(url.search)
      return route.fulfill({json:{items:[{id:'record',company:'Oslo Test AS',org_number:'987654321',status:reviewStatus,reason:'Mangler telefon',lead_id:'lead',source_url:'https://data.brreg.no/enhetsregisteret/api/enheter/987654321',created_at:'2026-11-12T12:00:00Z'}],has_more:url.searchParams.get('page')==='0'}})
    }
    if(path.endsWith('/discovery')) {
      if(req.method()==='PATCH') {settings={...settings,...req.postDataJSON()};bodies.push(req.postDataJSON());return route.fulfill({json:settings})}
      return route.fulfill({json:{settings,catalog:[{code:'62',name:'Dataprogrammering'},{code:'43',name:'Bygg og anlegg'}],catalog_as_of:'2026-11-12'}})
    }
    if(path.endsWith('/call-lists')) return route.fulfill({json:[{id:'cold',name:'Cold – Bedriftssøk',category:'cold',total:1,remaining:1,completed:0}]})
    return route.fulfill({json:[]})
  })
  await page.goto('/')
  await page.getByLabel('E-postadresse').fill('tester@example.invalid')
  await page.getByLabel('Passord',{exact:true}).fill('test-password')
  await page.getByRole('button',{name:'Logg inn',exact:true}).click()
  const menu=page.getByRole('button',{name:'Åpne meny'})
  if(await menu.isVisible()) await menu.click()
  await page.getByRole('navigation').getByRole('button',{name:'Finn bedrifter',exact:true}).click()
  await page.getByLabel('Automatisk søk hver time').check()
  await page.getByLabel('Søk etter bransje').fill('data')
  await page.getByRole('checkbox',{name:/Dataprogrammering/}).check()
  await page.getByRole('button',{name:'Lagre og aktiver'}).click()
  await expect.poll(()=>settings.industries).toEqual(['62'])
  await expect(page.getByRole('status')).toContainText('neste timekjøring')
  await page.getByRole('button',{name:'Hent status på nytt'}).click()
  await expect(page.getByRole('checkbox',{name:/Dataprogrammering/})).toBeChecked()
  await page.getByLabel('Automatisk søk hver time').uncheck()
  await page.getByRole('button',{name:'Lagre innstillinger'}).click()
  await expect.poll(()=>settings.enabled).toBe(false)
  await page.getByLabel('Vis treff').selectOption('review')
  await expect.poll(()=>queries.at(-1)).toContain('status=review')
  await page.getByRole('button',{name:'Neste',exact:true}).click()
  await expect.poll(()=>queries.at(-1)).toContain('page=1')
  await page.getByRole('button',{name:'Forrige',exact:true}).click()
  await page.getByRole('button',{name:'Gjennomgå',exact:true}).click()
  const dialog=page.getByRole('dialog')
  await dialog.getByLabel('Bedriftens telefonnummer').fill('22 00 00 00')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button',{name:'Godkjenn og legg i Cold'}).click()
  await expect(dialog.getByRole('alert')).toContainText('Kontroller bedriftsnummeret')
  await dialog.getByRole('button',{name:'Godkjenn og legg i Cold'}).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.discovery-status')).toHaveText('I Cold-kø')
  expect(bodies.at(-1)).toEqual({decision:'approve',phone:'22 00 00 00',confirmed_business_number:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('company-discovery.png'),fullPage:true})
  await page.getByRole('button',{name:'Åpne ringekøer'}).click()
  await expect(page.getByRole('heading',{name:'Ringekøer',exact:true})).toBeVisible()
})
