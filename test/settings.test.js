// Unit tests for the Settings rules (Checkpoint 7). Pure functions, so no
// server or database is involved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    THEMES, TEXT_SIZES, DEFAULT_SETTINGS, resolveSettings, normalizeSettings,
} from '../server/game/settings.js';

test('the choices match the spec: dark/light and small/medium/large', () => {
    assert.deepEqual(THEMES, ['dark', 'light']);
    assert.deepEqual(TEXT_SIZES, ['small', 'medium', 'large']);
});

test('the defaults are dark mode and medium text', () => {
    assert.deepEqual({ ...DEFAULT_SETTINGS }, { theme: 'dark', textSize: 'medium' });
});

test('resolveSettings accepts every theme and size combination', () => {
    for (const theme of THEMES) {
        for (const textSize of TEXT_SIZES) {
            const result = resolveSettings({ theme, textSize });
            assert.equal(result.ok, true);
            assert.deepEqual(result.settings, { theme, textSize });
        }
    }
});

test('resolveSettings ignores capitalisation and stray spaces', () => {
    const result = resolveSettings({ theme: ' Light ', textSize: 'LARGE' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.settings, { theme: 'light', textSize: 'large' });
});

test('resolveSettings rejects an unknown theme', () => {
    const result = resolveSettings({ theme: 'purple', textSize: 'medium' });
    assert.equal(result.ok, false);
    assert.match(result.error, /light or dark/i);
});

test('resolveSettings rejects an unknown text size', () => {
    const result = resolveSettings({ theme: 'dark', textSize: 'huge' });
    assert.equal(result.ok, false);
    assert.match(result.error, /text size/i);
});

test('resolveSettings rejects missing fields and non-string values', () => {
    assert.equal(resolveSettings({}).ok, false);
    assert.equal(resolveSettings(undefined).ok, false);
    assert.equal(resolveSettings({ theme: 'dark' }).ok, false);
    assert.equal(resolveSettings({ theme: ['dark'], textSize: 'small' }).ok, false);
    assert.equal(resolveSettings({ theme: 'dark', textSize: 3 }).ok, false);
});

test('normalizeSettings reads a users row (text_size) and a session object (textSize)', () => {
    assert.deepEqual(normalizeSettings({ theme: 'light', text_size: 'large' }), { theme: 'light', textSize: 'large' });
    assert.deepEqual(normalizeSettings({ theme: 'light', textSize: 'small' }), { theme: 'light', textSize: 'small' });
});

test('normalizeSettings falls back to the defaults for nothing or bad data', () => {
    assert.deepEqual(normalizeSettings(undefined), { theme: 'dark', textSize: 'medium' });
    assert.deepEqual(normalizeSettings(null), { theme: 'dark', textSize: 'medium' });
    assert.deepEqual(normalizeSettings({ theme: 'neon', text_size: 'tiny' }), { theme: 'dark', textSize: 'medium' });
});

test('normalizeSettings only replaces the bad field, not the good one', () => {
    assert.deepEqual(normalizeSettings({ theme: 'light', text_size: 'tiny' }), { theme: 'light', textSize: 'medium' });
    assert.deepEqual(normalizeSettings({ theme: 'neon', text_size: 'large' }), { theme: 'dark', textSize: 'large' });
});