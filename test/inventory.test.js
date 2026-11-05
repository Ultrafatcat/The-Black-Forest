// test/inventory.test.js
//
// Integration tests for the Inventory page's equip/unequip, use, and drop
// routes (Checkpoint 4) -- hitting the real routes and checking the
// database afterward, same pattern as test/adventure.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-inventory.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const request = (await import('supertest')).default;

// Inserts a weapon, a consumable, and a treasure -- enough item_type
// variety to exercise equip (weapon), use (consumable), and the fact that
// a treasure can only be dropped, not equipped or used.
function seedTestItems() {
    const daggerId = db.prepare(
        'INSERT INTO items (name, item_type, attack_bonus, description) VALUES (?, ?, ?, ?)'
    ).run('Rusted Dagger', 'weapon', 2, 'A pitted old blade.').lastInsertRowid;

    const mushroomId = db.prepare(
        'INSERT INTO items (name, item_type, heal_amount, description) VALUES (?, ?, ?, ?)'
    ).run('Wild Mushroom', 'consumable', 5, 'Smells faintly of rain.').lastInsertRowid;

    const lockedId = db.prepare(
        'INSERT INTO items (name, item_type, is_treasure, point_value, description) VALUES (?, ?, ?, ?, ?)'
    ).run('Tarnished Locket', 'treasure', 1, 10, 'Worn too smooth to make out.').lastInsertRowid;

    return { daggerId, mushroomId, lockedId };
}

// Creates a guest character and gives it one of an item directly (there's
// no TAKE-based route in these tests -- Checkpoint 3's tests already cover
// that the TAKE flow lands items correctly in character_items).
let characterCount = 0;
async function createCharacterWithItem(app, itemId, quantity = 1) {
    const agent = request.agent(app);
    const name = `Rin${++characterCount}`; // unique per test so lookups below can't cross-match
    await agent.post('/character/new').type('form').send({ name, race: 'Fae', class: 'Rogue' });
    const character = db.prepare('SELECT * FROM characters WHERE name = ?').get(name);

    const characterItemId = db.prepare(
        'INSERT INTO character_items (character_id, item_id, quantity, is_equipped) VALUES (?, ?, ?, 0)'
    ).run(character.id, itemId, quantity).lastInsertRowid;

    return { agent, character, characterItemId };
}

test('equipping a weapon marks it equipped', async () => {
    const { daggerId } = seedTestItems();
    const app = createApp();
    const { agent, characterItemId } = await createCharacterWithItem(app, daggerId);

    const response = await agent.post('/character/inventory/equip').type('form').send({ characterItemId });
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/character/inventory');

    const row = db.prepare('SELECT is_equipped FROM character_items WHERE id = ?').get(characterItemId);
    assert.equal(row.is_equipped, 1);

    const page = await agent.get('/character/inventory');
    assert.match(page.text, /Equipped/);
});

test('equipping an already-equipped weapon unequips it', async () => {
    const { daggerId } = seedTestItems();
    const app = createApp();
    const { agent, characterItemId } = await createCharacterWithItem(app, daggerId);

    await agent.post('/character/inventory/equip').type('form').send({ characterItemId });
    await agent.post('/character/inventory/equip').type('form').send({ characterItemId });

    const row = db.prepare('SELECT is_equipped FROM character_items WHERE id = ?').get(characterItemId);
    assert.equal(row.is_equipped, 0);
});

test('a treasure cannot be equipped', async () => {
    const { lockedId } = seedTestItems();
    const app = createApp();
    const { agent, characterItemId } = await createCharacterWithItem(app, lockedId);

    const response = await agent.post('/character/inventory/equip').type('form').send({ characterItemId });
    assert.equal(response.status, 302); // route doesn't crash, just declines

    const row = db.prepare('SELECT is_equipped FROM character_items WHERE id = ?').get(characterItemId);
    assert.equal(row.is_equipped, 0);
});

test('using a consumable heals the character and removes the last one from the stack', async () => {
    const { mushroomId } = seedTestItems();
    const app = createApp();
    const { agent, character, characterItemId } = await createCharacterWithItem(app, mushroomId, 1);

    db.prepare('UPDATE characters SET health = ?, max_health = ? WHERE id = ?').run(20, 40, character.id);

    const response = await agent.post('/character/inventory/use').type('form').send({ characterItemId });
    assert.equal(response.status, 302);

    const updatedCharacter = db.prepare('SELECT health FROM characters WHERE id = ?').get(character.id);
    assert.equal(updatedCharacter.health, 25); // 20 + 5 heal_amount

    const row = db.prepare('SELECT * FROM character_items WHERE id = ?').get(characterItemId);
    assert.equal(row, undefined); // last one used, row removed
});

test('using a consumable from a stack of more than one only decrements the quantity', async () => {
    const { mushroomId } = seedTestItems();
    const app = createApp();
    const { agent, character, characterItemId } = await createCharacterWithItem(app, mushroomId, 3);

    db.prepare('UPDATE characters SET health = ?, max_health = ? WHERE id = ?').run(20, 40, character.id);

    await agent.post('/character/inventory/use').type('form').send({ characterItemId });

    const row = db.prepare('SELECT quantity FROM character_items WHERE id = ?').get(characterItemId);
    assert.equal(row.quantity, 2);
});

test('using a consumable never heals past max_health', async () => {
    const { mushroomId } = seedTestItems();
    const app = createApp();
    const { agent, character, characterItemId } = await createCharacterWithItem(app, mushroomId, 1);

    db.prepare('UPDATE characters SET health = ?, max_health = ? WHERE id = ?').run(38, 40, character.id);

    await agent.post('/character/inventory/use').type('form').send({ characterItemId });

    const updatedCharacter = db.prepare('SELECT health FROM characters WHERE id = ?').get(character.id);
    assert.equal(updatedCharacter.health, 40); // capped, not 43
});

test('a weapon cannot be used', async () => {
    const { daggerId } = seedTestItems();
    const app = createApp();
    const { agent, character, characterItemId } = await createCharacterWithItem(app, daggerId);

    const before = db.prepare('SELECT health FROM characters WHERE id = ?').get(character.id);
    await agent.post('/character/inventory/use').type('form').send({ characterItemId });

    const after = db.prepare('SELECT health FROM characters WHERE id = ?').get(character.id);
    assert.equal(after.health, before.health);

    const row = db.prepare('SELECT * FROM character_items WHERE id = ?').get(characterItemId);
    assert.ok(row); // still there, use was declined rather than silently consuming it
});

test('dropping an item removes it from the inventory', async () => {
    const { lockedId } = seedTestItems();
    const app = createApp();
    const { agent, character, characterItemId } = await createCharacterWithItem(app, lockedId);

    const response = await agent.post('/character/inventory/drop').type('form').send({ characterItemId });
    assert.equal(response.status, 302);

    const row = db.prepare('SELECT * FROM character_items WHERE id = ?').get(characterItemId);
    assert.equal(row, undefined);

    const page = await agent.get('/character/inventory');
    assert.match(page.text, /Nothing here yet/);
});

test('one character cannot act on another character\'s item', async () => {
    const { daggerId } = seedTestItems();
    const app = createApp();
    const { characterItemId } = await createCharacterWithItem(app, daggerId); // owned by Rin-N, not the agent below

    const otherAgent = request.agent(app);
    await otherAgent.post('/character/new').type('form').send({ name: `Intruder${++characterCount}`, race: 'Fae', class: 'Rogue' });

    await otherAgent.post('/character/inventory/drop').type('form').send({ characterItemId });

    const row = db.prepare('SELECT * FROM character_items WHERE id = ?').get(characterItemId);
    assert.ok(row); // untouched -- the row belongs to a different character
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-wal`, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-shm`, { force: true });
});