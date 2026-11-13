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

function setCharacter(name, fields) {
    for (const [column, value] of Object.entries(fields)) {
        db.prepare(`UPDATE characters SET ${column} = ? WHERE name = ?`).run(value, name);
    }
}

function post(agent, skillId) {
    return agent.post('/character/combat/action').type('form').send({ skillId: String(skillId) });
}

test('an attack that does not finish the monster keeps the fight going', async () => {
    const { wolfId, denId, skillIds } = seedCombatWorld();
    const app = createApp();
    const { agent, character } = await createRogueInFight(app, denId, wolfId);
    setCharacter(character.name, { health: 40, max_health: 40, resilience: 0 });

    const response = await post(agent, skillIds.sneak);
    assert.equal(response.headers.location, '/character/combat');

    const after = db.prepare('SELECT * FROM characters WHERE id = ?').get(character.id);
    assert.equal(after.combat_monster_health, 12); // 20 - (9 - 1)
    assert.equal(after.health, 36); // wolf hits back for 4
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM combat_logs WHERE character_id = ?').get(character.id).c, 0);

    const page = await agent.get('/character/combat');
    assert.match(page.text, /You use Sneak Attack for 8 damage/);
});

test('winning awards XP and gold, logs a victory, and clears the fight', async () => {
    const { wolfId, denId, skillIds } = seedCombatWorld();
    const app = createApp();
    const { agent, character } = await createRogueInFight(app, denId, wolfId);
    db.prepare('UPDATE characters SET combat_monster_health = 5 WHERE id = ?').run(character.id);

    const response = await post(agent, skillIds.sneak);
    assert.equal(response.headers.location, '/character/adventure');

    const after = db.prepare('SELECT * FROM characters WHERE id = ?').get(character.id);
    assert.equal(after.xp, 15);
    assert.equal(after.gold, 5);
    assert.equal(after.monsters_defeated, 1);
    assert.equal(after.combat_monster_id, null);
    assert.equal(after.combat_monster_health, null);

    const logRow = db.prepare('SELECT * FROM combat_logs WHERE character_id = ?').get(character.id);
    assert.equal(logRow.outcome, 'victory');
    assert.equal(logRow.xp_gained, 15);
    assert.equal(logRow.gold_gained, 5);
});

test('winning with enough XP levels the character up and grants Attribute Points', async () => {
    const { wolfId, denId, skillIds } = seedCombatWorld();
    const app = createApp();
    const { agent, character } = await createRogueInFight(app, denId, wolfId);
    db.prepare('UPDATE characters SET combat_monster_health = 5, xp = 40, attribute_points = 0 WHERE id = ?').run(character.id);

    await post(agent, skillIds.sneak);

    const after = db.prepare('SELECT * FROM characters WHERE id = ?').get(character.id);
    assert.equal(after.level, 2);
    assert.equal(after.xp, 5); // 40 + 15 - 50
    assert.equal(after.attribute_points, 3);
    assert.equal(after.max_health, character.max_health + 5);

    const logRow = db.prepare('SELECT response_text FROM command_log WHERE character_id = ? ORDER BY id DESC LIMIT 1').get(character.id);
    assert.match(logRow.response_text, /level 2/);
});

test('losing logs a defeat, leaves the character on 1 health, and ends the fight', async () => {
    const { wolfId, denId, skillIds } = seedCombatWorld();
    const app = createApp();
    const { agent, character } = await createRogueInFight(app, denId, wolfId);
    setCharacter(character.name, { health: 2, resilience: 0 });

    const response = await post(agent, skillIds.sneak);
    assert.equal(response.headers.location, '/character/adventure');

    const after = db.prepare('SELECT * FROM characters WHERE id = ?').get(character.id);
    assert.equal(after.health, 1);
    assert.equal(after.xp, 0);
    assert.equal(after.combat_monster_id, null);

    const logRow = db.prepare('SELECT outcome, xp_gained FROM combat_logs WHERE character_id = ?').get(character.id);
    assert.equal(logRow.outcome, 'defeat');
    assert.equal(logRow.xp_gained, 0);
});

test('Run ends the fight with a fled log and no rewards', async () => {
    const { wolfId, denId, skillIds } = seedCombatWorld();
    const app = createApp();
    const { agent, character } = await createRogueInFight(app, denId, wolfId);

    const response = await post(agent, skillIds.run);
    assert.equal(response.headers.location, '/character/adventure');

    const after = db.prepare('SELECT * FROM characters WHERE id = ?').get(character.id);
    assert.equal(after.combat_monster_id, null);
    assert.equal(after.xp, 0);
    assert.equal(after.health, character.health); // no parting hit

    assert.equal(db.prepare('SELECT outcome FROM combat_logs WHERE character_id = ?').get(character.id).outcome, 'fled');
});

test('Dodge spends no health and no monster HP', async () => {
    const { wolfId, denId, skillIds } = seedCombatWorld();
    const app = createApp();
    const { agent, character } = await createRogueInFight(app, denId, wolfId);

    await post(agent, skillIds.dodge);

    const after = db.prepare('SELECT health, combat_monster_health FROM characters WHERE id = ?').get(character.id);
    assert.equal(after.health, character.health);
    assert.equal(after.combat_monster_health, 20);
});

test('an action the character cannot afford is rejected without using a turn', async () => {
    const { wolfId, denId, skillIds } = seedCombatWorld();
    const app = createApp();
    const { agent, character } = await createRogueInFight(app, denId, wolfId);
    setCharacter(character.name, { mana: 1 });

    await post(agent, skillIds.heal); // costs 4 mana

    const after = db.prepare('SELECT health, mana, combat_monster_health FROM characters WHERE id = ?').get(character.id);
    assert.equal(after.health, character.health);
    assert.equal(after.mana, 1);
    assert.equal(after.combat_monster_health, 20);

    const page = await agent.get('/character/combat');
    assert.match(page.text, /Not enough mana for Heal/);
});

test('a skill from another class cannot be used', async () => {
    const { wolfId, denId, skillIds } = seedCombatWorld();
    const app = createApp();
    const { agent, character } = await createRogueInFight(app, denId, wolfId);

    await post(agent, skillIds.firebolt); // Mage skill, character is a Rogue

    const after = db.prepare('SELECT combat_monster_health FROM characters WHERE id = ?').get(character.id);
    assert.equal(after.combat_monster_health, 20);
});

test('POST /character/combat/action when not in a fight redirects to the Adventure page', async () => {
    const { skillIds } = seedCombatWorld();
    const app = createApp();
    const agent = request.agent(app);
    await agent.post('/character/new').type('form').send({ name: 'Idle2', race: 'Fae', class: 'Rogue' });

    const response = await post(agent, skillIds.sneak);
    assert.equal(response.headers.location, '/character/adventure');
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-wal`, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-shm`, { force: true });
});