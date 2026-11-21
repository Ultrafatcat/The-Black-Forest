// test/leaderboardFriends.test.js
//
// Integration tests for the Add-friend buttons on the public Leaderboard
// (Checkpoint 6): who sees them, what each row's button does, and that
// public pages never expose login usernames.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-lbfriends.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const request = (await import('supertest')).default;

const PASSWORD = 'Passw0rd!x1';

// Registers through the real route so the agent is logged in, gives the
// account a distinct nickname (so tests can tell nickname from username),
// and a character so the account appears on the board.
async function registerWithCharacter(app, username, { defeated = 0 } = {}) {
    const agent = request.agent(app);
    await agent.post('/register').type('form').send({ username, password: PASSWORD, confirmPassword: PASSWORD });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(`Nick${username}`, user.id);
    db.prepare(`
        INSERT INTO characters (user_id, name, race, class, health, max_health, mana, max_mana,
            strength, stamina, agility, dexterity, resilience, intelligence, luck, monsters_defeated)
        VALUES (?, ?, 'Human', 'Rogue', 20, 20, 10, 10, 5, 5, 5, 5, 5, 5, 5, ?)
    `).run(user.id, `Champ${user.id}`, defeated);
    return { agent, user };
}

// The table row for one nickname -- only rows inside <tbody>, so a message
// banner above the table that mentions the same nickname can't match instead.
function rowFor(pageText, nickname) {
    return pageText.split('<tbody>')[1].split('<tr').find((row) => row.includes(nickname));
}

function friendshipBetween(a, b) {
    return db.prepare(`
        SELECT * FROM friendships
        WHERE (requester_user_id = ? AND addressee_user_id = ?) OR (requester_user_id = ? AND addressee_user_id = ?)
    `).all(a, b, b, a);
}

function addFriendRequest(agent, userId, extra = {}) {
    return agent.post('/friends/request').type('form').send({ userId: String(userId), returnTo: 'leaderboard', ...extra });
}

test('a logged-out visitor sees the board but no friend buttons', async () => {
    const app = createApp();
    await registerWithCharacter(app, 'shown1');

    const page = await request(app).get('/leaderboard');
    assert.equal(page.status, 200);
    assert.match(page.text, /Nickshown1/);
    assert.doesNotMatch(page.text, /Add friend/);
    assert.doesNotMatch(page.text, /\/friends\/request/);
});

test('a logged-in player gets an Add friend button on other rows, not their own', async () => {
    const app = createApp();
    const { agent } = await registerWithCharacter(app, 'viewer2');
    await registerWithCharacter(app, 'other2');

    const page = await agent.get('/leaderboard');
    const ownRow = rowFor(page.text, 'Nickviewer2');
    const otherRow = rowFor(page.text, 'Nickother2');
    assert.doesNotMatch(ownRow, /Add friend/);
    assert.match(otherRow, /Add friend/);
});

test('clicking Add friend creates a pending request and returns to the board with a message', async () => {
    const app = createApp();
    const { agent, user: me } = await registerWithCharacter(app, 'viewer3');
    const { user: other } = await registerWithCharacter(app, 'other3');

    const response = await addFriendRequest(agent, other.id);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/leaderboard');

    const [row] = friendshipBetween(me.id, other.id);
    assert.equal(row.status, 'pending');
    assert.equal(row.requester_user_id, me.id);

    const page = await agent.get('/leaderboard');
    assert.match(page.text, /Friend request sent to Nickother3/);
    const otherRow = rowFor(page.text, 'Nickother3');
    assert.match(otherRow, /Request sent/);
    assert.doesNotMatch(otherRow, /Add friend/);
});

test('the success message shows once, not on the next visit', async () => {
    const app = createApp();
    const { agent } = await registerWithCharacter(app, 'viewer4');
    const { user: other } = await registerWithCharacter(app, 'other4');
    await addFriendRequest(agent, other.id);

    await agent.get('/leaderboard');
    const second = await agent.get('/leaderboard');
    assert.doesNotMatch(second.text, /Friend request sent to/);
});

test('players who are already friends show a Friends label instead of a button', async () => {
    const app = createApp();
    const { agent, user: me } = await registerWithCharacter(app, 'viewer5');
    const { user: other } = await registerWithCharacter(app, 'other5');
    db.prepare("INSERT INTO friendships (requester_user_id, addressee_user_id, status) VALUES (?, ?, 'accepted')").run(other.id, me.id);

    const page = await agent.get('/leaderboard');
    const otherRow = rowFor(page.text, 'Nickother5');
    assert.match(otherRow, /Friends/);
    assert.doesNotMatch(otherRow, /Add friend/);
});

test('a request they sent you shows Answer request, linking to the Friends page', async () => {
    const app = createApp();
    const { agent, user: me } = await registerWithCharacter(app, 'viewer6');
    const { user: other } = await registerWithCharacter(app, 'other6');
    db.prepare("INSERT INTO friendships (requester_user_id, addressee_user_id, status) VALUES (?, ?, 'pending')").run(other.id, me.id);

    const page = await agent.get('/leaderboard');
    const otherRow = rowFor(page.text, 'Nickother6');
    assert.match(otherRow, /Answer request/);
    assert.match(otherRow, /href="\/friends"/);
    assert.doesNotMatch(otherRow, /Add friend/);
});

test('after a decline the button is back, and clicking it reopens the request', async () => {
    const app = createApp();
    const { agent, user: me } = await registerWithCharacter(app, 'viewer7');
    const { user: other } = await registerWithCharacter(app, 'other7');
    db.prepare("INSERT INTO friendships (requester_user_id, addressee_user_id, status) VALUES (?, ?, 'declined')").run(me.id, other.id);

    const page = await agent.get('/leaderboard');
    assert.match(rowFor(page.text, 'Nickother7'), /Add friend/);

    await addFriendRequest(agent, other.id);
    const rows = friendshipBetween(me.id, other.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'pending');
});

test('the public board never shows login usernames, only nicknames', async () => {
    const app = createApp();
    const { agent } = await registerWithCharacter(app, 'viewer8');
    await registerWithCharacter(app, 'secretlogin8');

    const page = await agent.get('/leaderboard');
    assert.match(page.text, /Nicksecretlogin8/);
    // The username is a substring of the nickname, so check it never appears on its own.
    assert.doesNotMatch(page.text.replace(/Nicksecretlogin8/g, ''), /secretlogin8/);
});

test('adding a player that does not exist reports the error on the board and creates nothing', async () => {
    const app = createApp();
    const { agent, user: me } = await registerWithCharacter(app, 'viewer9');
    const before = db.prepare('SELECT COUNT(*) AS c FROM friendships WHERE requester_user_id = ?').get(me.id).c;

    const response = await addFriendRequest(agent, 999999);
    assert.equal(response.headers.location, '/leaderboard');

    const page = await agent.get('/leaderboard');
    assert.match(page.text, /That player was not found/);
    assert.match(page.text, /alert-danger/);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM friendships WHERE requester_user_id = ?').get(me.id).c, before);
});

test('you cannot add yourself even by posting your own id', async () => {
    const app = createApp();
    const { agent, user: me } = await registerWithCharacter(app, 'viewer10');

    await addFriendRequest(agent, me.id);

    assert.equal(friendshipBetween(me.id, me.id).length, 0);
    const page = await agent.get('/leaderboard');
    assert.match(page.text, /yourself/);
});

test('clicking twice does not create a duplicate request', async () => {
    const app = createApp();
    const { agent, user: me } = await registerWithCharacter(app, 'viewer11');
    const { user: other } = await registerWithCharacter(app, 'other11');

    await addFriendRequest(agent, other.id);
    await addFriendRequest(agent, other.id);

    assert.equal(friendshipBetween(me.id, other.id).length, 1);
});

test('a junk id is rejected like a missing player', async () => {
    const app = createApp();
    const { agent } = await registerWithCharacter(app, 'viewer12');

    const response = await addFriendRequest(agent, 'abc');
    assert.equal(response.headers.location, '/leaderboard');
    assert.match((await agent.get('/leaderboard')).text, /not found|No player named/);
});

test('an unrecognized returnTo falls back to the Friends page', async () => {
    const app = createApp();
    const { agent } = await registerWithCharacter(app, 'viewer13');
    const { user: other } = await registerWithCharacter(app, 'other13');

    const response = await addFriendRequest(agent, other.id, { returnTo: 'https://evil.example' });
    assert.equal(response.headers.location, '/friends');
});

test('a logged-out POST is sent to Login and creates nothing', async () => {
    const app = createApp();
    const { user: other } = await registerWithCharacter(app, 'other14');
    const response = await request(app).post('/friends/request').type('form').send({ userId: String(other.id), returnTo: 'leaderboard' });
    assert.equal(response.headers.location, '/login');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM friendships WHERE addressee_user_id = ?').get(other.id).c, 0);
});

test('the friends-only board has no Add friend buttons, since everyone on it is a friend', async () => {
    const app = createApp();
    const { agent, user: me } = await registerWithCharacter(app, 'viewer15');
    const { user: other } = await registerWithCharacter(app, 'other15');
    db.prepare("INSERT INTO friendships (requester_user_id, addressee_user_id, status) VALUES (?, ?, 'accepted')").run(me.id, other.id);

    const page = await agent.get('/friends/leaderboard');
    assert.match(page.text, /Nickother15/);
    assert.doesNotMatch(page.text, /Add friend/);
});

test('typing a username on the Friends page still works as before', async () => {
    const app = createApp();
    const { agent, user: me } = await registerWithCharacter(app, 'viewer16');
    const { user: other } = await registerWithCharacter(app, 'other16');

    const response = await agent.post('/friends/request').type('form').send({ username: 'other16' });
    assert.equal(response.headers.location, '/friends');
    assert.equal(friendshipBetween(me.id, other.id).length, 1);
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-wal`, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-shm`, { force: true });
});