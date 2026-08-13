import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto('http://localhost:4173/#/training')
await page.getByRole('button', { name: /New/ }).click()
const yAtModel = await page.getByRole('button', { name: 'Back', exact: true }).boundingBox()
// go to config (tall params) and compare the footer Y
await page.getByRole('button', { name: /OpenWakeWord KWS driver/ }).click()
await page.getByRole('button', { name: 'Next' }).click()
const yAtConfig = await page.getByRole('button', { name: 'Back', exact: true }).boundingBox()
console.log(JSON.stringify({ model: Math.round(yAtModel.y), config: Math.round(yAtConfig.y), vh: 900 }))
await browser.close()
