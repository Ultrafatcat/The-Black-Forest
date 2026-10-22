// test/account.test.js
//
// Integration tests for the Account page skeleton (Checkpoint 2): nickname
// and privacy-toggle updates. The fuller Account page (stats, delete
// account) is a later checkpoint -- this is the skeleton named in the spec.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-account.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const request = (await import('supertest')).default;

const VALID_PASSWORD = 'Forest1!';

test('GET /account redirects to /login when not signed in', async () => {
    const app = createApp();
    const response = await request(app).get('/account');
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/login');
});

test('a signed-in user sees their username and current nickname', async () => {
    const app = createApp();
    const agent = request.agent(app);

    await agent.post('/register').type('form')
        .send({ username: 'ranger', password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });

    const response = await agent.get('/account');
    assert.equal(response.status, 200);
    assert.match(response.text, /ranger/);
});

test('updating the nickname and privacy toggle persists to the database', async () => {
    const app = createApp();
    const agent = request.agent(app);

    await agent.post('/register').type('form')
        .send({ username: 'scout', password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });

    // Omitting isPublic simulates unchecking the box -- browsers don't send
    // unchecked checkboxes at all.
    const response = await agent.post('/account').type('form').send({ nickname: 'Scout Prime' });
    assert.equal(response.status, 200);
    assert.match(response.text, /Saved/);

    const row = db.prepare('SELECT nickname, is_public FROM users WHERE username = ?').get('scout');
    assert.equal(row.nickname, 'Scout Prime');
    assert.equal(row.is_public, 0);
});

test('an empty nickname is rejected', async () => {
    const app = createApp();
    const agent = request.agent(app);

    await agent.post('/register').type('form')
        .send({ username: 'blank', password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });

    const response = await agent.post('/account').type('form').send({ nickname: '' });
    assert.equal(response.status, 400);
    assert.match(response.text, /cannot be empty/);
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-wal`, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-shm`, { force: true });
});