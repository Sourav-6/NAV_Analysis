const fs = require('fs');
const file = 'c:/Users/soura/Desktop/NAVANALYSIS/frontend/src/components/RankingDashboard.jsx';
let content = fs.readFileSync(file, 'utf8');

const startMarker = "<div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>";
const endMarker = "</div>\n              </div>\n              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.log('Markers not found');
  process.exit(1);
}

const addFundCode = content.substring(startIndex, endIndex);

const insertionPoint = content.indexOf('{/* Floating Exit Button */}');
if (insertionPoint === -1) {
  console.log('Insertion point not found');
  process.exit(1);
}

const floatingCode = `
                        {/* Floating Add Fund Search & Badges */}
                        <div style={{
                          position: 'absolute',
                          top: '16px',
                          left: '16px',
                          zIndex: 10000,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          background: 'rgba(0, 0, 0, 0.65)',
                          backdropFilter: 'blur(6px)',
                          padding: '12px',
                          borderRadius: '12px',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          maxWidth: '80%',
                          boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
                        }}>
                          ${addFundCode.replace(/marginTop: '12px'/g, "marginTop: '0'")}
                        </div>
`;

content = content.substring(0, insertionPoint) + floatingCode + '\n                        ' + content.substring(insertionPoint);

fs.writeFileSync(file, content);
console.log('Success');
