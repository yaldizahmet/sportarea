const fs = require('fs');

async function runTests() {
    console.log("Starting MVP Tests...");
    const baseUrl = 'http://127.0.0.1:3000/api';
    let token = '';
    let userId = '';

    // 1. Register
    try {
        const regRes = await fetch(`${baseUrl}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: `test${Date.now()}@test.com`, password: 'password123', name: 'Test User' })
        });
        const regData = await regRes.json();
        console.log("Register:", regRes.status, regData);
        if (regData.token) {
            token = regData.token;
        }
    } catch(e) { console.error("Register failed", e); }

    if (!token) return console.log("Aborting tests, no token.");

    // 2. Get Profile
    try {
        const profRes = await fetch(`${baseUrl}/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log("Profile:", profRes.status, await profRes.json());
    } catch(e) { console.error("Profile failed", e); }

    // 3. Create Match
    try {
        const matchRes = await fetch(`${baseUrl}/matches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ date: '2026-08-01', time: '20:00', location: 'MVP Arena', maxPlayers: 10, pitchMapUrl: 'https://example.com/pitch' })
        });
        console.log("Create Match:", matchRes.status, await matchRes.json());
    } catch(e) { console.error("Match failed", e); }

    // 4. Get Matches
    try {
        const matchesRes = await fetch(`${baseUrl}/matches`);
        console.log("Get Matches:", matchesRes.status, (await matchesRes.json()).length, "matches found");
    } catch(e) { console.error("Get Matches failed", e); }
}

runTests();
