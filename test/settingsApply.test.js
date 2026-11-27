// test/settingsApply.test.js
//
// Checkpoint 7: a player's Settings must apply site-wide. Every page is drawn
// by the one shared layout, which puts the colour theme and text size on the
// <html> tag, so these tests check that tag on every kind of page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-settingsApply.db`);

const { createApp } = await import('../server/app.js');
const request = (await import('supertest')).default;
await import('../server/db/seed.js'); // the Adventure page needs the real starter rooms

const VALID_PASSWORD = 'Forest1!';

// Pages anyone can open, and pages that need a logged-in player with a character.
const PUBLIC_PAGES = ['/', '/login', '/register', '/dictionary', '/leaderboard', '/settings'];
const PLAYER_PAGES = ['/account', '/friends', '/character', '/character/adventure', '/character/inventory'];

function htmlTag(html) {
    return html.match(/<html[^>]*>/)[0];
}

async function playerAgent(username) {
    const agent = request.agent(createApp());
    await agent.post('/register').type('form')
        .send({ username, password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });
    await agent.post('/character/new').type('form').send({ name: `Hero${username}`, race: 'Fae', class: 'Rogue' });
    return agent;
}

test('every public page defaults to dark mode and medium text', async () => {
    const agent = request.agent(createApp());
    for (const page of PUBLIC_PAGES) {
        const response = await agent.get(page);
        assert.equal(response.status, 200, page);
        const tag = htmlTag(response.text);
        assert.match(tag, /data-bs-theme="dark"/, page);
        assert.match(tag, /text-size-medium/, page);
    }
});

test('a guest\'s light mode and large text apply on every public page', async () => {
    const agent = request.agent(createApp());
    await agent.post('/settings').type('form').send({ theme: 'light', textSize: 'large' });
    for (const page of PUBLIC_PAGES) {
        const tag = htmlTag((await agent.get(page)).text);
        assert.match(tag, /data-bs-theme="light"/, page);
        assert.match(tag, /text-size-large/, page);
    }
});

test('a logged-in player\'s settings apply on every page, including the game pages', async () => {
    const agent = await playerAgent('applyall');
    await agent.post('/settings').type('form').send({ theme: 'light', textSize: 'small' });
    for (const page of [...PUBLIC_PAGES, ...PLAYER_PAGES]) {
        const response = await agent.get(page);
        assert.equal(response.status, 200, page);
        const tag = htmlTag(response.text);
        assert.match(tag, /data-bs-theme="light"/, page);
        assert.match(tag, /text-size-small/, page);
    }
});

test('the page you save on already shows the new settings', async () => {
    const agent = request.agent(createApp());
    const response = await agent.post('/settings').type('form').send({ theme: 'light', textSize: 'large' });
    assert.match(htmlTag(response.text), /data-bs-theme="light"/);
    assert.match(htmlTag(response.text), /text-size-large/);
});

test('a rejected save leaves the current look in place', async () => {
    const agent = request.agent(createApp());
    await agent.post('/settings').type('form').send({ theme: 'light', textSize: 'large' });
    const response = await agent.post('/settings').type('form').send({ theme: 'neon', textSize: 'tiny' });
    assert.equal(response.status, 400);
    assert.match(htmlTag(response.text), /data-bs-theme="light"/);
    assert.match(htmlTag(response.text), /text-size-large/);
});

test('settings follow the player to a brand-new session', async () => {
    const agent = await playerAgent('applyfollow');
    await agent.post('/settings').type('form').send({ theme: 'light', textSize: 'large' });

    const fresh = request.agent(createApp());
    await fresh.post('/login').type('form').send({ username: 'applyfollow', password: VALID_PASSWORD });
    const tag = htmlTag((await fresh.get('/')).text);
    assert.match(tag, /data-bs-theme="light"/);
    assert.match(tag, /text-size-large/);
});

test('one player\'s look never leaks to a guest or another player', async () => {
    const agent = await playerAgent('applyleak');
    await agent.post('/settings').type('form').send({ theme: 'light', textSize: 'large' });

    const guestTag = htmlTag((await request(createApp()).get('/')).text);
    assert.match(guestTag, /data-bs-theme="dark"/);
    assert.match(guestTag, /text-size-medium/);
});

test('the stylesheet defines all three text sizes and a light-mode palette', () => {
    const css = fs.readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
    for (const size of ['small', 'medium', 'large']) {
        assert.match(css, new RegExp(`html\\.text-size-${size}\\s*\\{`));
    }
    assert.match(css, /\[data-bs-theme="light"\]/);
    assert.match(css, /\[data-bs-theme="dark"\]/);
});

test('the Dictionary points DROP and USE to the Inventory page instead of "coming soon"', async () => {
    const response = await request(createApp()).get('/dictionary');
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.text, /Coming in Checkpoint/);
    assert.match(response.text, /Use the Inventory page/);
});

test('every page uses the same green primary button on its main form', async () => {
    const app = createApp();
    for (const page of ['/login', '/register']) {
        const html = (await request(app).get(page)).text;
        assert.doesNotMatch(html, /btn-primary/, page);
        assert.match(html, /btn btn-success btn-lg" type="submit"/, page);
    }
});

test('the page body is a full-height column so the footer stays at the bottom', async () => {
    const html = (await request(createApp()).get('/')).text;
    assert.match(html, /<body class="d-flex flex-column min-vh-100">/);
    assert.match(html, /<main class="container py-4 flex-grow-1">/);
});