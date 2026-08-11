const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'index.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Replace in specific routes
const replacements = [
  // groups
  {
    find: /const { creatorId, name } = req.body;/g,
    replace: "const { name } = req.body;\n    const creatorId = req.user.id;"
  },
  {
    find: /const { userId, inviteCode } = req.body;/g,
    replace: "const { inviteCode } = req.body;\n    const userId = req.user.id;"
  },
  {
    find: /const { userId, message } = req.body;/g,
    replace: "const { message } = req.body;\n    const userId = req.user.id;"
  },
  // users
  {
    find: /app.post\('\/api\/users\/:id\/avatar', async \(req, res\) => {/g,
    replace: "app.post('/api/users/:id/avatar', async (req, res) => {\n  if (req.params.id !== req.user.id) return res.status(403).json({error: 'Yetkisiz erişim'});"
  },
  {
    find: /app.post\('\/api\/users\/:id\/position', async \(req, res\) => {/g,
    replace: "app.post('/api/users/:id/position', async (req, res) => {\n  if (req.params.id !== req.user.id) return res.status(403).json({error: 'Yetkisiz erişim'});"
  },
  {
    find: /app.post\('\/api\/users\/:id\/availability', async \(req, res\) => {/g,
    replace: "app.post('/api/users/:id/availability', async (req, res) => {\n  if (req.params.id !== req.user.id) return res.status(403).json({error: 'Yetkisiz erişim'});"
  },
  {
    find: /app.delete\('\/api\/users\/:id\/availability\/:availabilityId', async \(req, res\) => {/g,
    replace: "app.delete('/api/users/:id/availability/:availabilityId', async (req, res) => {\n  if (req.params.id !== req.user.id) return res.status(403).json({error: 'Yetkisiz erişim'});"
  },
  // notifications
  {
    find: /const { userId } = req.body;/g,
    replace: "const userId = req.user.id;"
  },
  // matches
  {
    find: /const { groupId, creatorId, date, time, location, maxPlayers, teamAName, teamBName, matchTimestamp, lockoutHours } = req.body;/g,
    replace: "const { groupId, date, time, location, maxPlayers, teamAName, teamBName, matchTimestamp, lockoutHours } = req.body;\n    const creatorId = req.user.id;"
  },
  {
    find: /const { raterId, receiverId } = req.body;/g,
    replace: "const { receiverId } = req.body;\n    const raterId = req.user.id;"
  },
  {
    find: /const { raterId, receiverId, rating } = req.body;/g,
    replace: "const { receiverId, rating } = req.body;\n    const raterId = req.user.id;"
  }
];

replacements.forEach(r => {
  content = content.replace(r.find, r.replace);
});

// GET /api/notifications should only fetch for req.user.id
content = content.replace(
  /app\.get\('\/api\/notifications', async \(req, res\) => \{\n(.*?)(const { userId } = req.query;)/gs,
  "app.get('/api/notifications', async (req, res) => {\n$1const userId = req.user.id;"
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Refactor completed successfully');
