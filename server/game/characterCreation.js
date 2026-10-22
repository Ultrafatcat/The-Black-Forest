// server/game/characterCreation.js
//
// Starting-stat math for Character Creation (Checkpoint 2). Kept separate
// from app.js so it's plain, testable functions: given a race + class, work
// out the attribute block a brand-new character starts with.

export const RACES = ['Human', 'Elf', 'Dwarf', 'Tiefling', 'Beastkin', 'Fae'];
export const CLASSES = ['Warrior', 'Archer', 'Mage', 'Paladin', 'Druid', 'Rogue'];

// Every class starts from the same baseline, then leans into its identity.
// Numbers are small on purpose -- Attribute Points earned via leveling
// (Checkpoint 5) are what make characters diverge over time, not creation.
const BASE = { strength: 5, stamina: 5, agility: 5, dexterity: 5, resilience: 5, intelligence: 5, luck: 5 };

const CLASS_MODIFIERS = {
    Warrior: { strength: 3, stamina: 2, resilience: 2 },
    Archer: { dexterity: 3, agility: 2, luck: 1 },
    Mage: { intelligence: 4, resilience: -1, luck: 1 },
    Paladin: { resilience: 3, strength: 1, stamina: 1 },
    Druid: { intelligence: 2, stamina: 1, luck: 1 },
    Rogue: { agility: 3, dexterity: 2, luck: 2 },
};

// Small, flavorful nudges -- never enough to make a race/class pairing
// nonviable, since every pairing has to be pickable on the Creation form.
const RACE_MODIFIERS = {
    Human: {},
    Elf: { dexterity: 1, intelligence: 1 },
    Dwarf: { stamina: 1, resilience: 1 },
    Tiefling: { intelligence: 1, luck: 1 },
    Beastkin: { strength: 1, agility: 1 },
    Fae: { luck: 2, resilience: -1 },
};

// A new character starts with a small allocatable pool so the attribute-
// point spending form (this checkpoint's other deliverable) has something
// to demo immediately, rather than waiting on the leveling system (Checkpoint 5).
export const STARTING_ATTRIBUTE_POINTS = 3;

export function isValidRace(race) {
    return RACES.includes(race);
}

export function isValidClass(characterClass) {
    return CLASSES.includes(characterClass);
}

// Combines base + class modifier + race modifier into the seven core
// attributes, then derives health/mana from them.
export function computeStartingStats(race, characterClass) {
    const classMod = CLASS_MODIFIERS[characterClass] || {};
    const raceMod = RACE_MODIFIERS[race] || {};

    const attributes = {};
    for (const key of Object.keys(BASE)) {
        attributes[key] = BASE[key] + (classMod[key] || 0) + (raceMod[key] || 0);
    }

    const maxHealth = 20 + attributes.stamina * 4;
    const maxMana = characterClass === 'Mage' || characterClass === 'Druid'
        ? 10 + attributes.intelligence * 3
        : 5 + attributes.intelligence; // everyone keeps a sliver of mana for universal skills later

    return {
        ...attributes,
        maxHealth,
        maxMana,
    };
}