// test/attributePoints.test.js
//
// Unit tests for attribute-point spending (Checkpoint 2's required unit
// tests). Pure function, no app or database needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spendAttributePoint, ALLOCATABLE_ATTRIBUTES } from '../server/game/attributePoints.js';

function baseCharacter(overrides = {}) {
    return {
        strength: 5, stamina: 5, agility: 5, dexterity: 5,
        resilience: 5, intelligence: 5, luck: 5,
        max_health: 40, attribute_points: 3,
        ...overrides,
    };
}

test('spending a point raises that stat by one and the pool by minus one', () => {
    const result = spendAttributePoint(baseCharacter(), 'strength');
    assert.equal(result.ok, true);
    assert.equal(result.changes.strength, 6);
    assert.equal(result.changes.attribute_points, 2);
});

test('spending a point on stamina also raises max_health', () => {
    const result = spendAttributePoint(baseCharacter(), 'stamina');
    assert.equal(result.ok, true);
    assert.equal(result.changes.stamina, 6);
    assert.equal(result.changes.max_health, 44);
});

test('spending on a non-stamina stat leaves max_health untouched', () => {
    const result = spendAttributePoint(baseCharacter(), 'luck');
    assert.equal(result.ok, true);
    assert.equal('max_health' in result.changes, false);
});

test('rejects an unknown stat name', () => {
    const result = spendAttributePoint(baseCharacter(), 'charisma');
    assert.equal(result.ok, false);
    assert.match(result.error, /not an attribute/);
});

test('rejects spending with no points left', () => {
    const result = spendAttributePoint(baseCharacter({ attribute_points: 0 }), 'strength');
    assert.equal(result.ok, false);
    assert.match(result.error, /No Attribute Points left/);
});

test('every allocatable attribute is spendable', () => {
    for (const stat of ALLOCATABLE_ATTRIBUTES) {
        const result = spendAttributePoint(baseCharacter(), stat);
        assert.equal(result.ok, true, `${stat} should be spendable`);
    }
});