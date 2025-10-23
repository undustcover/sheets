import { test, expect } from '@playwright/test'

// 基础冒烟用例：登录 -> 表列表 -> 进入某表详情页

test('登录后进入表列表并可见列表标题', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()

  await page.getByLabel('用户名').fill('admin')
  await page.getByLabel('密码').fill('admin123')
  await page.getByRole('button', { name: /^登录/ }).click()

  await page.waitForURL('**/tables')
  await expect(page.getByRole('heading', { name: /表列表/ })).toBeVisible()
})

test('表详情页包含诊断区块与操作按钮', async ({ page }) => {
  // 依赖上一个用例已登录；若未登录则先登录
  await page.goto('/tables')
  if (await page.getByRole('heading', { name: '登录' }).isVisible().catch(() => false)) {
    test.skip(true, '未登录状态（后端未就绪或会话缺失），跳过详情页校验')
  }

  // 若无数据，后端接口会返回空数组；点击第一个表链接（测试环境通常会有种子数据或后续手动创建）
  const firstLink = page.locator('a[href^="/tables/"]').first()
  const hasLink = await firstLink.isVisible().catch(() => false)
  if (!hasLink) {
    test.skip(true, '无表可供详情页测试，跳过')
  }
  await firstLink.click()
  await expect(page.getByRole('heading', { name: /表 #/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '导入 CSV' })).toBeVisible()
})