// test/combatRoutes.test.js
//
// Integration tests for the Combat page and its actions (Checkpoint 5),
// hitting the real routes and checking the database afterward.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-combat.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const request = (await import('supertest')).default;

// A one-room world with a weak wolf, plus the skills the Combat page
// lists. Tests set their own fixtures the same way adventure.test.js does.
function seedCombatWorld() {
    const wolfId = db.prepare(
        'INSERT INTO monsters (name, health, attack, defense, xp_reward, gold_reward) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('Ashen Wolf', 20, 4, 1, 15, 5).lastInsertRowid;

    const denId = db.prepare(
        'INSERT INTO rooms (name, description, monster_id) VALUES (?, ?, ?)'
    ).run("Wolf's Den", 'Something growls just out of sight.', wolfId).lastInsertRowid;

    const insertSkill = db.prepare(
        'INSERT INTO skills (name, class, min_level, mana_cost, effect_type, power, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const skillIds = {
        sneak: insertSkill.run('Sneak Attack', 'Rogue', 1, 0, 'damage', 9, 'A vicious strike.').lastInsertRowid,
        firebolt: insertSkill.run('Firebolt', 'Mage', 1, 5, 'damage', 10, 'A bolt of flame.').lastInsertRowid,
        dodge: insertSkill.run('Dodge', null, 1, 0, 'utility', 0, 'Sidestep.').lastInsertRowid,
        heal: insertSkill.run('Heal', null, 1, 4, 'heal', 8, 'Mend wounds.').lastInsertRowid,
        run: insertSkill.run('Run', null, 1, 0, 'utility', 0, 'Flee.').lastInsertRowid,
    };

    return { wolfId, denId, skillIds };
}

let characterCount = 0;
async function createRogueInFight(app, denId, wolfId) {
    const agent = request.agent(app);
    const name = `Fighter${++characterCount}`;
    await agent.post('/character/new').type('form').send({ name, race: 'Fae', class: 'Rogue' });
    db.prepare('UPDATE characters SET current_room_id = ?, combat_monster_id = ?, combat_monster_health = ? WHERE name = ?')
        .run(denId, wolfId, 20, name);
    const character = db.prepare('SELECT * FROM characters WHERE name = ?').get(name);
    return { agent, character };
}

test('GET /character/combat with no run redirects to Character Creation', async () => {
    const response = await request(createApp()).get('/character/combat');
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/character/new');
});

test('GET /character/combat when not in a fight redirects to the Adventure page', async () => {
    const app = createApp();
    const agent = request.agent(app);
    await agent.post('/character/new').type('form').send({ name: 'Idle1', race: 'Fae', class: 'Rogue' });

    const response = await agent.get('/character/combat');
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/character/adventure');
});

test('the Combat page shows the monster, its health, and the character\'s actions', async () => {
    const { wolfId, denId } = seedCombatWorld();
    const app = createApp();
    const { agent } = await createRogueInFight(app, denId, wolfId);

    const page = await agent.get('/character/combat');
    assert.equal(page.status, 200);
    assert.match(page.text, /Ashen Wolf/);
    assert.match(page.text, /20 \/ 20/);
    assert.match(page.text, /Sneak Attack/); // the Rogue's own skill
    assert.match(page.text, /Dodge/);
    assert.match(page.text, /Heal/);
    assert.match(page.text, /Run/);
});

test('the Combat page only lists skills for the character\'s own class', async () => {
    const { wolfId, denId } = seedCombatWorld();
    const app = createApp();
    const { agent } = await createRogueInFight(app, denId, wolfId);

    const page = await agent.get('/character/combat');
    assert.doesNotMatch(page.text, /Firebolt/); // a Mage skill
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-wal`, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-shm`, { force: true });
});