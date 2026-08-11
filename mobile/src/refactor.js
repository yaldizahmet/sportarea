const fs = require('fs');
const path = require('path');

const screensDir = path.join(__dirname, 'screens');
const files = fs.readdirSync(screensDir).filter(f => f.endsWith('.tsx'));

files.forEach(file => {
  const filePath = path.join(screensDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // 1. Import apiFetch if fetch is used
  // Note: we don't replace Nominatim or OpenMeteo fetches. We should only replace API_URL fetches.
  // Wait, some fetches might not use API_URL directly. Let's just do `await fetch(\`\${API_URL}` -> `await apiFetch(\`\${API_URL}`
  // Let's see if there's any `fetch(endpoint` in AuthScreen.
  if (content.includes('fetch(') || content.includes('fetch`')) {
    // We only replace fetch calls that go to our API
    content = content.replace(/await fetch\(`\$\{API_URL\}/g, 'await apiFetch(`${API_URL}');
    content = content.replace(/await fetch\(endpoint/g, 'await apiFetch(endpoint');
    
    // Add import if we replaced anything
    if (content !== originalContent && !content.includes('apiFetch')) {
      // add import at top
      content = "import { apiFetch } from '../utils/api';\n" + content;
    }
  }

  // 2. Remove userId/creatorId from request bodies.
  // Example: body: JSON.stringify({ userId: user.id, ... })
  // We can just remove `userId: [^,}]*[,]?[ ]?` from JSON.stringify.
  // But wait, what if it's the only property? `{ userId: user.id }` -> `{  }`. That's fine.
  
  // Let's remove userId: something
  content = content.replace(/userId:\s*[^,}\n]+,?\s*/g, '');
  content = content.replace(/creatorId:\s*[^,}\n]+,?\s*/g, '');
  content = content.replace(/raterId:\s*[^,}\n]+,?\s*/g, '');
  
  // Fix empty trailing commas in JSON object if any (unlikely to cause syntax error if we just removed it completely with the comma)
  // Actually, in JS `{ a: 1, }` is valid syntax!
  
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated', file);
  }
});
