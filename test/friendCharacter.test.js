// test/friendCharacter.test.js
//
// Integration tests for viewing a friend's character sheet (Checkpoint 6):
// who may see it, that it's read-only, and that it ignores the friend's
// public/private Leaderboard setting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-friendchar.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const request = (await import('supertest')).default;

const PASSWORD = 'Passw0rd!x1';

async function register(app, username) {
    const agent = request.agent(app);
    await agent.post('/register').type('form').send({ username, password: PASSWORD, confirmPassword: PASSWORD });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    return { agent, user };
}

function addCharacter(userId, { name = 'Hero', level = 1, defeated = 0, explored = 0 } = {}) {
    return Number(db.prepare(`
        INSERT INTO characters (user_id, name, race, class, level, health, max_health, mana, max_mana,
            strength, stamina, agility, dexterity, resilience, intelligence, luck, monsters_defeated, rooms_explored, gold)
        VALUES (?, ?, 'Elf', 'Archer', ?, 17, 30, 8, 12, 9, 5, 5, 7, 5, 5, 5, ?, ?, 42)
    `).run(userId, name, level, defeated, explored).lastInsertRowid);
}

function makeFriends(requesterId, addresseeId, status = 'accepted') {
    db.prepare('INSERT INTO friendships (requester_user_id, addressee_user_id, status) VALUES (?, ?, ?)')
        .run(requesterId, addresseeId, status);
}

test('a logged-out visitor is sent to Login', async () => {
    const response = await request(createApp()).get('/friends/1/character');
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/login');
});

test('a friend can view the other friend\'s full stats', async () => {
    const app = createApp();
    const { agent, user: me } = await register(app, 'viewer1');
    const { user: friend } = await register(app, 'friend1');
    addCharacter(friend.id, { name: 'Lyra', level: 4, defeated: 6, explored: 11 });
    makeFriends(me.id, friend.id);

    const page = await agent.get(`/friends/${friend.id}/character`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Lyra/);
    assert.match(page.text, /Elf Archer/);
    assert.match(page.text, /Level 4/);
    assert.match(page.text, /17 \/ 30/);          // health
    assert.match(page.text, /Monsters defeated/);
    assert.match(page.text, /<span>6<\/span>/);   // defeated
    assert.match(page.text, /<span>11<\/span>/);  // explored
});

test('it works from either side of the friendship', async () => {
    const app = createApp();
    const { agent: askerAgent, user: asker } = await register(app, 'asker2');
    const { agent: targetAgent, user: target } = await register(app, 'target2');
    addCharacter(asker.id, { name: 'AskerHero' });
    addCharacter(target.id, { name: 'TargetHero' });
    makeFriends(asker.id, target.id);

    assert.match((await askerAgent.get(`/friends/${target.id}/character`)).text, /TargetHero/);
    assert.match((await targetAgent.get(`/friends/${asker.id}/character`)).text, /AskerHero/);
});

test('the sheet is read-only: no attribute-point form is offered', async () => {
    const app = createApp();
    const { agent, user: me } = await register(app, 'viewer3');
    const { user: friend } = await register(app, 'friend3');
    db.prepare('UPDATE characters SET attribute_points = 5 WHERE id = ?').run(addCharacter(friend.id));
    makeFriends(me.id, friend.id);

    const page = await agent.get(`/friends/${friend.id}/character`);
    assert.doesNotMatch(page.text, /\/character\/attributes/);
    assert.doesNotMatch(page.text, /Spend Attribute Points|Allocate/);
});

test('a friend who is private on the Leaderboard can still be viewed', async () => {
    const app = createApp();
    const { agent, user: me } = await register(app, 'viewer4');
    const { user: friend } = await register(app, 'friend4');
    db.prepare('UPDATE users SET is_public = 0 WHERE id = ?').run(friend.id);
    addCharacter(friend.id, { name: 'ShadowFriend' });
    makeFriends(me.id, friend.id);

    const page = await agent.get(`/friends/${friend.id}/character`);
    assert.equal(page.status, 200);
    assert.match(page.text, /ShadowFriend/);
});

test('a stranger cannot view someone\'s character', async () => {
    const app = createApp();
    const { agent } = await register(app, 'stranger5');
    const { user: target } = await register(app, 'target5');
    addCharacter(target.id, { name: 'SecretHero' });

    const page = await agent.get(`/friends/${target.id}/character`);
    assert.equal(page.status, 404);
    assert.doesNotMatch(page.text, /SecretHero/);
});

test('a pending or declined request does not grant access', async () => {
    const app = createApp();
    const { agent, user: me } = await register(app, 'viewer6');
    const { user: pending } = await register(app, 'pending6');
    const { user: declined } = await register(app, 'declined6');
    addCharacter(pending.id, { name: 'PendingHero' });
    addCharacter(declined.id, { name: 'DeclinedHero' });
    makeFriends(me.id, pending.id, 'pending');
    makeFriends(declined.id, me.id, 'declined');

    const pendingPage = await agent.get(`/friends/${pending.id}/character`);
    assert.equal(pendingPage.status, 404);
    assert.doesNotMatch(pendingPage.text, /PendingHero/);
    const declinedPage = await agent.get(`/friends/${declined.id}/character`);
    assert.equal(declinedPage.status, 404);
    assert.doesNotMatch(declinedPage.text, /DeclinedHero/);
});

test('a friendship between two other players does not let a third player in', async () => {
    const app = createApp();
    const { agent } = await register(app, 'outsider7');
    const { user: a } = await register(app, 'pal7a');
    const { user: b } = await register(app, 'pal7b');
    addCharacter(b.id, { name: 'PalHero' });
    makeFriends(a.id, b.id);

    const page = await agent.get(`/friends/${b.id}/character`);
    assert.equal(page.status, 404);
});

test('a player that does not exist and a stranger look identical', async () => {
    const { agent } = await register(createApp(), 'viewer8');
    const missing = await agent.get('/friends/999999/character');
    const junk = await agent.get('/friends/abc/character');
    assert.equal(missing.status, 404);
    assert.equal(junk.status, 404);
});

test('a friend with no character yet gets a friendly message', async () => {
    const app = createApp();
    const { agent, user: me } = await register(app, 'viewer9');
    const { user: friend } = await register(app, 'newbie9');
    makeFriends(me.id, friend.id);

    const page = await agent.get(`/friends/${friend.id}/character`);
    assert.equal(page.status, 200);
    assert.match(page.text, /hasn't started a character yet/);
});

test('when a friend has several characters, the newest one is shown', async () => {
    const app = createApp();
    const { agent, user: me } = await register(app, 'viewer10');
    const { user: friend } = await register(app, 'friend10');
    addCharacter(friend.id, { name: 'OldRun' });
    addCharacter(friend.id, { name: 'NewRun' });
    makeFriends(me.id, friend.id);

    const page = await agent.get(`/friends/${friend.id}/character`);
    assert.match(page.text, /NewRun/);
    assert.doesNotMatch(page.text, /OldRun/);
});

test('the Friends page links each friend to their sheet', async () => {
    const app = createApp();
    const { agent, user: me } = await register(app, 'viewer11');
    const { user: friend } = await register(app, 'friend11');
    makeFriends(me.id, friend.id);

    const page = await agent.get('/friends');
    assert.match(page.text, new RegExp(`href="/friends/${friend.id}/character"`));
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-wal`, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-shm`, { force: true });
});