// server/game/attributePoints.js
//
// The attribute-point spending rule for the Character Sheet page. Split out
// from the route handler so it's a plain function to unit test (Checkpoint
// 2's "unit tests for attribute-point spending" requirement) without
// spinning up Express or the database.

export const ALLOCATABLE_ATTRIBUTES = [
    'strength', 'stamina', 'agility', 'dexterity', 'resilience', 'intelligence', 'luck',
];

// Takes the character's current row (as read from the characters table) and
// the stat the player chose to put one point into. Returns either
// { ok: true, changes } describing what to write back, or { ok: false, error }
// for the route handler to show on the form -- never throws, since a bad
// stat name or an empty pool are expected user input, not bugs.
export function spendAttributePoint(character, stat) {
    if (!ALLOCATABLE_ATTRIBUTES.includes(stat)) {
        return { ok: false, error: `${stat} is not an attribute you can put points into.` };
    }

    if (character.attribute_points <= 0) {
        return { ok: false, error: 'No Attribute Points left to spend.' };
    }

    const changes = {
        [stat]: character[stat] + 1,
        attribute_points: character.attribute_points - 1,
    };

    // Stamina backs max health directly, so raising it should grow the
    // character's health pool too, not just the stamina number.
    if (stat === 'stamina') {
        changes.max_health = character.max_health + 4;
    }

    return { ok: true, changes };
}