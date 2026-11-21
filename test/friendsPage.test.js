// test/friendsPage.test.js
//
// Integration tests for the Friends page (Checkpoint 6): sending, answering
// and listing friend requests through the real routes, checking the
// friendships table afterward -- the rules themselves are unit tested in
// friends.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-friendspage.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const request = (await import('supertest')).default;

const PASSWORD = 'Passw0rd!x1';

// Registers an account through the real route (which also logs it in) and
// returns the agent plus its user row.
async function register(app, username) {
    const agent = request.agent(app);
    await agent.post('/register').type('form').send({ username, password: PASSWORD, confirmPassword: PASSWORD });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    return { agent, user };
}

function sendRequest(agent, username) {
    return agent.post('/friends/request').type('form').send({ username });
}

function respond(agent, friendshipId, decision) {
    return agent.post(`/friends/${friendshipId}/respond`).type('form').send({ decision });
}

function friendshipBetween(a, b) {
    return db.prepare(`
        SELECT * FROM friendships
        WHERE (requester_user_id = ? AND addressee_user_id = ?) OR (requester_user_id = ? AND addressee_user_id = ?)
    `).all(a, b, b, a);
}

test('the Friends page sends a logged-out visitor to Login', async () => {
    const app = createApp();
    const page = await request(app).get('/friends');
    assert.equal(page.status, 302);
    assert.equal(page.headers.location, '/login');

    const post = await request(app).post('/friends/request').type('form').send({ username: 'anyone' });
    assert.equal(post.headers.location, '/login');

    const answer = await request(app).post('/friends/1/respond').type('form').send({ decision: 'accept' });
    assert.equal(answer.headers.location, '/login');
});

test('a logged-in player with no friends sees an empty state', async () => {
    const { agent } = await register(createApp(), 'loner1');
    const page = await agent.get('/friends');
    assert.equal(page.status, 200);
    assert.match(page.text, /No friends yet/);
});

test('sending a request creates a pending friendship and shows it as waiting', async () => {
    const app = createApp();
    const { agent: meAgent, user: me } = await register(app, 'sender1');
    const { user: ann } = await register(app, 'target1');

    const response = await sendRequest(meAgent, 'target1');
    assert.equal(response.headers.location, '/friends');

    const rows = friendshipBetween(me.id, ann.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'pending');
    assert.equal(rows[0].requester_user_id, me.id);
    assert.equal(rows[0].addressee_user_id, ann.id);

    const page = await meAgent.get('/friends');
    assert.match(page.text, /Friend request sent to target1/);
    assert.match(page.text, /Waiting for an answer/);
});

test('the success message shows once, not again on refresh', async () => {
    const app = createApp();
    const { agent } = await register(app, 'sender2');
    await register(app, 'target2');
    await sendRequest(agent, 'target2');

    await agent.get('/friends');
    const second = await agent.get('/friends');
    assert.doesNotMatch(second.text, /Friend request sent to/);
});

test('the username lookup ignores case', async () => {
    const app = createApp();
    const { agent, user: me } = await register(app, 'sender3');
    const { user: target } = await register(app, 'casey3');

    await sendRequest(agent, '  CASEY3  ');

    assert.equal(friendshipBetween(me.id, target.id).length, 1);
});

test('when two accounts differ only by case, the exact match is chosen', async () => {
    const app = createApp();
    const { agent, user: me } = await register(app, 'sender4');
    const { user: lower } = await register(app, 'twin4');
    const { user: upper } = await register(app, 'TWIN4');

    await sendRequest(agent, 'TWIN4');

    assert.equal(friendshipBetween(me.id, upper.id).length, 1);
    assert.equal(friendshipBetween(me.id, lower.id).length, 0);
});

test('an unknown username shows an error and creates nothing', async () => {
    const { agent, user: me } = await register(createApp(), 'sender5');
    const before = db.prepare('SELECT COUNT(*) AS c FROM friendships WHERE requester_user_id = ?').get(me.id).c;

    const response = await sendRequest(agent, 'nobodyhere5');
    assert.equal(response.status, 400);
    assert.match(response.text, /No player named/);
    assert.match(response.text, /nobodyhere5/); // typed name stays in the box

    const after = db.prepare('SELECT COUNT(*) AS c FROM friendships WHERE requester_user_id = ?').get(me.id).c;
    assert.equal(after, before);
});

test('you cannot send a request to yourself', async () => {
    const { agent, user: me } = await register(createApp(), 'selfie6');
    const response = await sendRequest(agent, 'selfie6');
    assert.equal(response.status, 400);
    assert.match(response.text, /yourself/);
    assert.equal(friendshipBetween(me.id, me.id).length, 0);
});

test('sending the same request twice does not create a second row', async () => {
    const app = createApp();
    const { agent, user: me } = await register(app, 'sender7');
    const { user: target } = await register(app, 'target7');

    await sendRequest(agent, 'target7');
    const again = await sendRequest(agent, 'target7');

    assert.equal(again.status, 400);
    assert.match(again.text, /already sent/);
    assert.equal(friendshipBetween(me.id, target.id).length, 1);
});

test('the player who was asked sees the request and can accept it', async () => {
    const app = createApp();
    const { agent: askerAgent, user: asker } = await register(app, 'asker8');
    const { agent: targetAgent, user: target } = await register(app, 'target8');
    await sendRequest(askerAgent, 'target8');

    const inbox = await targetAgent.get('/friends');
    assert.match(inbox.text, /Requests for you/);
    assert.match(inbox.text, /asker8/);

    const [friendship] = friendshipBetween(asker.id, target.id);
    const accepted = await respond(targetAgent, friendship.id, 'accept');
    assert.equal(accepted.headers.location, '/friends');
    assert.equal(friendshipBetween(asker.id, target.id)[0].status, 'accepted');

    // Both players now list each other as friends.
    const targetPage = await targetAgent.get('/friends');
    assert.match(targetPage.text, /Friend request accepted/);
    assert.match(targetPage.text, /Your friends/);
    assert.match(targetPage.text, /asker8/);
    const askerPage = await askerAgent.get('/friends');
    assert.match(askerPage.text, /target8/);
    assert.doesNotMatch(askerPage.text, /Waiting for an answer/);
});

test('declining a request does not make them friends', async () => {
    const app = createApp();
    const { agent: askerAgent, user: asker } = await register(app, 'asker9');
    const { agent: targetAgent, user: target } = await register(app, 'target9');
    await sendRequest(askerAgent, 'target9');
    const [friendship] = friendshipBetween(asker.id, target.id);

    await respond(targetAgent, friendship.id, 'decline');

    assert.equal(friendshipBetween(asker.id, target.id)[0].status, 'declined');
    const askerPage = await askerAgent.get('/friends');
    assert.match(askerPage.text, /No friends yet/);
});

test('after a decline, the asker can send again and it reopens the same row', async () => {
    const app = createApp();
    const { agent: askerAgent, user: asker } = await register(app, 'asker10');
    const { agent: targetAgent, user: target } = await register(app, 'target10');
    await sendRequest(askerAgent, 'target10');
    const [friendship] = friendshipBetween(asker.id, target.id);
    await respond(targetAgent, friendship.id, 'decline');

    await sendRequest(askerAgent, 'target10');

    const rows = friendshipBetween(asker.id, target.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, friendship.id);
    assert.equal(rows[0].status, 'pending');
});

test('a player cannot accept a request they sent themselves', async () => {
    const app = createApp();
    const { agent: askerAgent, user: asker } = await register(app, 'asker11');
    const { user: target } = await register(app, 'target11');
    await sendRequest(askerAgent, 'target11');
    const [friendship] = friendshipBetween(asker.id, target.id);

    const response = await respond(askerAgent, friendship.id, 'accept');

    assert.equal(response.status, 400);
    assert.equal(friendshipBetween(asker.id, target.id)[0].status, 'pending');
});

test('a third player cannot answer someone else\'s request', async () => {
    const app = createApp();
    const { agent: askerAgent, user: asker } = await register(app, 'asker12');
    const { user: target } = await register(app, 'target12');
    const { agent: strangerAgent } = await register(app, 'stranger12');
    await sendRequest(askerAgent, 'target12');
    const [friendship] = friendshipBetween(asker.id, target.id);

    const response = await respond(strangerAgent, friendship.id, 'accept');

    assert.equal(response.status, 400);
    assert.equal(friendshipBetween(asker.id, target.id)[0].status, 'pending');
});

test('answering a request that does not exist is reported, not a crash', async () => {
    const { agent } = await register(createApp(), 'lost13');
    const response = await respond(agent, 999999, 'accept');
    assert.equal(response.status, 400);
    assert.match(response.text, /not found/);
});

test('the friends list shows each friend\'s newest character', async () => {
    const app = createApp();
    const { agent: askerAgent, user: asker } = await register(app, 'asker14');
    const { agent: targetAgent, user: target } = await register(app, 'target14');
    db.prepare(`
        INSERT INTO characters (user_id, name, race, class, level, health, max_health, mana, max_mana,
            strength, stamina, agility, dexterity, resilience, intelligence, luck)
        VALUES (?, 'Brienne', 'Human', 'Paladin', 3, 20, 20, 10, 10, 5, 5, 5, 5, 5, 5, 5)
    `).run(target.id);
    await sendRequest(askerAgent, 'target14');
    const [friendship] = friendshipBetween(asker.id, target.id);
    await respond(targetAgent, friendship.id, 'accept');

    const page = await askerAgent.get('/friends');
    assert.match(page.text, /Brienne/);
    assert.match(page.text, /Paladin, level 3/);
});

test('the menu shows a Friends link to logged-in players only', async () => {
    const app = createApp();
    const { agent } = await register(app, 'menu15');
    assert.match((await agent.get('/')).text, /href="\/friends"/);
    assert.doesNotMatch((await request(app).get('/')).text, /href="\/friends"/);
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-wal`, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-shm`, { force: true });
});