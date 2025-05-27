import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Page } from 'puppeteer'
import { connect } from 'puppeteer-real-browser'
import untypedMap from './serialization-map.json'
import {
  customSerializers,
  genericSerialize,
  serializeNumber,
} from './serializers'
import type { Part, PartType, SerializationMap } from './types'

const BASE_URL = 'https://pcpartpicker.com/products'
const STAGING_DIRECTORY = 'data-staging'
const ALL_ENDPOINTS: PartType[] = [
  'cpu',
  'cpu-cooler',
  'motherboard',
  'memory',
  'internal-hard-drive',
  'video-card',
  'case',
  'power-supply',
  'os',
  'monitor',
  'sound-card',
  'wired-network-card',
  'wireless-network-card',
  'headphones',
  'keyboard',
  'mouse',
  'speakers',
  'webcam',
  'case-accessory',
  'case-fan',
  'fan-controller',
  'thermal-paste',
  'external-hard-drive',
  'optical-drive',
  'ups',
]

const map = untypedMap as unknown as SerializationMap

async function scrape(endpoint: PartType, page: Page): Promise<Part[]> {
  await page.setRequestInterception(true)

  page.on('request', (req) => {
	if (req.isInterceptResolutionHandled()) {
		// This request was already handled, so just ignore it
		return;
	}

	switch (req.resourceType()) {
		case 'font':
		case 'image':
		case 'stylesheet': {
		req.abort().catch(() => {});
		break;
		}
		default:
		req.continue().catch(() => {});
	}
	});

  console.log(`🔗 Navigating to ${BASE_URL}/${endpoint}`)
  await page.goto(`${BASE_URL}/${endpoint}`, { waitUntil: 'networkidle2' })

  // Wait a bit for manual interaction if Cloudflare shows up
  console.log('⏳ Waiting 15 seconds for manual CAPTCHA or full load (if needed)...')
  await new Promise((r) => setTimeout(r, 15000))

  // Detect pagination count
  const paginationEl = await page.$('.pagination')
  if (!paginationEl) {
    console.warn(`[${endpoint}] Pagination element not found, assuming 1 page.`)
  }

  const numPages = paginationEl
    ? await paginationEl.$eval('li:last-child', (el) => parseInt(el.innerText))
    : 1

  console.log(`[${endpoint}] Total pages: ${numPages}`)

  const allParts: Part[] = []

  for (let currentPage = 1; currentPage <= numPages; currentPage++) {
    if (currentPage > 1) {
      const pageUrl = `${BASE_URL}/${endpoint}/#page=${currentPage}`
      console.log(`[${endpoint}] Navigating to page ${currentPage}: ${pageUrl}`)
      await page.goto(pageUrl, { waitUntil: 'networkidle2' })
      await new Promise((r) => setTimeout(r, 3000)) // small delay
    }

    const productEls = await page.$$('.tr__product')

    console.log(`[${endpoint}] Found ${productEls.length} products on page ${currentPage}`)

    for (const productEl of productEls) {
      const serialized: Part = {}

      serialized['name'] = await productEl.$eval(
        '.td__name .td__nameWrapper > p',
        (p) => p.innerText.replaceAll('\n', ' ')
      )

      const priceText = await productEl.$eval('.td__price', (td) => td.textContent)

      serialized['price'] =
        priceText == null || priceText.trim() === ''
          ? null
          : serializeNumber(priceText)

      const specs = await productEl.$$('td.td__spec')

      for (const spec of specs) {
        const specName = await spec.$eval('.specLabel', (l) =>
          (l as HTMLElement).innerText.trim()
        )
        const mapped = map[endpoint][specName]

        if (typeof mapped === 'undefined')
          throw new Error(`No mapping found for spec '${specName}' in endpoint '${endpoint}'`)

        const [snakeSpecName, mappedSpecSerializationType] = mapped

        const specValue = await spec.evaluate((s) => s.childNodes[1]?.textContent)

        if (specValue == null || specValue.trim() === '') {
          serialized[snakeSpecName] = null
        } else if (mappedSpecSerializationType === 'custom') {
          serialized[snakeSpecName] =
            customSerializers[endpoint]![snakeSpecName]!(specValue)
        } else {
          serialized[snakeSpecName] = genericSerialize(
            specValue,
            mappedSpecSerializationType
          )
        }
      }

      allParts.push(serialized)
    }
  }

  return allParts
}

async function main() {
  const inputEndpoints = process.argv.slice(2)
  const endpointsToScrape = inputEndpoints.length
    ? (inputEndpoints as PartType[])
    : ALL_ENDPOINTS

  await mkdir(join(STAGING_DIRECTORY, 'json'), { recursive: true })

  const { page, browser } = await connect({
    headless: false,
    fingerprint: true,
    turnstile: true,
    tf: true,
  } as any)

  try {
    // Initial navigation to base url (can trigger captcha here)
    console.log('🔗 Navigating to base URL for warm-up...')
    await page.goto('https://pcpartpicker.com', { waitUntil: 'networkidle2' })
    console.log('⏳ Waiting 15 seconds for manual CAPTCHA if it appears...')
    await new Promise((r) => setTimeout(r, 15000))

    for (const endpoint of endpointsToScrape) {
      try {
        const parts = await scrape(endpoint, page as unknown as Page)
        const fileName = `${endpoint}.json`
        const outPath = join(STAGING_DIRECTORY, 'json', fileName)

        await writeFile(outPath, JSON.stringify(parts, null, 2))
        console.log(`📁 Saved results for '${endpoint}' to ${outPath}`)
      } catch (err) {
        console.error(`❌ Failed to scrape '${endpoint}':`, err)
      }
    }
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('Fatal error:', e)
  process.exit(1)
})
