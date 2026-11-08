import { expect, test } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test('complete walkthrough follows the actual workspace menu from overview to reports', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Åpne demonstrasjon' }).click()
  const tour = page.getByRole('dialog', { name: 'Omvisning i Nexflow' })
  const pages = [
    ['Oversikt', 'Les leadstatusen'], ['Ringeliste', 'Bytt mellom tavle og liste'],
    ['Ringekøer', 'Velg type ringekø'], ['Kunder', 'Se et ekte bedriftsoppslag'],
    ['Møter', 'Book et møte'], ['Salg og opptjening', 'Registrer et salg'],
    ['Prosjekter', 'Les prosjektkortet'], ['Oppfølging', 'Sett fristen'],
    ['Rapporter', 'Se utviklingen over tid'],
  ]
  async function chooseDestination(name: string) {
    const hint = page.getByRole('complementary', { name: 'Neste side i omvisningen' })
    await expect(hint).toBeVisible()
    const menu = page.getByRole('button', { name: 'Åpne meny' })
    if (await menu.isVisible()) await menu.click()
    await expect(hint).toContainText('Trykk på «' + name + '»')
    await page.locator('.nav-item.tour-destination').click()
    await expect(tour).toBeVisible()
  }
  for (const [i, [name, required]] of pages.entries()) {
    await expect(tour.locator('header')).toContainText('Side ' + (i + 1) + ' av 9 · ' + name)
    const titles = []
    while (true) {
      titles.push(await tour.locator('h2').innerText())
      const next = tour.getByRole('button', { name: 'Neste', exact: true })
      if (!(await next.isVisible())) break
      expect(titles.length).toBeLessThan(16)
      await next.click()
    }
    expect(titles).toContain(required)
    if (i + 1 < pages.length) {
      const destination = pages[i + 1][0]
      await tour.getByRole('button', { name: 'Videre til ' + destination }).click()
      await chooseDestination(destination)
    } else {
      await tour.getByRole('button', { name: 'Fullfør' }).click()
    }
  }
  await expect(tour).toHaveCount(0)
  await page.getByRole('button', { name: 'Vis informasjon' }).click()
  await page.getByRole('button', { name: 'Start hele omvisningen' }).click()
  await chooseDestination('Oversikt')
  await expect(tour.getByRole('heading', { name: 'Velg arbeidsprosjekt' })).toBeVisible()
  await tour.getByRole('button', { name: 'Hopp over' }).click()
})

test('first visit, skip, return and replay the guide for the current page', async ({ page }) => {
  await page.goto('/')
  const enterDemo = page.getByRole('button', { name: 'Åpne demonstrasjon' })
  await enterDemo.click()
  const tour = page.getByRole('dialog', { name: 'Omvisning i Nexflow' })
  await expect(tour.getByRole('heading', { name: 'Velg arbeidsprosjekt' })).toBeVisible()
  await tour.getByRole('button', { name: 'Neste' }).click()
  await expect(tour.getByRole('heading', { name: 'Finn fram i Nexflow' })).toBeVisible()
  await tour.getByRole('button', { name: 'Forrige' }).click()
  await expect(tour.getByText(/Steg 1 av/)).toBeVisible()
  await tour.getByRole('button', { name: 'Hopp over' }).click()
  await expect(tour).toHaveCount(0)

  await page.reload()
  await enterDemo.click()
  await expect(page.getByRole('heading', { name: 'Oversikt', exact: true })).toBeVisible()
  await expect(tour).toHaveCount(0)
  const menu = page.getByRole('button', { name: 'Åpne meny' })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('navigation').getByRole('button', { name: 'Ringeliste', exact: true }).click()
  const help = page.getByRole('button', { name: 'Vis informasjon' })
  await help.click()
  await page.getByRole('button', { name: 'Vis omvisning på denne siden' }).click()
  await expect(tour).toBeVisible()
  const titles: string[] = []
  while (true) {
    titles.push(await tour.getByRole('heading').innerText())
    const panel = await tour.locator('article').boundingBox()
    const marker = await tour.locator('.tour-ring').boundingBox()
    const size = page.viewportSize()!
    expect(panel!.x).toBeGreaterThanOrEqual(0)
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(size.height)
    expect(marker!.width).toBeGreaterThan(0)
    if (await tour.getByRole('button', { name: 'Fullfør' }).isVisible()) break
    expect(titles.length).toBeLessThan(12)
    await tour.getByRole('button', { name: 'Neste' }).click()
  }
  expect(titles).toContain('Bytt mellom tavle og liste')
  expect(titles).toContain('Åpne leadkortet')
  await tour.getByRole('button', { name: 'Fullfør' }).click()
  await expect(tour).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Ringeliste', exact: true })).toBeVisible()
  await help.click()
  await page.getByRole('button', { name: 'Vis omvisning på denne siden' }).click()
  await expect(tour).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tour).toHaveCount(0)
})
