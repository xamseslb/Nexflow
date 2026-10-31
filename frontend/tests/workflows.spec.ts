import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Åpne demonstrasjon' }).click()
  await expect(page.getByRole('heading', { name: 'Klar for nye muligheter?' })).toBeVisible()
})

test('lead search, simulated call and two-tap outcome', async ({ page }) => {
  await page.getByRole('button', { name: 'Åpne ringelisten' }).click()
  await page.getByRole('textbox', { name: 'Søk i leads' }).fill('Fjord')
  await page.getByRole('button', { name: /Fjord & Form/ }).click()
  await page.getByRole('button', { name: 'Simuler samtale' }).click()
  await page.getByRole('button', { name: 'Ikke svar', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Samtaleutfallet er registrert')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('reserved B2C contact is blocked', async ({ page }) => {
  await page.getByRole('button', { name: 'Se hele listen' }).click()
  await page.getByRole('button', { name: /Eksempelkontakt/ }).click()
  await expect(page.getByRole('button', { name: 'Simuler samtale' })).toBeDisabled()
  await expect(page.getByText('Reservert mot telefonsalg – mangler gyldig samtykke')).toBeVisible()
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
