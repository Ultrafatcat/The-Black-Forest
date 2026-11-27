// test/settingsRoutes.test.js
//
// Integration tests for the Settings page (Checkpoint 7): choices save to a
// logged-in player's account, last for a guest's session, reject bad input,
// and survive logging out and back in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-settingsRoutes.db`);

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db/connection.js');
const request = (await import('supertest')).default;
await import('../server/db/seed.js'); // the Adventure page needs the real starter rooms

const VALID_PASSWORD = 'Forest1!';

async function registerAgent(username) {
    const agent = request.agent(createApp());
    await agent.post('/register').type('form')
        .send({ username, password: VALID_PASSWORD, confirmPassword: VALID_PASSWORD });
    return agent;
}

// The radio button for a value is "checked" when its <input> tag carries it.
function isChecked(html, value) {
    const input = html.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`));
    return Boolean(input && /checked/.test(input[0]));
}

test('the Settings page is open to guests and defaults to dark mode, medium text', async () => {
    const response = await request(createApp()).get('/settings');
    assert.equal(response.status, 200);
    assert.ok(isChecked(response.text, 'dark'));
    assert.ok(isChecked(response.text, 'medium'));
    assert.ok(!isChecked(response.text, 'light'));
});

test('a logged-in player\'s choices are saved to their account', async () => {
    const agent = await registerAgent('settingsuser');

    const response = await agent.post('/settings').type('form').send({ theme: 'light', textSize: 'large' });
    assert.equal(response.status, 200);
    assert.match(response.text, /Saved/);

    const row = db.prepare('SELECT theme, text_size FROM users WHERE username = ?').get('settingsuser');
    assert.equal(row.theme, 'light');
    assert.equal(row.text_size, 'large');
});

test('the saved page and the next visit show the new choices', async () => {
    const agent = await registerAgent('settingsrevisit');
    const saved = await agent.post('/settings').type('form').send({ theme: 'light', textSize: 'small' });
    assert.ok(isChecked(saved.text, 'light'));
    assert.ok(isChecked(saved.text, 'small'));

    const again = await agent.get('/settings');
    assert.ok(isChecked(again.text, 'light'));
    assert.ok(isChecked(again.text, 'small'));
});

test('settings persist across logging out and back in (the Checkpoint 7 persistence test)', async () => {
    const agent = await registerAgent('settingspersist');
    await agent.post('/settings').type('form').send({ theme: 'light', textSize: 'large' });
    await agent.post('/logout');

    // Logged out, the guest defaults come back...
    const loggedOut = await agent.get('/settings');
    assert.ok(isChecked(loggedOut.text, 'dark'));

    // ...and logging back in restores the saved choices, from a brand-new session.
    const fresh = request.agent(createApp());
    await fresh.post('/login').type('form').send({ username: 'settingspersist', password: VALID_PASSWORD });
    const response = await fresh.get('/settings');
    assert.ok(isChecked(response.text, 'light'));
    assert.ok(isChecked(response.text, 'large'));
});

test('one player\'s settings never change another player\'s', async () => {
    const first = await registerAgent('settingsfirst');
    const second = await registerAgent('settingssecond');
    await first.post('/settings').type('form').send({ theme: 'light', textSize: 'large' });

    const response = await second.get('/settings');
    assert.ok(isChecked(response.text, 'dark'));
    assert.ok(isChecked(response.text, 'medium'));
});

test('a guest\'s choices last for their session but touch no account', async () => {
    const agent = request.agent(createApp());
    const before = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

    const saved = await agent.post('/settings').type('form').send({ theme: 'light', textSize: 'small' });
    assert.equal(saved.status, 200);
    assert.match(saved.text, /Saved/);

    const again = await agent.get('/settings');
    assert.ok(isChecked(again.text, 'light'));
    assert.ok(isChecked(again.text, 'small'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, before);

    // A different visitor is unaffected.
    const other = await request(createApp()).get('/settings');
    assert.ok(isChecked(other.text, 'dark'));
});

test('an unknown theme or size is rejected and nothing is saved', async () => {
    const agent = await registerAgent('settingsbad');

    const badTheme = await agent.post('/settings').type('form').send({ theme: 'purple', textSize: 'small' });
    assert.equal(badTheme.status, 400);
    assert.match(badTheme.text, /light or dark/i);

    const badSize = await agent.post('/settings').type('form').send({ theme: 'light', textSize: 'huge' });
    assert.equal(badSize.status, 400);

    const missing = await agent.post('/settings').type('form').send({});
    assert.equal(missing.status, 400);

    const row = db.prepare('SELECT theme, text_size FROM users WHERE username = ?').get('settingsbad');
    assert.equal(row.theme, 'dark');
    assert.equal(row.text_size, 'medium');
});

test('the Menu and Adventure Settings buttons are now real links', async () => {
    const agent = await registerAgent('settingslinks');
    const menu = await agent.get('/');
    assert.match(menu.text, /<a[^>]*href="\/settings"[^>]*>Settings<\/a>/);

    await agent.post('/character/new').type('form').send({ name: 'Linky', race: 'Fae', class: 'Rogue' });
    const adventure = await agent.get('/character/adventure');
    assert.match(adventure.text, /<a[^>]*href="\/settings\?from=adventure"[^>]*>Settings<\/a>/);
});

test('Settings opened from the Adventure page returns to the Adventure page', async () => {
    const agent = await registerAgent('settingsfromadv');

    const response = await agent.get('/settings?from=adventure');
    assert.equal(response.status, 200);
    assert.match(response.text, /<a[^>]*href="\/character\/adventure"[^>]*>Return to Adventure<\/a>/);
    assert.doesNotMatch(response.text, /Return to Menu/);
});

test('Settings opened from the Menu (or typed in) returns to the Menu', async () => {
    const agent = await registerAgent('settingsfrommenu');

    for (const url of ['/settings', '/settings?from=somewhere-else', '/settings?from=https://evil.example']) {
        const response = await agent.get(url);
        assert.match(response.text, /<a[^>]*href="\/"[^>]*>Return to Menu<\/a>/, url);
        assert.doesNotMatch(response.text, /Return to Adventure/, url);
    }
});

test('saving from the Adventure page keeps the Return to Adventure button', async () => {
    const agent = await registerAgent('settingssaveadv');

    // The form posts back to the same ?from=adventure address.
    const page = await agent.get('/settings?from=adventure');
    assert.match(page.text, /<form[^>]*action="\/settings\?from=adventure"/);

    const saved = await agent.post('/settings?from=adventure').type('form').send({ theme: 'light', textSize: 'small' });
    assert.equal(saved.status, 200);
    assert.match(saved.text, /Saved/);
    assert.match(saved.text, /<a[^>]*href="\/character\/adventure"[^>]*>Return to Adventure<\/a>/);

    // A rejected save keeps it too.
    const rejected = await agent.post('/settings?from=adventure').type('form').send({ theme: 'neon', textSize: 'small' });
    assert.equal(rejected.status, 400);
    assert.match(rejected.text, /Return to Adventure/);
});

test('the Adventure page\'s Settings button opens Settings with from=adventure; the Menu\'s does not', async () => {
    const agent = await registerAgent('settingsbuttons');
    await agent.post('/character/new').type('form').send({ name: 'Wanderer', race: 'Fae', class: 'Rogue' });

    const adventure = await agent.get('/character/adventure');
    assert.match(adventure.text, /<a[^>]*href="\/settings\?from=adventure"[^>]*>Settings<\/a>/);

    const menu = await agent.get('/');
    assert.match(menu.text, /<a[^>]*href="\/settings"[^>]*>Settings<\/a>/);
});