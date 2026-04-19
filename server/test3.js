const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('sports.db');
db.all('PRAGMA table_info(Notifications)', [], (err, rows) => console.log(rows));
db.all('SELECT * FROM Notifications', [], (err, rows) => console.log(rows));
