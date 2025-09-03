import { connect } from 'puppeteer-real-browser'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { stringify } from 'csv-stringify/sync'

;(async () => {
  const { page, browser } = await connect({
    headless: false, //  headless so no window opens
    fingerprint: true,
    turnstile: true,
    tf: true,
  } as any)

  await page.goto('https://pcpartpicker.com/products/cpu-cooler/', {
    waitUntil: 'networkidle2',
  })

  console.log('⏳ Waiting 20s for CAPTCHA if any...')
  await new Promise((r) => setTimeout(r, 10000))

  const products = await page.$$eval('.tr__product', (els) =>
    els.map((el) => {
      const nameEl = el.querySelector('.td__name a[href]')
      const name = nameEl?.textContent?.trim() ?? null
      const url = nameEl ? nameEl.getAttribute('href') : null
      return {
        name,
        url: url ? `https://pcpartpicker.com${url}` : null,
      }
    })
  )

  const allData: any[] = []

  for (const [i, product] of products.entries()) {
    if (!product.url) {
      console.warn(`⚠️ Skipping product ${i + 1} with missing URL`)
      continue
    }

    console.log(`🔗 Visiting product ${i + 1}: ${product.url}`)
    await page.goto(product.url, { waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 5000)) // Let specs load

    // ✅ Robust specs scraping
    const specs: Record<string, string | null> = {}
    const groups = await page.$$('.block.xs-block.md-hide.specs .group.group--spec')

    console.log(`🛠️ Found ${groups.length} spec groups on ${product.name}`)

    for (const groupHandle of groups) {
      const key = await groupHandle.$eval('.group__title', (el) => el.textContent?.trim() ?? '')
      if (!key) continue

      const pText = await groupHandle
        .$eval('.group__content p', (el) => el.textContent?.trim())
        .catch(() => null)

      if (pText) {
        specs[key] = pText
        console.log(`📌 ${key}: ${pText}`)
      } else {
        const liTexts = await groupHandle.$$eval('.group__content ul li', (lis) =>
          lis.map((li) => li.textContent?.trim() ?? '').filter(Boolean)
        )
        if (liTexts.length > 0) {
          specs[key] = liTexts.join(', ')
          console.log(`📌 ${key}: ${liTexts.join(', ')}`)
        } else {
          specs[key] = null
          console.log(`📌 ${key}: null`)
        }
      }
    }

    allData.push({ name: product.name, ...specs })
  }

  // Convert to CSV
  const csv = stringify(allData, {
    header: true,
  })

  const outPath = join(process.cwd(), 'fulldata_testing.csv')
  await writeFile(outPath, csv)

  console.log(`✅ Saved ${allData.length} rows to ${outPath}`)

  await browser.close()
})()
