import { test, expect } from '@playwright/test'
import { AboutPage } from './about.page'

test('AboutPage loads', async ({ page }) => {
  const aboutPage = new AboutPage(page)
  await aboutPage.goto()
  await expect(page).toHaveURL("http://127.0.0.1:44932/about")
})
