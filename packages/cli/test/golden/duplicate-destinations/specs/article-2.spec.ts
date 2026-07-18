import { test, expect } from '@playwright/test'
import { Article2Page } from './article-2.page'

test('Article2Page loads', async ({ page }) => {
  const article2Page = new Article2Page(page)
  await article2Page.goto()
  await expect(page).toHaveURL("http://127.0.0.1:45568/article-2")
})
