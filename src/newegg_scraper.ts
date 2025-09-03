import puppeteer from 'puppeteer';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { stringify } from 'csv-stringify/sync';

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://www.newegg.com/Desktop-Computers/SubCategory/ID-10', {
    waitUntil: 'networkidle2',
  });

  await page.waitForSelector('.item-container');

  const products = await page.$$eval('.item-container', (items) =>
    items.map((item) => {
      const name = item.querySelector('.item-title')?.textContent?.trim() || '';
      const url = item.querySelector('.item-title')?.getAttribute('href') || '';
      const brand = item.querySelector('.item-brand img')?.getAttribute('title') || '';
      const image = item.querySelector('.item-img img')?.getAttribute('src') || '';
      const price = item.querySelector('.price-current')?.textContent?.trim() || '';
      const shipping = item.querySelector('.price-ship')?.textContent?.trim() || '';

      const features = Array.from(item.querySelectorAll('.item-features li')).map((li) =>
        li.textContent?.trim().replace(/\s+/g, ' ')
      );

      return {
        name,
        url,
        brand,
        image,
        price,
        shipping,
        features: features.join(' | '),
      };
    })
  );

  console.log(`✅ Scraped ${products.length} products`);

  const csv = stringify(products, { header: true });
  const outPath = join(process.cwd(), 'newegg_products.csv');
  await writeFile(outPath, csv);

  console.log(`✅ Saved to ${outPath}`);
  await browser.close();
})();
