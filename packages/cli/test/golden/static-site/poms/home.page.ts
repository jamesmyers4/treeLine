import { Page, Locator } from '@playwright/test'

export class HomePage {
  readonly page: Page
  readonly homeLink1: Locator
  readonly aboutLink1: Locator
  readonly contactLink1: Locator
  readonly homeLink2: Locator
  readonly aboutLink2: Locator
  readonly contactLink2: Locator

  constructor(page: Page) {
    this.page = page
    this.homeLink1 = page.getByRole("link", { name: "Home" }).nth(0)
    this.aboutLink1 = page.getByRole("link", { name: "About" }).nth(0)
    this.contactLink1 = page.getByRole("link", { name: "Contact" }).nth(0)
    this.homeLink2 = page.getByRole("link", { name: "Home" }).nth(1)
    this.aboutLink2 = page.getByRole("link", { name: "About" }).nth(1)
    this.contactLink2 = page.getByRole("link", { name: "Contact" }).nth(1)
  }

  async goto(): Promise<void> {
    await this.page.goto("http://127.0.0.1:44932/")
  }
}
