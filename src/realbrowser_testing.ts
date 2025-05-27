import { connect } from 'puppeteer-real-browser'
import { writeFile } from 'fs/promises'
import { join } from 'path'

async function serializePrice(priceText: string | null): Promise<number | null> {
  if (!priceText) return null
  // Remove $ and commas, parse float
  const num = parseFloat(priceText.replace(/[^0-9.]/g, ''))
  return isNaN(num) ? null : num
}

;(async () => {
  const { page, browser } = await connect({
    headless: false,
    fingerprint: true,
    turnstile: true,
    tf: true,
  } as any)

  console.log('🔗 Opening CPU page...')

  await page.goto('https://pcpartpicker.com/products/cpu', {
    waitUntil: 'networkidle2',
  })

  console.log('⏳ Waiting 10 seconds for page to fully load or manual interaction...')
  await new Promise((r) => setTimeout(r, 10000))

  // Select all product elements
  const products = await page.$$eval('.tr__product', (els) =>
    els.map((el) => {
      const nameEl = el.querySelector('.td__name .td__nameWrapper > p')
      const priceEl = el.querySelector('.td__price')

      const name = nameEl?.textContent?.trim() ?? null
      const priceText = priceEl?.textContent?.trim() ?? null

      return {
        name,
        priceText,
      }
    })
  )

  // Parse and serialize price to number
  const serialized = products.map(({ name, priceText }) => ({
    name,
    price: priceText
      ? parseFloat(priceText.replace(/[^0-9.]/g, '')) || null
      : null,
  }))

  console.log(`📦 Products found: ${serialized.length}`)

  const outPath = join(process.cwd(), 'realbrowser_testing.json')
  await writeFile(outPath, JSON.stringify(serialized, null, 2))

  console.log(`📁 Saved results to ${outPath}`)

  await browser.close()
})()
