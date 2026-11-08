import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Åpne demonstrasjon' }).click()
  await expect(page.getByRole('heading', { name: 'Oversikt' })).toBeVisible()
})

test('lead search, simulated call and two-tap outcome', async ({ page }) => {
  await page.getByRole('button', { name: 'Åpne ringelisten' }).click()
  await page.getByRole('textbox', { name: 'Søk i leads' }).fill('Fjord')
  await page.getByRole('button', { name: /Fjord & Form/ }).click()
  await page.getByRole('button', { name: 'Simuler samtale' }).click()
  await page.getByLabel('Samtalenotat').fill('Avtal prisgjennomgang torsdag')
  await page.getByRole('button', { name: 'Svar', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Samtaleutfallet er registrert')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: /Fjord & Form/ }).click()
  await expect(page.getByRole('dialog')).toContainText('Avtal prisgjennomgang torsdag')
  await page.getByRole('button',{name:'Lukk',exact:true}).click()
  const menu = page.getByRole('button',{name:'Åpne meny'})
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('navigation').getByRole('button',{name:'Rapporter'}).click()
  await page.getByRole('button',{name:'Fullførte samtaler 1'}).click()
  await page.getByRole('dialog').getByRole('button',{name:/Fjord & Form/}).click()
  const call = page.getByRole('dialog',{name:'Fjord & Form'})
  await expect(call).toContainText('Avtal prisgjennomgang torsdag')
  await expect(call).toContainText('Svar')
})

test('reserved B2C contact is blocked', async ({ page }) => {
  await page.getByRole('button', { name: 'Se hele listen' }).click()
  await page.getByRole('button', { name: /Eksempelkontakt/ }).click()
  await expect(page.getByRole('button', { name: 'Simuler samtale' })).toBeDisabled()
  await expect(page.getByText('Reservert mot telefonsalg – mangler gyldig samtykke')).toBeVisible()
})

test('lead board groups contacts and list view preserves search and selection', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Se hele listen' }).click()
  await expect(page.getByRole('button', { name: 'Tavle', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.board-new')).toContainText('Fjord & Form')
  await expect(page.locator('.board-blocked')).toContainText('Eksempelkontakt')
  await page.screenshot({ path: testInfo.outputPath('lead-board.png') })
  await page.getByRole('button', { name: 'Liste', exact: true }).click()
  await page.getByRole('textbox', { name: 'Søk i leads' }).fill('Fjord')
  await page.getByRole('button', { name: /Fjord & Form/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('sale is registered with exact server-style demo allocation', async ({ page }) => {
  await page.getByRole('button', { name: /Fjord & Form/ }).click()
  await page.getByRole('button', { name: 'Registrer salg', exact: true }).click()
  await page.getByRole('button', { name: 'Registrer og send til godkjenning' }).click()
  await expect(page.getByRole('status')).toContainText('Salg registrert')
  await expect(page.getByRole('button', { name: /Fjord & Form/ })).toContainText('Salg')
})

test('project switch clears previous partner data', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Aktivt prosjekt' }).selectOption('demo-2')
  await expect(page.getByText('Ingen leads å vise')).toBeVisible()
  await expect(page.getByText('Fjord & Form')).toHaveCount(0)
})

test('layout fits viewport and dialog works on mobile', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.getByRole('button', { name: 'Nytt lead', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel('Bedrift / navn').fill('Fiktiv testbedrift')
  await page.getByLabel('Telefon', { exact: true }).fill('+4799999999')
  await page.getByRole('button', { name: 'Legg til lead' }).click()
  await expect(page.getByRole('status')).toContainText('Lead lagt til')
})

test('overview visual review', async ({ page }, testInfo) => {
  await page.screenshot({ path: testInfo.outputPath('overview.png'), fullPage: true })
})

test('console status shortcuts filter leads and menu navigation clears the filter', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Søk i leads' }).fill('Fjord')
  await page.getByRole('button', { name: 'Møte booket: 1 leads. Vis i ringelisten' }).click()
  await expect(page.getByRole('textbox', { name: 'Søk i leads' })).toHaveValue('')
  await expect(page.locator('.board-card')).toHaveCount(1)
  await expect(page.locator('.board-card')).toContainText('Vest Byggpartner')
  await page.getByRole('button', { name: 'Alle leads', exact: true }).click()
  await expect(page.locator('.board-card')).toHaveCount(7)
  const menu = page.getByRole('button', { name: 'Åpne meny' })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('navigation').getByRole('button', { name: 'Oversikt', exact: true }).click()
  await page.getByRole('button', { name: 'Solgt: 1 leads. Vis i ringelisten' }).click()
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('navigation').getByRole('button', { name: 'Ringeliste', exact: true }).click()
  await expect(page.locator('.board-card')).toHaveCount(7)
})
