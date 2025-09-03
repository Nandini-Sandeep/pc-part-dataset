import { connect } from 'puppeteer-real-browser';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { stringify } from 'csv-stringify/sync';
import { setTimeout } from 'node:timers/promises';
import { mkdir } from 'fs/promises';  // <-- import mkdir

(async () => {
  const { page, browser } = await connect({
    headless: false,
    fingerprint: true,
    turnstile: true,
    tf: true,
  } as any);

  const BASE = 'https://pcpartpicker.com';

  // Ensure data directory exists
  const dataDir = join(process.cwd(), 'data');
  await mkdir(dataDir, { recursive: true });  // <-- create data folder if missing

  // Step 1: Get all product category URLs from homepage
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await setTimeout(3000);

  console.log('🔍 Scraping categories from homepage...');
  const categories = await page.$$eval(
    'a[href^="/products/"]',
    (els) =>
      els
        .filter(el => el.textContent && el.textContent.trim().length > 2)
        .map((el) => ({
          name: el.textContent?.trim().replace(/\s+/g, '_').toLowerCase() ?? '',
          url: el.getAttribute('href') ?? '',
        }))
  );
  console.log(categories)

  for (const category of categories) {
    const categoryUrl = BASE + category.url;
    const categoryName = category.name;

    // Remove or adjust this filter as needed
    if ([
      'cpu_coolers', 'keyboards', 
      'mice', 'operating_systems', 
      'cases', 'headphones', 'speakers',
      'power_supplies', 'storage', 'fan_controllers', 
      'video_cards', 'cpus', 'memory', 
      'motherboards', 'webcams', 'thermal_compound',
      'monitors','sound_cards','case_fans',
      'wired_networking','wireless_networking',
      'optical_drives','external_hard_drives',
      'uninterruptible_power_supplies'].includes(categoryName)) // Last 3 have price data and clean names
      { continue; }

    console.log(`📂 Scraping category: ${categoryName} (${categoryUrl})`);
    let pageNum = 1;
    let hasNext = true;
    const allData: any[] = [];

    while (hasNext) {
      const pagedUrl = `${categoryUrl}?page=${pageNum}`;
      await page.goto(pagedUrl, { waitUntil: 'networkidle2' });
      await setTimeout(3000);

      console.log(`📄 Page ${pageNum} for ${categoryName}`);

      const products = await page.$$eval('.tr__product', (els) =>
        els.map((el) => {
          const nameEl = el.querySelector('.td__name a[href]');
          const name = nameEl?.textContent?.trim().replace(/\s*\(\d+\)\s*$/, '') ?? null;
          const url = nameEl ? `https://pcpartpicker.com${nameEl.getAttribute('href')}` : null;
          return { name, url };
        })
      );

      console.log(`🔗 Found ${products.length} products on page ${pageNum}`);

      for (const [i, product] of products.entries()) {
        if (!product.url) {
          console.warn(`⚠️ Skipping product ${i + 1} with missing URL`);
          continue;
        }

        console.log(`🔍 Scraping ${product.name} (${product.url})`);
        await page.goto(product.url, { waitUntil: 'networkidle2' });
        await setTimeout(3000);

        const specs: Record<string, string | null> = {};

        // Extract specs
        const groups = await page.$$('.block.xs-block.md-hide.specs .group.group--spec');
        for (const groupHandle of groups) {
          let key: string | null = null;
          try {
            key = await groupHandle.$eval('.group__title', el => el.textContent?.trim() ?? '');
          } catch { continue; }

          if (!key) continue;

          // Try to get paragraph text, else get list items
          let pText: string | null = null;
          try {
            pText = await groupHandle.$eval('.group__content p', el => el.textContent?.trim() ?? '');
          } catch {}

          if (pText) {
            specs[key] = pText;
          } else {
            let liTexts: string[] = [];
            try {
              liTexts = await groupHandle.$$eval('.group__content ul li', lis =>
                lis.map(li => li.textContent?.trim() ?? '').filter(Boolean)
              );
            } catch {}
            specs[key] = liTexts.length > 0 ? liTexts.join(', ') : null;
          }
        }

        // Extract product rating
        try {
          const ratingSummary = await page.$eval('.actionBox__ratings ul.product--rating li:last-child', el =>
            el.textContent?.trim() ?? ''
          );
          specs['User Rating'] = ratingSummary; // Example: "(63 Ratings, 4.7 Average)"
        } catch {
          specs['User Rating'] = null;
        }

        // Extract price
        try {
          const price = await page.$eval('#prices table tbody td.td__finalPrice a', el =>
            el.textContent?.trim() ?? ''
          );
          specs['Price'] = price; // Example: "$37.90"
        } catch {
          specs['Price'] = null;
        }

        allData.push({ name: product.name, ...specs });

      }

      // Check for next page
      hasNext = (await page.$('a.pagination__next')) !== null;
      pageNum++;
    }

    // Step 3: Write category data to CSV inside data folder
    console.log(allData.length, allData[0]);
    const csv = stringify(allData, { header: true });
    console.log(csv.slice(0, 500)); // Preview first 500 chars
    const outPath = join(dataDir, `${categoryName}.csv`);
    await writeFile(outPath, csv);
    console.log(`✅ Saved ${allData.length} rows to ${outPath}`);
  }

  await browser.close();
  console.log('🏁 All done!');
})();
