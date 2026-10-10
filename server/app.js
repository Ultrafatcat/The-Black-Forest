// server/app.js
//
// Builds the Express app but never calls app.listen() -- that's server.js's
// job. Splitting them like this means tests can exercise routes directly
// without actually opening a network port.

import express from 'express';
import './db/connection.js'; // creates/verifies the database on startup

export function createApp() {
    const app = express();

    app.get('/', (request, response) => {
        response.send('The Black Forest is running. Pages arrive in later checkpoints.');
    });

    app.get('/health', (request, response) => {
        response.json({ status: 'ok', uptime: process.uptime() });
    });

    return app;
}