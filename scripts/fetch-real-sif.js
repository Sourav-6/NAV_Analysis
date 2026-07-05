import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(import.meta.dirname, '../data');
const SIF_NAV_DIR = path.join(DATA_DIR, 'nav/sif');
const SIF_SCHEMES_FILE = path.join(DATA_DIR, 'sif_schemes.json');

// Ensure directories exist
if (!fs.existsSync(SIF_NAV_DIR)) {
  fs.mkdirSync(SIF_NAV_DIR, { recursive: true });
}

(async () => {
  console.log("🚀 Launching Headless Browser to scrape AMFI SIF portal...");
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  // Route interception to find AMFI's hidden API calls for SIF
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('specialized-investment-funds') || url.includes('DownloadSIFNAV')) {
      console.log(`Intercepted internal API URL: ${url}`);
    }
  });

  try {
    console.log("Navigating to https://www.amfiindia.com/sif/latest-nav/nav-history ...");
    await page.goto('https://www.amfiindia.com/sif/latest-nav/nav-history', { waitUntil: 'networkidle2' });

    console.log("Extracting available SIF schemes and NAV data...");
    
    // We will extract data directly from the DOM tables or dropdowns to build sif_schemes.json
    const info = await page.evaluate(() => {
        return {
            title: document.title,
            body: document.body.innerText.substring(0, 500)
        };
    });
    console.log(`Page Info:`, info);

  } catch (error) {
    console.error("Error during scraping:", error);
  } finally {
    await browser.close();
  }
})();
