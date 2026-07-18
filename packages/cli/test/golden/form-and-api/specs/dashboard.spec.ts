import { test, expect } from '@playwright/test'
import { DashboardPage } from './dashboard.page'

test('DashboardPage loads', async ({ page }) => {
  const dashboardPage = new DashboardPage(page)
  await dashboardPage.goto()
  await expect(page).toHaveURL("http://127.0.0.1:45567/dashboard")
})
