import { test, expect } from '@playwright/test'
import { HomePage } from './home.page'

test('HomePage loads', async ({ page }) => {
  const homePage = new HomePage(page)
  await homePage.goto()
  await expect(page).toHaveURL("https://example.com/")
})
