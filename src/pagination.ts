import { connect } from 'puppeteer-real-browser';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { stringify } from 'csv-stringify/sync';

const MAX_CONCURRENT_TABS = 5;
const allData: any[] = [];

(async () => {
  const { page, browser } = await connect({
    headless: false,
    fingerprint: true,
    turnstile: true,
    tf: true,
  } as any);

  const baseCategoryUrl = 'https://pcpartpicker.com/products/cpu-cooler/';
  await page.goto(baseCategoryUrl, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 5000));

  // ✅ FIXED: Accurate selector for pagination links
  const totalPages = await page.evaluate(() => {
  const pageLinks = Array.from(document.querySelectorAll('#module-pagination ul.pagination li a'));
  const numbers = pageLinks.map(el => parseInt(el.textContent ?? '', 10)).filter(n => !isNaN(n));
  return numbers.length > 0 ? Math.max(...numbers) : 1;
});


  console.log(`📄 Total pages detected: ${totalPages}`);

  for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
    const paginatedUrl = `${baseCategoryUrl}#page=${currentPage}`;
    console.log(`🌐 Navigating to ${paginatedUrl}`);
    await page.goto(paginatedUrl, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 2000));

    console.log(`🚀 Scraping page ${currentPage} of ${totalPages}`);

    // Navigation by url works better than navigation by clicks

    await new Promise((r) => setTimeout(r, 1000));

    const products = await page.$$eval('tr.tr__product', (elements) =>
      elements.map((el) => {
        const nameEl = el.querySelector('.td__name a[href]');
        return {
          name: nameEl?.textContent?.trim() ?? '',
          url: nameEl
            ? `https://pcpartpicker.com${nameEl.getAttribute('href')}`
            : null,
        };
      })
    );

    if (!products.length) {
      throw new Error('⚠️ Product rows not found — page structure may have changed');
    }

    console.log(`🔍 Found ${products.length} products on page ${currentPage}`);

    async function scrapeProduct(product: { name: string; url: string | null }) {
      if (!product.url) {
        console.warn(`⚠️ Skipping product with missing URL`);
        return null;
      }
      const productPage = await browser.newPage();
      try {
        console.log(`🔗 Visiting product: ${product.url}`);
        await productPage.goto(product.url, { waitUntil: 'networkidle2' });
        await new Promise((r) => setTimeout(r, 1000));

        const specs: Record<string, string | null> = {};
        const groups = await productPage.$$('.block.xs-block.md-hide.specs .group.group--spec');
        console.log(`🛠️ Found ${groups.length} spec groups on ${product.name}`);

        for (const groupHandle of groups) {
          const key = await groupHandle.$eval('.group__title', (el) => el.textContent?.trim() ?? '').catch(() => '');
          if (!key) continue;

          const pText = await groupHandle.$eval('.group__content p', (el) => el.textContent?.trim()).catch(() => null);

          if (pText) {
            specs[key] = pText;
            // console.log(`📌 ${key}: ${pText}`);
          } else {
            const liTexts = await groupHandle.$$eval('.group__content ul li', (lis) =>
              lis.map((li) => li.textContent?.trim() ?? '').filter(Boolean)
            ).catch(() => []);
            if (liTexts.length > 0) {
              specs[key] = liTexts.join(', ');
              // console.log(`📌 ${key}: ${liTexts.join(', ')}`);
            } else {
              specs[key] = null;
              // console.log(`📌 ${key}: null`);
            }
          }
        }

        return { name: product.name, ...specs };
      } catch (err) {
        console.error(`❌ Error scraping ${product.url}:`, err);
        return null;
      } finally {
        await productPage.close();
      }
    }

    for (let i = 0; i < products.length; i += MAX_CONCURRENT_TABS) {
      const batch = products.slice(i, i + MAX_CONCURRENT_TABS);
      const results = await Promise.all(batch.map(scrapeProduct));
      results.forEach((res) => {
        if (res) allData.push(res);
      });
    }
  }

  const csv = stringify(allData, { header: true });
  const outPath = join(process.cwd(), 'pagination.csv');
  await writeFile(outPath, csv);

  console.log(`✅ Saved ${allData.length} rows to ${outPath}`);
  await browser.close();
})();
