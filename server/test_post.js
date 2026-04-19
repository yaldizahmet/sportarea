(async () => {
    try {
        const response = await fetch('http://localhost:3000/api/matches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                creatorId: '1', date: '2024', time: '12:00', location: 'Test', maxPlayers: 14, teamAName: 'A', teamBName: 'B'
            })
        });
        const text = await response.text();
        console.log(response.status, text);
    } catch(e) {
        console.log("Error:", e);
    }
})();
