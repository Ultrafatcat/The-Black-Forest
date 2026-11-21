// test/leaderboard.test.js
//
// Integration tests for the Leaderboard page (Checkpoint 6): ranking,
// tiebreaks, privacy filtering, the top-20 limit, and one entry per account.
// Accounts and characters are inserted directly -- registration and
// character creation have their own tests elsewhere.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-leaderboard.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const { getPublicLeaderboard } = await import('../server/leaderboard.js');
const request = (await import('supertest')).default;

// Start every test from an empty board so each one controls exactly who is on it.
beforeEach(() => {
    db.exec('DELETE FROM characters');
    db.exec('DELETE FROM users');
});

function addUser(nickname, { isPublic = 1 } = {}) {
    return Number(db.prepare('INSERT INTO users (username, nickname, password_hash, is_public) VALUES (?, ?, ?, ?)')
        .run(nickname.toLowerCase(), nickname, 'not-a-real-hash', isPublic).lastInsertRowid);
}

function addCharacter(userId, { name = 'Hero', level = 1, defeated = 0, explored = 0 } = {}) {
    return Number(db.prepare(`
        INSERT INTO characters (user_id, name, race, class, level, health, max_health, mana, max_mana,
            strength, stamina, agility, dexterity, resilience, intelligence, luck, monsters_defeated, rooms_explored)
        VALUES (?, ?, 'Human', 'Rogue', ?, 20, 20, 10, 10, 5, 5, 5, 5, 5, 5, 5, ?, ?)
    `).run(userId, name, level, defeated, explored).lastInsertRowid);
}

test('ranks by monsters defeated plus rooms explored, highest first', () => {
    addCharacter(addUser('Low'), { defeated: 1, explored: 2 });   // 3
    addCharacter(addUser('High'), { defeated: 5, explored: 4 });  // 9
    addCharacter(addUser('Mid'), { defeated: 3, explored: 3 });   // 6

    const board = getPublicLeaderboard(db);
    assert.deepEqual(board.map((e) => e.nickname), ['High', 'Mid', 'Low']);
    assert.deepEqual(board.map((e) => e.score), [9, 6, 3]);
    assert.deepEqual(board.map((e) => e.rank), [1, 2, 3]);
});

test('defeats and exploring count together, not separately', () => {
    addCharacter(addUser('Fighter'), { defeated: 8, explored: 0 });  // 8
    addCharacter(addUser('Wanderer'), { defeated: 0, explored: 9 }); // 9

    const board = getPublicLeaderboard(db);
    assert.deepEqual(board.map((e) => e.nickname), ['Wanderer', 'Fighter']);
});

test('level breaks a tie in score', () => {
    addCharacter(addUser('Novice'), { level: 1, defeated: 2, explored: 2 });
    addCharacter(addUser('Veteran'), { level: 4, defeated: 3, explored: 1 });

    const board = getPublicLeaderboard(db);
    assert.equal(board[0].score, board[1].score);
    assert.deepEqual(board.map((e) => e.nickname), ['Veteran', 'Novice']);
});

test('accounts marked private are excluded', () => {
    addCharacter(addUser('Public'), { defeated: 1 });
    addCharacter(addUser('Hidden', { isPublic: 0 }), { defeated: 99 });

    const board = getPublicLeaderboard(db);
    assert.deepEqual(board.map((e) => e.nickname), ['Public']);
});

test('guest characters with no account never appear', () => {
    addCharacter(addUser('Member'), { defeated: 1 });
    db.prepare(`
        INSERT INTO characters (user_id, name, race, class, health, max_health, mana, max_mana,
            strength, stamina, agility, dexterity, resilience, intelligence, luck, monsters_defeated)
        VALUES (NULL, 'Guest', 'Human', 'Rogue', 20, 20, 10, 10, 5, 5, 5, 5, 5, 5, 5, 50)
    `).run();

    const board = getPublicLeaderboard(db);
    assert.deepEqual(board.map((e) => e.nickname), ['Member']);
});

test('each account appears once, represented by its newest character', () => {
    const userId = addUser('Replayer');
    addCharacter(userId, { name: 'OldRun', defeated: 40 });
    addCharacter(userId, { name: 'NewRun', defeated: 2 });

    const board = getPublicLeaderboard(db);
    assert.equal(board.length, 1);
    assert.equal(board[0].characterName, 'NewRun');
});

test('only the top 20 come back, never the whole table', () => {
    for (let i = 1; i <= 25; i += 1) {
        addCharacter(addUser(`Player${i}`), { defeated: i });
    }

    const board = getPublicLeaderboard(db);
    assert.equal(board.length, 20);
    assert.equal(board[0].nickname, 'Player25');
    assert.equal(board[19].nickname, 'Player6'); // 1-5 fell off the board
});

test('GET /leaderboard works without logging in and shows ranked players', async () => {
    addCharacter(addUser('Alpha'), { name: 'Aria', defeated: 5 });
    addCharacter(addUser('Beta'), { name: 'Bram', defeated: 2 });

    const page = await request(createApp()).get('/leaderboard');
    assert.equal(page.status, 200);
    assert.match(page.text, /Alpha/);
    assert.match(page.text, /Aria/);
    assert.ok(page.text.indexOf('Alpha') < page.text.indexOf('Beta'), 'higher score is listed first');
});

test('the Leaderboard page never shows a private account', async () => {
    addCharacter(addUser('Shown'), { defeated: 1 });
    addCharacter(addUser('Secret', { isPublic: 0 }), { name: 'Shadow', defeated: 99 });

    const page = await request(createApp()).get('/leaderboard');
    assert.match(page.text, /Shown/);
    assert.doesNotMatch(page.text, /Secret/);
    assert.doesNotMatch(page.text, /Shadow/);
});

test('an empty board says so instead of showing an empty table', async () => {
    const page = await request(createApp()).get('/leaderboard');
    assert.equal(page.status, 200);
    assert.match(page.text, /Nobody has made the board yet/);
});

test('the menu links to the Leaderboard', async () => {
    const page = await request(createApp()).get('/');
    assert.match(page.text, /href="\/leaderboard"/);
});

test.after(() => {
    db.close();
    fs.rmSync(process.env.DATA_FILE, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-wal`, { force: true });
    fs.rmSync(`${process.env.DATA_FILE}-shm`, { force: true });
});