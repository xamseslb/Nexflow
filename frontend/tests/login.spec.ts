import { expect, test } from '@playwright/test'

test('login is accessible, password visibility works and credentials stay local', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Logg inn' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true })
  const email = page.getByLabel('E-postadresse', { exact: true })
  const password = page.getByLabel('Passord', { exact: true })
  await email.fill('test@example.invalid')
  await password.fill('test-password')
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Vis passord', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Skjul passord', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'password')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.getByRole('button', { name: 'Åpne demonstrasjon' }).click()
  await expect(page.getByRole('heading', { name: 'Oversikt' })).toBeVisible()
  await page.getByRole('button', { name: 'Avslutt demo' }).click()
  await expect(page.getByRole('heading', { name: 'Logg inn' })).toBeVisible()
  await expect(email).toHaveValue('')
  await expect(password).toHaveValue('')
})

test('all workspace pages remain usable across navigation', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Åpne demonstrasjon' }).click()
  for (const name of ['Møter', 'Salg og opptjening', 'Prosjekter', 'Ringeliste', 'Oversikt']) {
    const menu = page.getByRole('button', { name: 'Åpne meny' })
    if (await menu.isVisible()) await menu.click()
    await page.locator('nav').getByRole('button', { name: new RegExp(name) }).click()
    await expect(page.locator('nav [aria-current="page"]')).toContainText(name)
    await expect(page.locator('main h1')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  }
})
