import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const request = (await import('supertest')).default;

test('GET / returns 200 and mentions The Black Forest', async () => {
    const app = createApp();
    const response = await request(app).get('/');
    assert.equal(response.status, 200);
    assert.match(response.text, /Black Forest/);
});

test('GET /health returns 200 and ok status', async () => {
    const app = createApp();
    const response = await request(app).get('/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
});