// server/server.js
import express from 'express';
import './db/connection.js'; // creates/verifies the database on startup

const PORT = Number(process.env.PORT) || 3000;
const app = express();

app.get('/', (request, response) => {
    response.send('The Black Forest is running. Pages arrive in later checkpoints.');
});

app.get('/health', (request, response) => {
    response.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, () => {
    console.log(`The Black Forest listening on http://localhost:${PORT}`);
});