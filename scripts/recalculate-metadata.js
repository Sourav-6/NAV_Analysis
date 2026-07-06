import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const NAV_DIR = path.join(DATA_DIR, 'nav');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');

function parseDateString(dateStr) {
  // Parses "DD-MMM-YYYY" (e.g. "03-Jul-2026") into a Date object
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date(0);
  const dd = parseInt(parts[0], 10);
  const mmm = months[parts[1]];
  const yyyy = parseInt(parts[2], 10);
  return new Date(yyyy, mmm, dd);
}

function formatDateForDisplay(date) {
  return date.toISOString().slice(0, 10);
}

function main() {
  console.log('🔍 Scanning NAV files to recalculate metadata...');
  
  if (!fs.existsSync(NAV_DIR)) {
    console.error('Error: NAV directory does not exist.');
    return;
  }

  const files = fs.readdirSync(NAV_DIR).filter(f => f.endsWith('.json'));
  let totalDataPoints = 0;
  let minDate = new Date(8640000000000000); // Max date possible
  let maxDate = new Date(-8640000000000000); // Min date possible

  let fileCount = 0;
  const totalFiles = files.length;

  for (const file of files) {
    const filePath = path.join(NAV_DIR, file);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (content && Array.isArray(content.navData)) {
        totalDataPoints += content.navData.length;
        
        content.navData.forEach(entry => {
          const date = parseDateString(entry.date);
          if (date.getTime() > 0) {
            if (date < minDate) minDate = date;
            if (date > maxDate) maxDate = date;
          }
        });
      }
    } catch (e) {
      console.error(`Error reading ${file}:`, e);
    }
    
    fileCount++;
    if (fileCount % 1000 === 0) {
      console.log(`  Processed ${fileCount}/${totalFiles} files...`);
    }
  }

  const metadata = {
    lastUpdated: new Date().toISOString(),
    lastNavDate: formatDateForDisplay(maxDate),
    totalSchemes: totalFiles,
    totalDataPoints,
    dataRangeStart: formatDateForDisplay(minDate),
    dataRangeEnd: formatDateForDisplay(maxDate),
    yearsOfData: Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24 * 365.25))
  };

  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
  
  console.log('\n✅ Recalculation Complete!');
  console.log(JSON.stringify(metadata, null, 2));
}

main();
