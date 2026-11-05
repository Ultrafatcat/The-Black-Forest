// server/game/commandParser.js
//
// The Adventure page's command parser (Checkpoint 3): GO, LOOK, TAKE,
// INVENTORY, FIGHT. Kept as plain functions with no Express or database
// access, same pattern as characterCreation.js and attributePoints.js --
// the route fetches the current room/items/inventory as plain data, calls
// resolveCommand with it, and applies whatever "effects" come back.

export const COMMANDS = ['GO', 'LOOK', 'TAKE', 'INVENTORY', 'FIGHT'];

// "Ashen Wolf" -> "An Ashen Wolf"; "Cave Spider" -> "A Cave Spider". Good
// enough for monster names, which are plain English words, not meant to
// handle every edge case (an acronym, a silent-h word) in the language.
function withArticle(name) {
    return `${/^[aeiou]/i.test(name) ? 'An' : 'A'} ${name}`;
}

// Splits raw player input into a verb and an optional target, e.g.
// "GO north" -> { verb: 'GO', target: 'north' }, "look" -> { verb: 'LOOK', target: null }.
// Never throws -- unrecognized or empty input is handled by resolveCommand,
// not here, so this stays a trivial, always-succeeding tokenizer.
export function tokenize(rawInput) {
    const trimmed = (rawInput || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) {
        return { verb: '', target: null };
    }

    const [verbWord, ...rest] = trimmed.split(' ');
    return {
        verb: verbWord.toUpperCase(),
        target: rest.length > 0 ? rest.join(' ') : null,
    };
}

// context shape (all plain data -- no db access here):
//   room:      { id, name, description }
//   exits:     [{ direction, destination_room_id, hint }]
//   roomItems: [{ roomItemId, itemId, name, quantity }]
//   monster:   { id, name } | null
//   inventory: [{ itemId, name, quantity }]
//
// Returns { response, effects }. effects is an array the route applies to
// the database -- resolveCommand itself never touches it, so it's cheap to
// unit test with made-up context objects.
export function resolveCommand(rawInput, context) {
    const { verb, target } = tokenize(rawInput);

    switch (verb) {
        case 'GO':
            return resolveGo(target, context);
        case 'LOOK':
            return resolveLook(context);
        case 'TAKE':
            return resolveTake(target, context);
        case 'INVENTORY':
            return resolveInventory(context);
        case 'FIGHT':
            return resolveFight(context);
        case '':
            return { response: 'Type a command -- LOOK is always a safe place to start.', effects: [] };
        default:
            return {
                response: `"${verb}" isn't a command I know. Try GO, LOOK, TAKE, INVENTORY, or FIGHT.`,
                effects: [],
            };
    }
}

function resolveGo(target, { exits }) {
    if (!target) {
        return { response: 'Go where? Try GO WHERE for a hint about what lies in each direction.', effects: [] };
    }

    const direction = target.toLowerCase();

    if (direction === 'where') {
        return resolveGoWhere(exits);
    }

    const exit = exits.find((e) => e.direction.toLowerCase() === direction);

    if (!exit) {
        return { response: `You can't go ${direction} from here.`, effects: [] };
    }

    return {
        response: `You head ${direction}.`,
        effects: [{ type: 'move', destinationRoomId: exit.destination_room_id }],
    };
}

// GO WHERE: a closer look at each exit than LOOK gives -- LOOK just lists
// the directions, this gives a line of flavor per direction to help decide
// where to go, rather than picking a direction at random. Falls back to a
// generic line for any exit seeded without a hint (shouldn't happen with
// the current map, but keeps this from ever printing "undefined").
function resolveGoWhere(exits) {
    if (exits.length === 0) {
        return { response: "There's nowhere to go from here.", effects: [] };
    }

    const lines = exits.map((exit) => {
        const direction = capitalize(exit.direction);
        const hint = exit.hint || `Something lies to the ${exit.direction}, unremarked.`;
        return `To the ${direction}: ${hint}`;
    });

    return { response: lines.join(' '), effects: [] };
}

function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function resolveLook({ room, roomItems, monster, exits }) {
    const lines = [room.description];

    if (roomItems.length > 0) {
        lines.push(`You see: ${roomItems.map((i) => i.name).join(', ')}.`);
    }

    if (monster) {
        lines.push(`${withArticle(monster.name)} is here.`);
    }

    lines.push(exits.length > 0
        ? `Exits: ${exits.map((e) => e.direction).join(', ')}.`
        : 'There are no exits from here.');

    return { response: lines.join(' '), effects: [] };
}

function resolveTake(target, { roomItems }) {
    if (!target) {
        return { response: 'Take what?', effects: [] };
    }

    const wanted = target.toLowerCase();
    const match = roomItems.find((i) => i.name.toLowerCase() === wanted);

    if (!match) {
        return { response: `There's no ${target} here to take.`, effects: [] };
    }

    return {
        response: `You take the ${match.name}.`,
        effects: [{ type: 'take', roomItemId: match.roomItemId, itemId: match.itemId, name: match.name }],
    };
}

function resolveInventory({ inventory }) {
    if (inventory.length === 0) {
        return { response: 'Your pack is empty.', effects: [] };
    }

    const listing = inventory.map((i) => `${i.name} (${i.quantity})`).join(', ');
    return { response: `You're carrying: ${listing}.`, effects: [] };
}

function resolveFight({ monster }) {
    if (!monster) {
        return { response: "There's nothing here to fight.", effects: [] };
    }

    // Combat itself (damage, HP, victory/defeat) is Checkpoint 5 -- for now
    // FIGHT just acknowledges the monster is here and blocking the way.
    return {
        response: `${withArticle(monster.name)} snarls and blocks your path. (Combat arrives in a later checkpoint.)`,
        effects: [],
    };
}