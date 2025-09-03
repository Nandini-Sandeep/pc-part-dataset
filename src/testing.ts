import { connect } from 'puppeteer-real-browser';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { stringify } from 'csv-stringify/sync';
import { setTimeout } from 'node:timers/promises';



(async () => {
  const { page, browser } = await connect({
    headless: false,
    fingerprint: true,
    turnstile: true,
    tf: true,
  } as any);

  const BASE = 'https://pcpartpicker.com';
  const dataDir = join(process.cwd(), 'data');
  await mkdir(dataDir, { recursive: true });

  console.log('🌐 Navigating to homepage...');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // 👇 This waits for the base structure (logo/nav) to appear first
  await page.waitForSelector('body', { timeout: 10000 });

  console.log('⏳ Waiting for categories to appear...');
  let retries = 10;
  let categories: { name: string; url: string }[] = [];

  while (retries-- > 0 && categories.length === 0) {
    await setTimeout(2000);

    categories = await page.$$eval('ul.inside li a[href^="/products/"]', (els) =>
      els.map((el) => {
        const text = el.textContent?.trim() ?? '';
        const url = el.getAttribute('href') ?? '';
        return {
          name: text.replace(/\s+/g, '_').toLowerCase(),
          url,
        };
      }).filter(cat => cat.url && cat.name && cat.url !== '/products/')
    );

    console.log(`🔁 Retry ${10 - retries}/10 → Found ${categories.length} categories`);
  }

  if (categories.length === 0) {
    console.error('❌ Failed to find categories after retries. Cloudflare may be blocking it.');
    await browser.close();
    return;
  }

  console.log(`✅ Found ${categories.length} categories`);
  console.log(categories);

  const outPath = join(dataDir, `categories.csv`);
  await writeFile(outPath, stringify(categories, { header: true }));
  console.log(`💾 Saved to ${outPath}`);

  await browser.close();
  console.log('🏁 Done!');
})();
