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

// Meets every registration rule: 6+ characters, an uppercase letter, a
// number, and a special character.
const VALID_PASSWORD = 'Forest1!';

test('GET /login renders the Login page', async () => {
    const app = createApp();
    const response = await request(app).get('/login');
    assert.equal(response.status, 200);
    assert.match(response.text, /Login/);
});

test('GET /register renders the Register page', async () => {
    const app = createApp();
    const response = await request(app).get('/register');
    assert.equal(response.status, 200);
    assert.match(response.text, /Register/);
});

test('register then login succeeds, and rejects a repeat username', async () => {
    const app = createApp();

    const registered = await request(app)
        .post('/register')
        .type('form')
        .send({ username: 'adventurer', password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });
    assert.equal(registered.status, 302);
    assert.equal(registered.headers.location, '/');

    const duplicate = await request(app)
        .post('/register')
        .type('form')
        .send({ username: 'adventurer', password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });
    assert.equal(duplicate.status, 409);

    const loggedIn = await request(app)
        .post('/login')
        .type('form')
        .send({ username: 'adventurer', password: VALID_PASSWORD });
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
        .send({ username: '', password: '', confirmPassword: '' });

    assert.equal(response.status, 400);
});

test('a password that fails the strength rules is rejected', async () => {
    const app = createApp();

    const response = await request(app)
        .post('/register')
        .type('form')
        .send({ username: 'weakling', password: 'allsmall', confirmPassword: 'allsmall' });

    assert.equal(response.status, 400);
    assert.match(response.text, /uppercase/);
});

test('a confirm-password mismatch is rejected', async () => {
    const app = createApp();

    const response = await request(app)
        .post('/register')
        .type('form')
        .send({ username: 'mismatched', password: VALID_PASSWORD, confirmPassword: 'Different1!' });

    assert.equal(response.status, 400);
    assert.match(response.text, /do not match/);
});

test('a logged-in session carries the username onto the Menu page, and logout clears it', async () => {
    const app = createApp();
    const agent = request.agent(app); // keeps the session cookie across requests

    await agent.post('/register').type('form')
        .send({ username: 'wanderer', password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });

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