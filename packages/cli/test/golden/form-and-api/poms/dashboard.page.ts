import { Page, Locator } from '@playwright/test'

export class DashboardPage {
  readonly page: Page
  readonly homeLink: Locator
  readonly dashboardLink: Locator

  constructor(page: Page) {
    this.page = page
    this.homeLink = page.getByRole("link", { name: "Home" })
    this.dashboardLink = page.getByRole("link", { name: "Dashboard" })
  }

  async goto(): Promise<void> {
    await this.page.goto("http://127.0.0.1:45567/dashboard")
  }
}
