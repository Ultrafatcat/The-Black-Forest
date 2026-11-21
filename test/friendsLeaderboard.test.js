// test/friendsLeaderboard.test.js
//
// Integration tests for the friends-only leaderboard (Checkpoint 6): who is
// in the group, that ranking matches the public board, and that privacy is
// ignored for friends. Accounts, characters and friendships are inserted
// directly; the routes and rules have their own tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-friendslb.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const { getFriendsLeaderboard, getPublicLeaderboard } = await import('../server/leaderboard.js');
const request = (await import('supertest')).default;

const PASSWORD = 'Passw0rd!x1';

// Registers through the real route so the agent is logged in.
async function register(app, username) {
    const agent = request.agent(app);
    await agent.post('/register').type('form').send({ username, password: PASSWORD, confirmPassword: PASSWORD });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    return { agent, user };
}

function addUser(username, { isPublic = 1 } = {}) {
    return Number(db.prepare('INSERT INTO users (username, nickname, password_hash, is_public) VALUES (?, ?, ?, ?)')
        .run(username, username, 'not-a-real-hash', isPublic).lastInsertRowid);
}

function addCharacter(userId, { name = 'Hero', level = 1, defeated = 0, explored = 0 } = {}) {
    return Number(db.prepare(`
        INSERT INTO characters (user_id, name, race, class, level, health, max_health, mana, max_mana,
            strength, stamina, agility, dexterity, resilience, intelligence, luck, monsters_defeated, rooms_explored)
        VALUES (?, ?, 'Human', 'Rogue', ?, 20, 20, 10, 10, 5, 5, 5, 5, 5, 5, 5, ?, ?)
    `).run(userId, name, level, defeated, explored).lastInsertRowid);
}

function makeFriends(requesterId, addresseeId, status = 'accepted') {
    db.prepare('INSERT INTO friendships (requester_user_id, addressee_user_id, status) VALUES (?, ?, ?)')
        .run(requesterId, addresseeId, status);
}

test('the friends board contains you and your accepted friends, ranked', () => {
    const me = addUser('me1');
    const ann = addUser('ann1');
    const bob = addUser('bob1');
    addCharacter(me, { defeated: 2, explored: 1 });   // 3
    addCharacter(ann, { defeated: 5, explored: 5 });  // 10
    addCharacter(bob, { defeated: 3, explored: 3 });  // 6
    makeFriends(me, ann);
    makeFriends(bob, me); // the other direction

    const board = getFriendsLeaderboard(db, me);
    assert.deepEqual(board.map((e) => e.nickname), ['ann1', 'bob1', 'me1']);
    assert.deepEqual(board.map((e) => e.rank), [1, 2, 3]);
});

test('strangers, pending requests and declined requests are left out', () => {
    const me = addUser('me2');
    const stranger = addUser('stranger2');
    const pending = addUser('pending2');
    const declined = addUser('declined2');
    const friend = addUser('friend2');
    for (const id of [me, stranger, pending, declined, friend]) addCharacter(id, { defeated: 1 });
    makeFriends(me, pending, 'pending');
    makeFriends(declined, me, 'declined');
    makeFriends(me, friend);

    const names = getFriendsLeaderboard(db, me).map((e) => e.nickname).sort();
    assert.deepEqual(names, ['friend2', 'me2']);
});

test('the friends board ignores other people\'s friendships', () => {
    const me = addUser('me3');
    const a = addUser('pal3a');
    const b = addUser('pal3b');
    for (const id of [me, a, b]) addCharacter(id, { defeated: 1 });
    makeFriends(a, b); // friends with each other, not with me

    assert.deepEqual(getFriendsLeaderboard(db, me).map((e) => e.nickname), ['me3']);
});

test('private accounts are included for friends, and for yourself', () => {
    const me = addUser('me4', { isPublic: 0 });
    const friend = addUser('friend4', { isPublic: 0 });
    addCharacter(me, { defeated: 1 });
    addCharacter(friend, { defeated: 9 });
    makeFriends(me, friend);

    assert.deepEqual(getFriendsLeaderboard(db, me).map((e) => e.nickname), ['friend4', 'me4']);
    // ...while the PUBLIC board still hides them.
    const publicNames = getPublicLeaderboard(db).map((e) => e.nickname);
    assert.ok(!publicNames.includes('friend4'));
    assert.ok(!publicNames.includes('me4'));
});

test('level breaks a tie on the friends board too', () => {
    const me = addUser('me5');
    const friend = addUser('friend5');
    addCharacter(me, { level: 1, defeated: 2, explored: 2 });
    addCharacter(friend, { level: 3, defeated: 3, explored: 1 });
    makeFriends(me, friend);

    assert.deepEqual(getFriendsLeaderboard(db, me).map((e) => e.nickname), ['friend5', 'me5']);
});

test('each friend appears once, with their newest character', () => {
    const me = addUser('me6');
    const friend = addUser('friend6');
    addCharacter(me);
    addCharacter(friend, { name: 'OldRun', defeated: 40 });
    addCharacter(friend, { name: 'NewRun', defeated: 1 });
    makeFriends(me, friend);

    const entries = getFriendsLeaderboard(db, me).filter((e) => e.nickname === 'friend6');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].characterName, 'NewRun');
});

test('a friend with no character is skipped rather than breaking the board', () => {
    const me = addUser('me7');
    const friend = addUser('friend7');
    addCharacter(me, { defeated: 1 });
    makeFriends(me, friend);

    assert.deepEqual(getFriendsLeaderboard(db, me).map((e) => e.nickname), ['me7']);
});

test('GET /friends/leaderboard sends a logged-out visitor to Login', async () => {
    const response = await request(createApp()).get('/friends/leaderboard');
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/login');
});

test('the friends board page shows the group, marks you, and leaves strangers off', async () => {
    const app = createApp();
    const { agent, user: me } = await register(app, 'viewer8');
    const friend = addUser('friend8');
    const stranger = addUser('stranger8');
    addCharacter(me.id, { name: 'MyHero', defeated: 1 });
    addCharacter(friend, { name: 'FriendHero', defeated: 4 });
    addCharacter(stranger, { name: 'StrangerHero', defeated: 50 });
    makeFriends(me.id, friend);

    const page = await agent.get('/friends/leaderboard');
    assert.equal(page.status, 200);
    assert.match(page.text, /Friends Leaderboard/);
    assert.match(page.text, /FriendHero/);
    assert.match(page.text, /MyHero/);
    assert.match(page.text, /text-bg-success ms-2">You/);
    assert.doesNotMatch(page.text, /StrangerHero/);
    assert.ok(page.text.indexOf('FriendHero') < page.text.indexOf('MyHero'), 'higher score first');
});

test('a player with no friends and no character sees the empty message', async () => {
    const { agent } = await register(createApp(), 'loner9');
    const page = await agent.get('/friends/leaderboard');
    assert.equal(page.status, 200);
    assert.match(page.text, /Nobody in your friend group has a character yet/);
});

test('the Friends page links to the friends leaderboard, and the public board is unchanged', async () => {
    const app = createApp();
    const { agent } = await register(app, 'viewer10');
    assert.match((await agent.get('/friends')).text, /href="\/friends\/leaderboard"/);

    const publicPage = await request(app).get('/leaderboard');
    assert.match(publicPage.text, />Leaderboard</);
    assert.doesNotMatch(publicPage.text, /Friends Leaderboard/);
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-wal`, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-shm`, { force: true });
});