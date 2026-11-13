// test/leveling.test.js
//
// Unit tests for XP/leveling thresholds (Checkpoint 5's required unit
// tests). Pure function, no app or database needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xpForNextLevel, applyXpGain } from '../server/game/leveling.js';

function baseCharacter(overrides = {}) {
    return {
        level: 1, xp: 0,
        attribute_points: 0,
        max_health: 40, max_mana: 20,
        ...overrides,
    };
}

test('xpForNextLevel grows by 50 per level', () => {
    assert.equal(xpForNextLevel(1), 50);
    assert.equal(xpForNextLevel(2), 100);
    assert.equal(xpForNextLevel(3), 150);
});

test('an XP gain under the threshold just raises xp, no level-up', () => {
    const result = applyXpGain(baseCharacter(), 20);
    assert.equal(result.xp, 20);
    assert.equal(result.level, 1);
    assert.equal(result.leveledUp, false);
    assert.equal(result.levelsGained, 0);
});

test('an XP gain that exactly meets the threshold levels up once with 0 XP left over', () => {
    const result = applyXpGain(baseCharacter(), 50);
    assert.equal(result.level, 2);
    assert.equal(result.xp, 0);
    assert.equal(result.leveledUp, true);
    assert.equal(result.levelsGained, 1);
});

test('leveling up grants 3 Attribute Points and raises max_health/max_mana', () => {
    const result = applyXpGain(baseCharacter(), 50);
    assert.equal(result.attributePoints, 3);
    assert.equal(result.maxHealth, 45);
    assert.equal(result.maxMana, 23);
});

test('an XP gain past the threshold carries the remainder into the new level', () => {
    const result = applyXpGain(baseCharacter(), 65);
    assert.equal(result.level, 2);
    assert.equal(result.xp, 15); // 65 - 50
});

test('a big enough XP gain can clear more than one level at once', () => {
    // level 1->2 costs 50, level 2->3 costs 100 -- 160 XP clears both with 10 left over.
    const result = applyXpGain(baseCharacter(), 160);
    assert.equal(result.level, 3);
    assert.equal(result.xp, 10);
    assert.equal(result.levelsGained, 2);
    assert.equal(result.attributePoints, 6); // 3 per level gained
});

test('not leveling up does not touch attribute_points, max_health, or max_mana', () => {
    const result = applyXpGain(baseCharacter({ attribute_points: 2, max_health: 50, max_mana: 25 }), 10);
    assert.equal(result.attributePoints, 2);
    assert.equal(result.maxHealth, 50);
    assert.equal(result.maxMana, 25);
});

test('XP gain stacks on top of existing xp and attribute_points rather than replacing them', () => {
    const result = applyXpGain(baseCharacter({ xp: 40, attribute_points: 1 }), 20); // 40 + 20 = 60, crosses the 50 threshold
    assert.equal(result.level, 2);
    assert.equal(result.xp, 10);
    assert.equal(result.attributePoints, 4); // 1 existing + 3 from the level-up
});