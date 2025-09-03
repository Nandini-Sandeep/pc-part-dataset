import { connect } from 'puppeteer-real-browser';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { stringify } from 'csv-stringify/sync';
import { setTimeout } from 'node:timers/promises';
import { mkdir } from 'fs/promises';

function normalizePrice(price: string | null): string | null {
  if (!price) return null;
  // This keeps only digits and dots, which is more universally robust.
  return price.replace(/[^\d.]/g, '').trim() || null;
}

function normalizeDimension(dim: string | null): string | null {
  if (!dim) return null;
  // Remove units (e.g., mm, cm, in), + signs, commas
  return dim.replace(/[\+\s]*(mm|cm|in|")?/gi, '').trim() || null;
}

function parseUserRating(rating: string | null): { numRatings: number | null; avgRating: number | null } {
  if (!rating) return { numRatings: null, avgRating: null };
  // Example format: "(168 Ratings, 4.5 Average)" or "(1 Rating, 3.0 Average)"
  const regex = /(\d+)\s+Rating[s]?.*?([\d.]+)\s+Average/i;
  const match = rating.match(regex);
  if (match && match[1] !== undefined && match[2] !== undefined) {
    return {
      numRatings: parseInt(match[1], 10),
      avgRating: parseFloat(match[2]),
    };
  }
  return { numRatings: null, avgRating: null };

}

function normalizeProductName(name: string | null): string | null {
  if (!name) return null;
  // Remove trailing (number) like "(55)"
  let cleaned = name.replace(/\s*\(\d+\)\s*$/, '');

  // Normalize whitespace to single spaces
  cleaned = cleaned.replace(/\s+/g, ' ');

  // Normalize capitalization to Title Case - may overcapitalize
  // cleaned = cleaned.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());

  return cleaned;
}

function parsePackCount(name: string | null): number | null {
  if (!name) return null;
  // Look for "3-Pack", "5-Pack", etc.
  const regex = /(\d+)[-\s]?Pack/i;
  const match = name.match(regex);
  return match && match[1] !== undefined ? parseInt(match[1], 10) : null;
}

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

  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await setTimeout(3000);

  console.log('🔍 Scraping categories from homepage...');
  const categories = await page.$$eval(
    'a[href^="/products/"]',
    (els) => {
      const seen = new Set();
      return els
        .filter(el => el.textContent && el.textContent.trim().length > 2)
        .map(el => ({
          name: el.textContent?.trim().replace(/\s+/g, '_').toLowerCase() ?? '',
          url: el.getAttribute('href') ?? '',
        }))
        .filter(cat => {
          if (seen.has(cat.name)) return false;
          seen.add(cat.name);
          // Remove any generic or root URLs
          if (cat.url === '/products/' || !cat.url) return false;
          return true;
        });
    }
  );
  console.log(categories);

  const MAX_CONCURRENT_TABS = 5;

  // ... multiple tabs at once ...

  for (const category of categories) {
    const categoryUrl = BASE + category.url;
    const categoryName = category.name;
    await page.goto(categoryUrl, { waitUntil: 'networkidle2' });
    //await new Promise((r) => setTimeout(r, 3000)); // Optional: wait for content

    // ✅ Extract total number of pages
    let totalPages = await page.evaluate(() => {
      const pageLinks = Array.from(document.querySelectorAll('#module-pagination ul.pagination li a'));
      const numbers = pageLinks.map(el => parseInt(el.textContent ?? '', 10)).filter(n => !isNaN(n));
      return numbers.length > 0 ? Math.max(...numbers) : 1;
    });

    console.log(`📄 Total pages detected: ${totalPages}`);
    if(totalPages>7) totalPages = 7; // scrape the first 7 pages first


    if ([''].includes(categoryName)) continue;

    console.log(`📂 Scraping category: ${categoryName} (${categoryUrl})`);
    const allData: any[] = [];
    //const seenNames = new Set<string>();

    // Use a separate browser context for tabs if desired
    // const context = await browser.createIncognitoBrowserContext();

    for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
      const paginatedUrl = `${categoryUrl}#page=${currentPage}`;
      console.log(`🌐 Navigating to ${paginatedUrl}`);
      await page.goto(paginatedUrl, { waitUntil: 'networkidle2' });
      // await new Promise((r) => setTimeout(r, 2000));

      console.log(`📄 Page ${currentPage} for ${categoryName}`);

      const products = await page.$$eval('.tr__product', (els) =>
        els.map((el) => {
          const nameEl = el.querySelector('.td__name a[href]');
          const rawName = nameEl?.textContent?.trim() ?? null;
          const name = rawName?.replace(/\s*\(\d+\)\s*$/, '') ?? null;
          const url = nameEl ? `https://pcpartpicker.com${nameEl.getAttribute('href')}` : null;
          return { name, url, rawName };
        })
      );

      console.log(`🔗 Found ${products.length} products on page ${currentPage}`);

      // Function to scrape product details in a tab
      async function scrapeProduct(product: { name: string | null; url: string | null }) {
        if (!product.url) {
          console.warn(`⚠️ Skipping product with missing URL`);
          return null;
        }
        const normalizedName = normalizeProductName(product.name);
        if (!normalizedName) {
          console.log(`⚠️ Skipping duplicate or invalid product name: ${product.name}`);
          return null;
        }
        // seenNames.add(normalizedName);

        // Open new tab
        const productPage = await browser.newPage();
        try {
          console.log(`🔍 Scraping ${normalizedName} (${product.url})`);
          await productPage.goto(product.url, { waitUntil: 'networkidle2' });
          await setTimeout(3000);

          const specs: Record<string, string | null> = {};
          const groups = await productPage.$$('.block.xs-block.md-hide.specs .group.group--spec');
          for (const groupHandle of groups) {
            let key: string | null = null;
            try {
              key = await groupHandle.$eval('.group__title', el => el.textContent?.trim() ?? '');
            } catch { continue; }
            if (!key) continue;

            let pText: string | null = null;
            try {
              pText = await groupHandle.$eval('.group__content p', el => el.textContent?.trim() ?? '');
            } catch {}

            if (pText) {
              specs[key] = normalizeDimension(pText);
            } else {
              let liTexts: string[] = [];
              try {
                liTexts = await groupHandle.$$eval('.group__content ul li', lis =>
                  lis.map(li => li.textContent?.trim() ?? '').filter(Boolean)
                );
              } catch {}
              specs[key] = liTexts.length > 0 ? liTexts.map(normalizeDimension).join(', ') : null;
            }
          }

          // Extract rating
          let ratingSummary: string | null = null;
          try {
            ratingSummary = await productPage.$eval('.actionBox__ratings ul.product--rating li:last-child', el =>
              el.textContent?.trim() ?? ''
            );
          } catch {}
          const { numRatings, avgRating } = parseUserRating(ratingSummary);

          // Extract price
          let priceRaw: string | null = null;
          try {
            priceRaw = await productPage.$eval('#prices table tbody td.td__finalPrice a', el =>
              el.textContent?.trim() ?? ''
            );
          } catch {}
          const price = normalizePrice(priceRaw);

          const packCount = parsePackCount(normalizedName);

          return {
            name: normalizedName,
            packCount,
            userRatingCount: numRatings,
            userRatingAvg: avgRating,
            price,
            ...specs,
          };
        } finally {
          await productPage.close();
        }
      }

      // Process products in batches with concurrency limit
      for (let i = 0; i < products.length; i += MAX_CONCURRENT_TABS) {
        const batch = products.slice(i, i + MAX_CONCURRENT_TABS);
        const results = await Promise.all(batch.map(p => scrapeProduct(p)));
        for (const res of results) {
          if (res) allData.push(res);
        }
      }

      //hasNext = (await page.$('a.pagination__next')) !== null;
    }

    console.log(allData.length, allData[0]);
    const csv = stringify(allData, { header: true });
    const outPath = join(dataDir, `${categoryName}.csv`);
    await writeFile(outPath, csv);
    console.log(`✅ Saved ${allData.length} rows to ${outPath}`);
  }

  await browser.close();
  console.log('🏁 All done!');

})();
