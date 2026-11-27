// server/game/dictionary.js
//
// The reference data behind the Dictionary page: every command planned for
// the Adventure page, with its syntax and a short note -- not a walkthrough
// of what to use each one on, per the spec. `available: false` marks a
// command that's documented but isn't typed into the Adventure box: DROP and
// USE are done with the buttons on the Inventory page instead. Those entries
// carry a `note` that the page shows as a badge, so it says where to find
// them instead of implying that typing them works.

export const DICTIONARY_ENTRIES = [
    { verb: 'GO', syntax: 'GO <direction>', description: 'Move to a connected room, e.g. GO NORTH.', available: true },
    { verb: 'GO WHERE', syntax: 'GO WHERE', description: 'Get a hint about what lies in each direction, instead of just the exit list LOOK gives.', available: true },
    { verb: 'LOOK', syntax: 'LOOK', description: "Describe the room again: what's here and which exits lead out.", available: true },
    { verb: 'TAKE', syntax: 'TAKE <item>', description: 'Pick up an item lying in the room.', available: true },
    { verb: 'INVENTORY', syntax: 'INVENTORY', description: "List what you're carrying.", available: true },
    { verb: 'FIGHT', syntax: 'FIGHT', description: 'Engage a monster in the room.', available: true },
    { verb: 'DROP', syntax: 'DROP <item>', description: 'Leave an item behind.', available: false, note: 'Use the Inventory page' },
    { verb: 'USE', syntax: 'USE <item>', description: 'Use a consumable from your inventory.', available: false, note: 'Use the Inventory page' },
];