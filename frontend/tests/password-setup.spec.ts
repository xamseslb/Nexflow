import { expect, test } from '@playwright/test'

test('password reset sends the exact site redirect without revealing account existence', async ({ page }) => {
  let sent = false
  await page.route('https://nexflow-e2e.invalid/auth/v1/recover**', route => {
    expect(route.request().postDataJSON().email).toBe('tester@example.invalid')
    expect(new URL(route.request().url()).searchParams.get('redirect_to')).toBe('http://127.0.0.1:5187/?auth=password')
    sent = true
    return route.fulfill({ json: {} })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Glemt passord?' }).click()
  await page.getByLabel('E-postadresse').fill('tester@example.invalid')
  await page.getByRole('button', { name: 'Send passordlenke' }).click()
  await expect(page.getByRole('status')).toContainText('Hvis adressen har en konto')
  expect(sent).toBe(true)
  await page.getByRole('button', { name: 'Tilbake til innlogging' }).click()
  await expect(page.getByRole('heading', { name: 'Logg inn' })).toBeVisible()
})

test('an expired password link does not expose a password form', async ({ page }) => {
  await page.goto('/?auth=password#error=access_denied&error_code=otp_expired')
  await expect(page.getByRole('alert')).toContainText('utløpt eller ugyldig')
  await expect(page.getByLabel('Nytt passord', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Til innlogging' }).click()
  await expect(page.getByRole('heading', { name: 'Logg inn' })).toBeVisible()
  expect(page.url()).not.toContain('auth=password')
})

test('an invitation opens password setup, validates confirmation and updates the authenticated account', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000001'
  const user = { id, email: 'tester@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, identities: [], created_at: new Date().toISOString() }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = ['{"alg":"HS256","typ":"JWT"}', JSON.stringify({ sub: id, aud: 'authenticated', role: 'authenticated', exp }), 'fake-signature'].map(v => Buffer.from(v).toString('base64url')).join('.')
  let updates = 0
  await page.route('https://nexflow-e2e.invalid/auth/v1/user', route => {
    if (route.request().method() === 'PUT') {
      expect(route.request().headers().authorization).toBe('Bearer ' + token)
      expect(route.request().postDataJSON().password).toBe('test-only-long-password')
      updates++
    }
    return route.fulfill({ json: user })
  })
  await page.route('**/api/v1/projects', route => route.fulfill({ json: [] }))
  await page.goto('/#access_token=' + token + '&refresh_token=fake-refresh&expires_in=3600&token_type=bearer&type=invite')
  await expect(page.getByRole('heading', { name: 'Velg passord' })).toBeVisible()
  await expect(page.getByLabel('Nytt passord', { exact: true })).toBeVisible()
  // The token is consumed and the intent survives a page reload.
  expect(page.url()).toContain('auth=password')
  expect(page.url()).not.toContain('access_token')
  await page.reload()
  await page.getByLabel('Nytt passord', { exact: true }).fill('test-only-long-password')
  await page.getByLabel('Gjenta passord').fill('different-long-password')
  await page.getByRole('button', { name: 'Lagre passord og fortsett' }).click()
  await expect(page.getByRole('alert')).toContainText('ikke like')
  expect(updates).toBe(0)
  await page.getByLabel('Gjenta passord').fill('test-only-long-password')
  await page.getByRole('button', { name: 'Lagre passord og fortsett' }).click()
  await expect(page.getByRole('heading', { name: 'Velg passord' })).toHaveCount(0)
  expect(updates).toBe(1)
  expect(page.url()).not.toContain('auth=password')
})
