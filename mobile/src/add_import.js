const fs = require('fs');
const path = require('path');

const screensDir = path.join(__dirname, 'screens');
const files = fs.readdirSync(screensDir).filter(f => f.endsWith('.tsx'));

files.forEach(file => {
  const filePath = path.join(screensDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes('apiFetch(') && !content.includes('import { apiFetch }')) {
    content = "import { apiFetch } from '../utils/api';\n" + content;
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Added import to', file);
  }
});
