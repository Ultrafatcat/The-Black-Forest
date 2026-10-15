// test/auth.test.js
//
// Integration tests for the Login/Register routes (Checkpoint 1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Point the app at a throwaway database before importing anything that
// opens a connection, so tests never touch data/black-forest.db.
process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-auth.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const request = (await import('supertest')).default;

test('GET /login renders the Login/Register page', async () => {
    const app = createApp();
    const response = await request(app).get('/login');
    assert.equal(response.status, 200);
    assert.match(response.text, /Login/);
});

test('register then login succeeds, and rejects a repeat username', async () => {
    const app = createApp();

    const registered = await request(app)
        .post('/register')
        .type('form')
        .send({ username: 'adventurer', password: 'correct-horse' });
    assert.equal(registered.status, 302);
    assert.equal(registered.headers.location, '/');

    const duplicate = await request(app)
        .post('/register')
        .type('form')
        .send({ username: 'adventurer', password: 'anything' });
    assert.equal(duplicate.status, 409);

    const loggedIn = await request(app)
        .post('/login')
        .type('form')
        .send({ username: 'adventurer', password: 'correct-horse' });
    assert.equal(loggedIn.status, 302);

    const wrongPassword = await request(app)
        .post('/login')
        .type('form')
        .send({ username: 'adventurer', password: 'nope' });
    assert.equal(wrongPassword.status, 401);
});

test('a missing username or password is rejected before touching the database', async () => {
    const app = createApp();

    const response = await request(app)
        .post('/register')
        .type('form')
        .send({ username: '', password: '' });

    assert.equal(response.status, 400);
});

test('a logged-in session carries the username onto the Menu page, and logout clears it', async () => {
    const app = createApp();
    const agent = request.agent(app); // keeps the session cookie across requests

    await agent.post('/register').type('form').send({ username: 'wanderer', password: 'forest123' });

    const menuWhileLoggedIn = await agent.get('/');
    assert.match(menuWhileLoggedIn.text, /wanderer/);

    const loggedOut = await agent.post('/logout');
    assert.equal(loggedOut.status, 302);

    const menuAfterLogout = await agent.get('/');
    assert.doesNotMatch(menuAfterLogout.text, /wanderer/);
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-wal`, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-shm`, { force: true });
});