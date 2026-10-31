// test/adventure.test.js
//
// Integration tests for the Adventure page's command parser (Checkpoint 3),
// hitting the real GO/LOOK/TAKE/FIGHT routes and checking the database
// afterward -- not just the pure resolveCommand function in isolation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-adventure.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const request = (await import('supertest')).default;

// Builds a tiny two-room map directly in the database -- there's no route
// for creating rooms/items (they're seed-only data), so tests set up their
// own fixtures the same way server/db/seed.js does.
function seedTestWorld() {
    const wolfId = db.prepare(
        'INSERT INTO monsters (name, health, attack, defense, xp_reward, gold_reward) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('Ashen Wolf', 20, 4, 1, 15, 5).lastInsertRowid;

    const daggerId = db.prepare(
        'INSERT INTO items (name, item_type, description) VALUES (?, ?, ?)'
    ).run('Rusted Dagger', 'weapon', 'A pitted old blade.').lastInsertRowid;

    // Inserted first, so this gets the lowest id -- the starting room by
    // convention (see server/db/seed.js).
    const clearingId = db.prepare(
        'INSERT INTO rooms (name, description, monster_id) VALUES (?, ?, ?)'
    ).run('Forest Clearing', 'A ring of ash-grey trees.', null).lastInsertRowid;

    const denId = db.prepare(
        'INSERT INTO rooms (name, description, monster_id) VALUES (?, ?, ?)'
    ).run("Wolf's Den", 'Something growls just out of sight.', wolfId).lastInsertRowid;

    db.prepare('INSERT INTO room_exits (room_id, direction, destination_room_id) VALUES (?, ?, ?)')
        .run(clearingId, 'north', denId);
    db.prepare('INSERT INTO room_exits (room_id, direction, destination_room_id) VALUES (?, ?, ?)')
        .run(denId, 'south', clearingId);

    db.prepare('INSERT INTO room_items (room_id, item_id, quantity) VALUES (?, ?, ?)')
        .run(clearingId, daggerId, 1);

    return { clearingId, denId, wolfId, daggerId };
}

// Creates a guest character and returns the agent so the session cookie
// carries across requests, plus the character row for assertions.
//
// Every test in this file shares one database (seedTestWorld() is called
// per test, but room ids keep climbing across tests rather than resetting),
// so the app's own "lowest-id room is the start" convention only holds for
// the first test to run. Forcing current_room_id here, instead of relying
// on that convention, keeps every test correct regardless of run order.
let characterCount = 0;
async function createGuestCharacter(app, startingRoomId) {
    const agent = request.agent(app);
    const name = `Nym${++characterCount}`; // unique per test so lookups below can't cross-match
    await agent.post('/character/new').type('form').send({ name, race: 'Fae', class: 'Rogue' });
    db.prepare('UPDATE characters SET current_room_id = ? WHERE name = ?').run(startingRoomId, name);
    const character = db.prepare('SELECT * FROM characters WHERE name = ?').get(name);
    return { agent, character };
}

test('GET /character/adventure with no run redirects to Character Creation', async () => {
    const app = createApp();
    const response = await request(app).get('/character/adventure');
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/character/new');
});

test('a new character spawns in the starting room and sees it on the Adventure page', async () => {
    const { clearingId } = seedTestWorld();
    const app = createApp();
    const { agent } = await createGuestCharacter(app, clearingId);

    const page = await agent.get('/character/adventure');
    assert.equal(page.status, 200);
    assert.match(page.text, /Forest Clearing/);
    assert.match(page.text, /ash-grey trees/);
});

test('GO moves the character through a real exit and logs the command', async () => {
    const { clearingId, denId } = seedTestWorld();
    const app = createApp();
    const { agent, character } = await createGuestCharacter(app, clearingId);

    const command = await agent.post('/character/adventure/command').type('form').send({ command: 'go north' });
    assert.equal(command.status, 302);
    assert.equal(command.headers.location, '/character/adventure');

    const updated = db.prepare('SELECT current_room_id FROM characters WHERE id = ?').get(character.id);
    assert.equal(updated.current_room_id, denId);

    const logRow = db.prepare('SELECT raw_command, response_text FROM command_log WHERE character_id = ?').get(character.id);
    assert.equal(logRow.raw_command, 'go north');
    assert.match(logRow.response_text, /head north/);

    const page = await agent.get('/character/adventure');
    assert.match(page.text, /Wolf's Den/);
});

test('GO in a direction with no exit does not move the character', async () => {
    const { clearingId } = seedTestWorld();
    const app = createApp();
    const { agent, character } = await createGuestCharacter(app, clearingId);

    await agent.post('/character/adventure/command').type('form').send({ command: 'go south' });

    const updated = db.prepare('SELECT current_room_id FROM characters WHERE id = ?').get(character.id);
    assert.equal(updated.current_room_id, character.current_room_id); // unchanged

    const logRow = db.prepare('SELECT response_text FROM command_log WHERE character_id = ?').get(character.id);
    assert.match(logRow.response_text, /can't go south/);
});

test('LOOK describes the current room, its items, and its exits', async () => {
    const { clearingId } = seedTestWorld();
    const app = createApp();
    const { agent } = await createGuestCharacter(app, clearingId);

    await agent.post('/character/adventure/command').type('form').send({ command: 'look' });

    const page = await agent.get('/character/adventure');
    assert.match(page.text, /ash-grey trees/);
    assert.match(page.text, /Rusted Dagger/);
    assert.match(page.text, /north/);
});

test('TAKE moves an item from the room into the character\'s inventory', async () => {
    const { clearingId, daggerId } = seedTestWorld();
    const app = createApp();
    const { agent, character } = await createGuestCharacter(app, clearingId);

    const command = await agent.post('/character/adventure/command').type('form').send({ command: 'take rusted dagger' });
    assert.equal(command.status, 302);

    const roomItem = db.prepare('SELECT * FROM room_items WHERE room_id = ? AND item_id = ?').get(clearingId, daggerId);
    assert.equal(roomItem, undefined); // only copy, so the row is gone, not just decremented

    const inventoryRow = db.prepare('SELECT quantity FROM character_items WHERE character_id = ? AND item_id = ?')
        .get(character.id, daggerId);
    assert.equal(inventoryRow.quantity, 1);

    const logRow = db.prepare('SELECT response_text FROM command_log WHERE character_id = ?').get(character.id);
    assert.match(logRow.response_text, /take the Rusted Dagger/);
});

test('TAKE on an item that is not in the room leaves the database unchanged', async () => {
    const { clearingId } = seedTestWorld();
    const app = createApp();
    const { agent, character } = await createGuestCharacter(app, clearingId);

    await agent.post('/character/adventure/command').type('form').send({ command: 'take lamp' });

    const inventoryCount = db.prepare('SELECT COUNT(*) AS count FROM character_items WHERE character_id = ?').get(character.id);
    assert.equal(inventoryCount.count, 0);

    const logRow = db.prepare('SELECT response_text FROM command_log WHERE character_id = ?').get(character.id);
    assert.match(logRow.response_text, /no lamp here/);
});

test('FIGHT acknowledges a monster in the room without resolving combat', async () => {
    const { clearingId, denId } = seedTestWorld();
    const app = createApp();
    const { agent, character } = await createGuestCharacter(app, clearingId);

    await agent.post('/character/adventure/command').type('form').send({ command: 'go north' }); // into the Wolf's Den
    const beforeFight = db.prepare('SELECT health FROM characters WHERE id = ?').get(character.id);

    const command = await agent.post('/character/adventure/command').type('form').send({ command: 'fight' });
    assert.equal(command.status, 302);

    const afterFight = db.prepare('SELECT health FROM characters WHERE id = ?').get(character.id);
    assert.equal(afterFight.health, beforeFight.health); // combat lands in Checkpoint 5, not here

    const logRow = db.prepare('SELECT response_text FROM command_log WHERE character_id = ? ORDER BY id DESC LIMIT 1').get(character.id);
    assert.match(logRow.response_text, /Ashen Wolf/);
    assert.equal(denId, db.prepare('SELECT current_room_id FROM characters WHERE id = ?').get(character.id).current_room_id);
});

test('FIGHT with no monster present says so instead of crashing', async () => {
    const { clearingId } = seedTestWorld();
    const app = createApp();
    const { agent, character } = await createGuestCharacter(app, clearingId);

    await agent.post('/character/adventure/command').type('form').send({ command: 'fight' });

    const logRow = db.prepare('SELECT response_text FROM command_log WHERE character_id = ?').get(character.id);
    assert.match(logRow.response_text, /nothing here to fight/);
});

test('submitting an empty command does not write to command_log', async () => {
    const { clearingId } = seedTestWorld();
    const app = createApp();
    const { agent, character } = await createGuestCharacter(app, clearingId);

    await agent.post('/character/adventure/command').type('form').send({ command: '   ' });

    const count = db.prepare('SELECT COUNT(*) AS count FROM command_log WHERE character_id = ?').get(character.id);
    assert.equal(count.count, 0);
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-wal`, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-shm`, { force: true });
});