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
    this.homeLink = page.getByRole("link", { name: "Home" })
    this.dashboardLink = page.getByRole("link", { name: "Dashboard" })
    this.emailTextbox = page.getByRole("textbox", { name: "Email" })
    this.fullNameTextbox = page.getByRole("textbox", { name: "Full Name" })
    this.createAccountButton = page.getByRole("button", { name: "Create Account" })
  }

  async goto(): Promise<void> {
    await this.page.goto("http://127.0.0.1:45567/")
  }
}
