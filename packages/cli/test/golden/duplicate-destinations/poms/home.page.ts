import { Page, Locator } from '@playwright/test'

export class HomePage {
  readonly page: Page
  readonly readMoreLink1: Locator
  readonly readMoreLink2: Locator

  constructor(page: Page) {
    this.page = page
    this.readMoreLink1 = page.getByRole("link", { name: "Read more" }).nth(0)
    this.readMoreLink2 = page.getByRole("link", { name: "Read more" }).nth(1)
  }

  async goto(): Promise<void> {
    await this.page.goto("http://127.0.0.1:45568/")
  }
}
