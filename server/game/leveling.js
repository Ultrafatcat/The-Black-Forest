// server/game/leveling.js
//
// XP and leveling-up rules for Checkpoint 5's combat system. Split out from
// the combat route the same way attributePoints.js is split from the
// Character Sheet route -- a plain function to unit test without spinning
// up Express, the database, or a fight.

// How much total XP a character needs to go from `level` to `level + 1`.
// A flat, easy-to-follow curve: level 1->2 takes 50 XP, 2->3 takes 100, and
// so on -- each level costs 50 more than the last.
export function xpForNextLevel(level) {
    return level * 50;
}

// Applies an XP gain to a character and resolves as many level-ups as the
// XP covers in one go (so one big kill can't skip a level's rewards).
// Takes the character's current row and returns the new values to write
// back, plus whether a level-up happened at all -- never mutates the
// character object it's given.
//
// Each level gained grants 3 Attribute Points (matching the 3 points a
// brand-new character starts with) and raises max_health/max_mana a little,
// so leveling up is its own small reward even before spending points.
export function applyXpGain(character, xpGained) {
    let xp = character.xp + xpGained;
    let level = character.level;
    let attributePoints = character.attribute_points;
    let maxHealth = character.max_health;
    let maxMana = character.max_mana;
    let levelsGained = 0;

    while (xp >= xpForNextLevel(level)) {
        xp -= xpForNextLevel(level);
        level += 1;
        attributePoints += 3;
        maxHealth += 5;
        maxMana += 3;
        levelsGained += 1;
    }

    return {
        xp,
        level,
        attributePoints,
        maxHealth,
        maxMana,
        leveledUp: levelsGained > 0,
        levelsGained,
    };
}