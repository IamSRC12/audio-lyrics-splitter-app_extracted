const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'public', 'images');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

function generateSvg(title, color1, color2, width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color1}" />
        <stop offset="100%" stop-color="${color2}" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)" />
    <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="none" stroke="rgba(217,119,6,0.3)" stroke-width="4"/>
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#f5f5f4" font-family="sans-serif" font-size="24" font-weight="bold">${title}</text>
  </svg>`;
}

fs.writeFileSync(path.join(dir, 'cutline-mark.png'), generateSvg('CUTLINE', '#1c1917', '#78350f', 100, 100));
fs.writeFileSync(path.join(dir, 'vinyl.jpg'), generateSvg('VINYL RECORD', '#0c0a09', '#1c1917', 600, 400));
fs.writeFileSync(path.join(dir, 'vintage-desk.jpg'), generateSvg('STUDIO DESK', '#1c1917', '#451a03', 800, 600));
fs.writeFileSync(path.join(dir, 'og-cutline.jpg'), generateSvg('CUTLINE LATHE', '#0c0a09', '#78350f', 1200, 630));
fs.writeFileSync(path.join(dir, 'hero-mixer.jpg'), generateSvg('ANALOG MIXER', '#1c1917', '#292524', 800, 600));
fs.writeFileSync(path.join(dir, 'lyrics-sheet.jpg'), generateSvg('LYRIC SHEET', '#1c1917', '#451a03', 800, 600));

console.log('Public images created successfully');
