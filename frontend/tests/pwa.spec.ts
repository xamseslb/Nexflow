import { test, expect } from '@playwright/test'

test('PWA installs static shell, opens offline, never caches API responses', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Åpne demonstrasjon' })).toBeVisible()
  await page.evaluate(() => fetch('/api/private-test').catch(() => null))
  const urls = await page.evaluate(async () => {
    const names = await caches.keys()
    return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(r => r.url)))).flat()
  })
  expect(urls.some(url => url.includes('/api/'))).toBeFalsy()
  expect(urls.some(url => url.endsWith('/index.html'))).toBeTruthy()
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Åpne demonstrasjon' })).toBeVisible()
  await page.getByRole('button', { name: 'Åpne demonstrasjon' }).click()
  await page.getByRole('button', { name: 'Hopp over' }).click()
  await page.getByRole('button', { name: /Fjord & Form/ }).click()
  await expect(page.getByRole('button', { name: 'Simuler samtale' })).toBeDisabled()
  await context.setOffline(false)
})
