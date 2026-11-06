import { expect, test, type Page } from '@playwright/test'

async function go(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Åpne meny' })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
}

test.beforeEach(async ({page}) => {
  await page.goto('/')
  await page.getByRole('button', {name:'Åpne demonstrasjon'}).click()
})

test('project actions, help, CSV, receipt preview and approval', async ({page}) => {
  await page.getByRole('button', {name:'Vis informasjon'}).click()
  await expect(page.getByRole('dialog')).toContainText('Ringelister')
  await page.getByRole('button', {name:'Lukk', exact:true}).click()
  await page.getByRole('button', {name:/Registrert salgsverdi/}).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', {name:'Eksporter CSV'}).click()
  expect((await download).suggestedFilename()).toBe('demo-salg.csv')
  await page.getByRole('button', {name:'Vedlegg'}).click()
  await expect(page.getByRole('dialog')).toContainText('Opplasting')
  await page.keyboard.press('Escape')
  await page.getByRole('button', {name:'Godkjenn',exact:true}).click()
  await expect(page.locator('.sale-row .badge')).toHaveText('Godkjent')
  await go(page, 'Prosjekter')
  await page.getByRole('button', {name:'Bytt til prosjekt'}).click()
  await expect(page.getByLabel('Aktivt prosjekt')).toHaveValue('demo-2')
  await page.getByRole('link', {name:/Nexflow/}).click()
  await expect(page.getByRole('heading', {name:'Oversikt',exact:true})).toBeVisible()
})

test('date filter, diagram keyboard inspection and invalid ranges', async ({page}) => {
  await go(page, 'Rapporter')
  await page.getByLabel('Fra',{exact:true}).fill('2026-10-18')
  await page.getByLabel('Til',{exact:true}).fill('2026-10-15')
  await page.getByRole('button',{name:'Vis periode'}).click()
  await expect(page.getByRole('alert')).toContainText('366')
  await page.getByLabel('Til',{exact:true}).fill('2026-10-20')
  await page.getByRole('button',{name:'Vis periode'}).click()
  const day = page.getByRole('slider',{name:'Dato i diagram'})
  await day.focus()
  await page.keyboard.press('Home')
  await expect(day).toHaveAttribute('aria-valuetext',/18\./)
  await page.keyboard.press('ArrowRight')
  await expect(day).toHaveAttribute('aria-valuetext',/19\./)
  await page.getByText('Se datagrunnlaget per dag').click()
  await expect(page.getByRole('row')).toHaveCount(4)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('tasks survive navigation, appear on customer and can be cancelled', async ({page}) => {
  await go(page,'Oppfølging')
  await page.getByRole('combobox',{name:'Lead',exact:true}).selectOption('1')
  await page.getByLabel('Oppgave',{exact:true}).fill('Send oppdatert tilbud')
  await page.getByLabel('Forfallsdato').fill('2099-11-23T11:00')
  await page.getByRole('button',{name:'Opprett oppfølging'}).click()
  await go(page,'Kunder')
  await page.locator('.customer-index').getByRole('button',{name:/Fjord & Form/}).click()
  await expect(page.getByLabel('Kundeprofil')).toContainText('Send oppdatert tilbud')
  await go(page,'Oppfølging')
  await page.getByRole('button',{name:'Avbryt',exact:true}).click()
  await page.getByLabel('Oppgavestatus').selectOption('cancelled')
  await expect(page.locator('.task-list')).toContainText('Avbrutt')
})

test('lead call opens booking, shows form error and accepts corrected date', async ({page}) => {
  await page.getByRole('button',{name:/Fjord & Form/}).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button',{name:'Simuler samtale'}).click()
  await dialog.getByRole('button',{name:'Møte',exact:true}).click()
  await expect(dialog).toContainText('Book kvalifiseringsmøte')
  await dialog.getByLabel('Tidspunkt').fill('2000-01-01T10:00')
  await dialog.getByLabel('Closer').selectOption({index:1})
  for (const label of ['Behov','Budsjett','Beslutningstaker','Tidslinje']) await dialog.getByLabel(label).fill('Avklart')
  await dialog.getByRole('button',{name:'Registrer møte'}).click()
  await expect(dialog.getByRole('alert')).toContainText('fremtidig')
  await dialog.getByLabel('Tidspunkt').fill('2099-01-01T10:00')
  await dialog.getByRole('button',{name:'Registrer møte'}).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button',{name:'Se alle møter'}).click()
  await expect(page.locator('.meeting-card')).toHaveCount(2)
})


test('meeting and sale pages start on the chosen customer, including on narrow screens', async ({page}) => {
  for (const [view, action, title] of [
    ['Møter','Book møte','Book kvalifiseringsmøte'],
    ['Salg og opptjening','Registrer salg','Registrer salg'],
  ]) {
    await go(page,view === 'Møter' ? 'Møter 1' : view)
    await page.locator('.heading-actions').getByRole('button',{name:action}).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Finn kontakt').fill('ukjent')
    await expect(dialog).toContainText('Ingen åpne leads')
    await dialog.getByLabel('Finn kontakt').fill('Emma')
    await dialog.getByRole('button',{name:/Fjord & Form/}).click()
    await expect(dialog.getByRole('heading',{name:title,exact:true})).toBeVisible()
    await expect(dialog).toContainText('Fjord & Form')
    await dialog.getByRole('button',{name:'Lukk',exact:true}).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
})

test('workspace fits small phones and tablets; open navigation stays keyboard accessible', async ({page}) => {
  test.slow() // Visits all nine workspaces at two additional viewport sizes.
  await page.setViewportSize({width:320,height:750})
  const menu = page.getByRole('button',{name:'Åpne meny'})
  await menu.click()
  await page.keyboard.press('Escape')
  await expect(menu).toBeFocused()
  for (const width of [320,768]) {
    await page.setViewportSize({width,height:800})
    for (const name of ['Ringeliste','Ringekøer','Kunder','Møter 1','Salg og opptjening','Prosjekter','Oppfølging','Rapporter','Oversikt']) {
      await go(page,name)
      const overflows = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      expect(overflows,name+' at '+width).toBeFalsy()
      const unnamed = await page.getByRole('button',{name:'',exact:true}).count()
      expect(unnamed,name+' has an unlabelled button').toBe(0)
    }
  }
})

test('an interrupted queue call can be discarded and the next search can be retried', async ({page}) => {
  await go(page,'Ringekøer')
  await page.getByRole('button',{name:'Hot',exact:true}).click()
  await page.getByRole('button',{name:'Åpne Interesserte bedrifter'}).click()
  const dialog=page.getByRole('dialog')
  await dialog.getByRole('button',{name:'Simuler oppringing'}).click()
  await dialog.getByRole('button',{name:'Tilbake til listene'}).click()
  await dialog.getByRole('button',{name:'Forkast og avslutt'}).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button',{name:'Åpne Interesserte bedrifter'}).click()
  await expect(dialog.getByRole('heading',{name:'Fjord & Form'})).toBeVisible()
  await dialog.getByRole('button',{name:'Tilbake til listene'}).click()
  await page.getByRole('button',{name:'Ny ringeliste'}).click()
  await dialog.getByLabel('Listenavn').fill('Tom testliste')
  await dialog.getByLabel('Ansvarlig selger').selectOption('demo-me')
  await dialog.getByRole('button',{name:'Opprett liste'}).click()
  await page.getByRole('button',{name:'Cold',exact:true}).click()
  await page.getByRole('button',{name:'Åpne Tom testliste'}).click()
  await dialog.getByRole('button',{name:'Sjekk på nytt'}).click()
  await expect(dialog.getByRole('heading',{name:'Ingen kontakter klare til å ringes'})).toBeVisible()
})

test('all project status rows agree with the records opened underneath', async ({page}) => {
  for (const stage of ['Nye leads','Ring tilbake','Møte booket','Solgt']) {
    const button=page.locator('.pipeline-stage').filter({hasText:stage})
    const count=Number(await button.locator('strong').textContent())
    await button.click()
    await expect(page.locator('.board-card')).toHaveCount(count)
    await go(page,'Oversikt')
  }
})
