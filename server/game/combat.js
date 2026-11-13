// server/game/combat.js
//
// The rules for one round of combat on the Combat page (Checkpoint 5).
// Split out from the route handler the same way attributePoints.js and
// leveling.js are -- plain functions that take rows and return a result, so
// damage/heal math can be unit tested without Express or the database.
//
// Everything here is deterministic (no random rolls), so a given fight
// always plays out the same way and tests can assert exact numbers.

// Damage a damage-type skill deals to the monster: the skill's power, less
// the monster's defense, but never less than 1 so every hit counts.
export function resolveSkillDamage(skill, monster) {
    return Math.max(1, skill.power - monster.defense);
}

// Damage the monster deals back to the character: its attack, less the
// character's resilience, never less than 1.
export function resolveMonsterDamage(monster, character) {
    return Math.max(1, monster.attack - character.resilience);
}

// New health after a heal-type skill -- capped at max_health so healing
// never overshoots.
export function resolveSkillHeal(skill, character) {
    return Math.min(character.max_health, character.health + skill.power);
}

// Resolves one full round: the character acts, then (if the monster is
// still standing and the character didn't dodge or run) the monster hits
// back. Takes the character row, the monster's current state
// ({ name, health, attack, defense } -- health being this fight's running
// HP, not the monster's base), and the chosen skill row.
//
// Returns { ok: false, error } if the action can't be taken (not enough
// mana) without spending a turn, or { ok: true, ... } describing the
// outcome for the route to write back. Never throws.
export function resolveCombatRound(character, monster, skill) {
    if (skill.mana_cost > character.mana) {
        return { ok: false, error: `Not enough mana for ${skill.name}.` };
    }

    const lines = [];
    let monsterHealth = monster.health;
    let characterHealth = character.health;
    let dodged = false;
    let fled = false;

    if (skill.effect_type === 'damage') {
        const damage = resolveSkillDamage(skill, monster);
        monsterHealth -= damage;
        lines.push(`You use ${skill.name} for ${damage} damage.`);
    } else if (skill.effect_type === 'heal') {
        const healed = resolveSkillHeal(skill, character);
        lines.push(`You use ${skill.name} and recover ${healed - character.health} health.`);
        characterHealth = healed;
    } else if (skill.name === 'Dodge') {
        dodged = true;
        lines.push('You brace yourself, ready to sidestep the next blow.');
    } else if (skill.name === 'Run') {
        fled = true;
        lines.push('You break off the fight and flee.');
    }

    const monsterDefeated = monsterHealth <= 0;
    let characterDefeated = false;

    if (monsterDefeated) {
        monsterHealth = 0;
        lines.push(`The ${monster.name} is defeated!`);
    } else if (!fled) {
        if (dodged) {
            lines.push(`The ${monster.name} lunges, but you slip out of the way.`);
        } else {
            const damage = resolveMonsterDamage(monster, character);
            characterHealth -= damage;
            lines.push(`The ${monster.name} strikes you for ${damage} damage.`);
            if (characterHealth <= 0) {
                characterHealth = 0;
                characterDefeated = true;
                lines.push('You collapse...');
            }
        }
    }

    return {
        ok: true,
        monsterHealth,
        characterHealth,
        manaSpent: skill.mana_cost,
        monsterDefeated,
        characterDefeated,
        fled,
        message: lines.join(' '),
    };
}