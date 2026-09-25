import { Page, Locator } from '@playwright/test'

export class HomePage {
  readonly page: Page
  readonly homeLink: Locator
  readonly dashboardLink: Locator
  readonly emailTextbox: Locator
  readonly fullNameTextbox: Locator
  readonly createAccountButton: Locator

  constructor(page: Page) {
    this.page = page
    this.homeLink = page.getByRole("link", { name: "Home", exact: true })
    this.dashboardLink = page.getByRole("link", { name: "Dashboard", exact: true })
    this.emailTextbox = page.getByRole("textbox", { name: "Email", exact: true })
    this.fullNameTextbox = page.getByRole("textbox", { name: "Full Name", exact: true })
    this.createAccountButton = page.getByRole("button", { name: "Create Account", exact: true })
  }

  async goto(): Promise<void> {
    await this.page.goto("http://127.0.0.1:45567/")
  }
}
