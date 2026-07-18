import { test, expect } from '@playwright/test'
import { ContactPage } from './contact.page'

test('ContactPage loads', async ({ page }) => {
  const contactPage = new ContactPage(page)
  await contactPage.goto()
  await expect(page).toHaveURL("http://127.0.0.1:44932/contact")
})
