// test/combat.test.js
//
// Unit tests for damage/heal calculations and one-round combat resolution
// (Checkpoint 5's required unit tests). Pure functions, no app or database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveSkillDamage,
    resolveMonsterDamage,
    resolveSkillHeal,
    resolveCombatRound,
} from '../server/game/combat.js';

const strike = { name: 'Power Strike', effect_type: 'damage', power: 8, mana_cost: 0 };
const firebolt = { name: 'Firebolt', effect_type: 'damage', power: 10, mana_cost: 5 };
const heal = { name: 'Heal', effect_type: 'heal', power: 8, mana_cost: 4 };
const dodge = { name: 'Dodge', effect_type: 'utility', power: 0, mana_cost: 0 };
const run = { name: 'Run', effect_type: 'utility', power: 0, mana_cost: 0 };

function character(overrides = {}) {
    return { health: 40, max_health: 40, mana: 20, resilience: 5, ...overrides };
}

function monster(overrides = {}) {
    return { name: 'Ashen Wolf', health: 20, attack: 9, defense: 1, ...overrides };
}

test('skill damage is power minus monster defense', () => {
    assert.equal(resolveSkillDamage(strike, monster({ defense: 3 })), 5);
});

test('skill damage never drops below 1, even against heavy armor', () => {
    assert.equal(resolveSkillDamage(strike, monster({ defense: 50 })), 1);
});

test('monster damage is attack minus character resilience, minimum 1', () => {
    assert.equal(resolveMonsterDamage(monster({ attack: 9 }), character({ resilience: 5 })), 4);
    assert.equal(resolveMonsterDamage(monster({ attack: 2 }), character({ resilience: 10 })), 1);
});

test('healing adds the skill power to health', () => {
    assert.equal(resolveSkillHeal(heal, character({ health: 20 })), 28);
});

test('healing never goes past max_health', () => {
    assert.equal(resolveSkillHeal(heal, character({ health: 38 })), 40);
});

test('a damage skill hurts the monster, then the monster hits back', () => {
    const result = resolveCombatRound(character(), monster(), strike);
    assert.equal(result.ok, true);
    assert.equal(result.monsterHealth, 13); // 20 - (8 - 1)
    assert.equal(result.characterHealth, 36); // 40 - (9 - 5)
    assert.equal(result.monsterDefeated, false);
    assert.equal(result.characterDefeated, false);
});

test('a skill that costs mana reports the mana spent', () => {
    const result = resolveCombatRound(character(), monster(), firebolt);
    assert.equal(result.manaSpent, 5);
});

test('not enough mana rejects the action without spending a turn', () => {
    const result = resolveCombatRound(character({ mana: 2 }), monster(), firebolt);
    assert.equal(result.ok, false);
    assert.match(result.error, /Not enough mana/);
});

test('a killing blow ends the fight and the monster does not hit back', () => {
    const result = resolveCombatRound(character(), monster({ health: 5 }), strike);
    assert.equal(result.monsterDefeated, true);
    assert.equal(result.monsterHealth, 0);
    assert.equal(result.characterHealth, 40); // untouched
});

test('Heal restores health but the monster still attacks that round', () => {
    const result = resolveCombatRound(character({ health: 20 }), monster(), heal);
    assert.equal(result.characterHealth, 24); // 20 + 8 - 4
    assert.equal(result.monsterHealth, 20); // heal deals no damage
});

test('Dodge deals no damage and the monster\'s attack misses', () => {
    const result = resolveCombatRound(character(), monster(), dodge);
    assert.equal(result.monsterHealth, 20);
    assert.equal(result.characterHealth, 40);
    assert.equal(result.fled, false);
});

test('Run flees without the monster getting a parting hit', () => {
    const result = resolveCombatRound(character(), monster(), run);
    assert.equal(result.fled, true);
    assert.equal(result.characterHealth, 40);
});

test('the character is defeated when the monster\'s hit takes health to 0', () => {
    const result = resolveCombatRound(character({ health: 3 }), monster(), strike);
    assert.equal(result.characterDefeated, true);
    assert.equal(result.characterHealth, 0);
});