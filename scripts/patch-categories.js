import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCHEMES_FILE = path.join(PROJECT_ROOT, 'data', 'schemes.json');
const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';

function fetchAMFIData() {
  return new Promise((resolve, reject) => {
    https.get(AMFI_URL, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function patchCategories() {
  console.log('Fetching latest NAVAll.txt from AMFI...');
  try {
    const rawText = await fetchAMFIData();
    const lines = rawText.split('\n');
    const categoryMap = new Map();
    let currentCategory = 'Unknown';

    console.log('Parsing categories from text...');
    for (const line of lines) {
      const trimmed = line.trim().replace(/\r$/, '');
      if (!trimmed) continue;
      
      // Check if it's a category header
      if (trimmed.startsWith('Open Ended') || trimmed.startsWith('Close Ended') || trimmed.startsWith('Interval')) {
        currentCategory = trimmed;
        continue;
      }

      // Check if it's a data line
      const parts = trimmed.split(';');
      if (parts.length >= 6) {
        const schemeCode = parts[0].trim();
        if (schemeCode && !isNaN(parseInt(schemeCode))) {
          categoryMap.set(schemeCode, currentCategory);
        }
      }
    }

    console.log(`Extracted categories for ${categoryMap.size} schemes.`);

    console.log('Patching local schemes.json...');
    const schemesData = fs.readFileSync(SCHEMES_FILE, 'utf-8');
    const schemesList = JSON.parse(schemesData);

    let patchedCount = 0;
    for (const scheme of schemesList) {
      const code = String(scheme.schemeCode);
      if (categoryMap.has(code)) {
        scheme.schemeCategory = categoryMap.get(code);
        patchedCount++;
      } else {
        scheme.schemeCategory = 'Unknown';
      }
    }

    fs.writeFileSync(SCHEMES_FILE, JSON.stringify(schemesList, null, 0)); // Compact JSON
    console.log(`Successfully patched ${patchedCount} schemes with official categories!`);

  } catch (err) {
    console.error('Error during patching:', err);
  }
}

patchCategories();
