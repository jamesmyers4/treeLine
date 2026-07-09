import { Page, Locator } from '@playwright/test'

export class HomePage {
  readonly page: Page
  readonly learnMoreLink: Locator

  constructor(page: Page) {
    this.page = page
    this.learnMoreLink = page.getByRole("link", { name: "Learn more" })
  }

  async goto(): Promise<void> {
    await this.page.goto("https://example.com/")
  }
}
