// test/character.test.js
//
// Integration tests for Character Creation and the Character Sheet
// (Checkpoint 2). Character Creation works for guests and logged-in players
// alike -- see the Menu Page section of the spec.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-character.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const request = (await import('supertest')).default;

test('GET /character/new renders the Character Creation form', async () => {
    const app = createApp();
    const response = await request(app).get('/character/new');
    assert.equal(response.status, 200);
    assert.match(response.text, /Character Creation/);
});

test('creating a character as a guest redirects into the Character Sheet and persists the row', async () => {
    const app = createApp();
    const agent = request.agent(app);

    const created = await agent
        .post('/character/new')
        .type('form')
        .send({ name: 'Rowan', race: 'Elf', class: 'Mage' });
    assert.equal(created.status, 302);
    assert.equal(created.headers.location, '/character');

    const row = db.prepare('SELECT * FROM characters WHERE name = ?').get('Rowan');
    assert.ok(row, 'character row should exist');
    assert.equal(row.race, 'Elf');
    assert.equal(row.class, 'Mage');
    assert.equal(row.user_id, null); // guest run: not tied to an account
    assert.equal(row.attribute_points, 3);

    const sheet = await agent.get('/character');
    assert.equal(sheet.status, 200);
    assert.match(sheet.text, /Rowan/);
    assert.match(sheet.text, /Elf Mage/);
});

test('a missing name is rejected before touching the database', async () => {
    const app = createApp();
    const response = await request(app)
        .post('/character/new')
        .type('form')
        .send({ name: '', race: 'Human', class: 'Warrior' });
    assert.equal(response.status, 400);
    assert.match(response.text, /needs a name/);
});

test('an invalid race or class is rejected', async () => {
    const app = createApp();
    const response = await request(app)
        .post('/character/new')
        .type('form')
        .send({ name: 'Bad', race: 'Orc', class: 'Warrior' });
    assert.equal(response.status, 400);
    assert.match(response.text, /race/);
});

test('visiting the Character Sheet with no run redirects to Character Creation', async () => {
    const app = createApp();
    const response = await request(app).get('/character');
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/character/new');
});

test('spending an attribute point updates the stat and the remaining pool', async () => {
    const app = createApp();
    const agent = request.agent(app);

    await agent.post('/character/new').type('form').send({ name: 'Grix', race: 'Dwarf', class: 'Warrior' });

    const before = db.prepare('SELECT * FROM characters WHERE name = ?').get('Grix');
    assert.equal(before.strength, 8); // base 5 + Warrior +3 + Dwarf +0, sanity check on creation math

    const spend = await agent.post('/character/attributes').type('form').send({ stat: 'strength' });
    assert.equal(spend.status, 302);

    const after = db.prepare('SELECT * FROM characters WHERE name = ?').get('Grix');
    assert.equal(after.strength, before.strength + 1);
    assert.equal(after.attribute_points, before.attribute_points - 1);
});

test('spending with an invalid stat name shows an error instead of crashing', async () => {
    const app = createApp();
    const agent = request.agent(app);

    await agent.post('/character/new').type('form').send({ name: 'Finn', race: 'Human', class: 'Rogue' });

    const response = await agent.post('/character/attributes').type('form').send({ stat: 'charisma' });
    assert.equal(response.status, 400);
    assert.match(response.text, /not an attribute/);
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-wal`, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-shm`, { force: true });
});