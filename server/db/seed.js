// server/db/seed.js
// Inserts starter rooms/monsters/items only if the database is empty, so
// running start.sh twice doesn't duplicate rows. Run with `npm run seed`
// (start.sh calls this automatically).
//
// Convention: the lowest-id room (Forest Clearing, inserted first) is the
// starting room every new character spawns into -- see the current_room_id
// assignment in the POST /character/new route.

import { db } from './connection.js';

const { count } = db.prepare('SELECT COUNT(*) AS count FROM rooms').get();

if (count === 0) {
    const insertMonster = db.prepare(
        'INSERT INTO monsters (name, health, attack, defense, xp_reward, gold_reward) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const wolfId = insertMonster.run('Ashen Wolf', 20, 4, 1, 15, 5).lastInsertRowid;

    const insertItem = db.prepare(
        'INSERT INTO items (name, item_type, attack_bonus, defense_bonus, heal_amount, is_treasure, point_value, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const daggerId = insertItem.run(
        'Rusted Dagger', 'weapon', 2, 0, 0, 0, 0,
        'Pitted and dull, but it still has an edge.'
    ).lastInsertRowid;
    const mushroomId = insertItem.run(
        'Wild Mushroom', 'consumable', 0, 0, 5, 0, 0,
        'Pale and faintly glowing. Smells faintly of rain.'
    ).lastInsertRowid;
    const lockedId = insertItem.run(
        'Tarnished Locket', 'treasure', 0, 0, 0, 1, 10,
        'A small locket, the portrait inside too worn to make out.'
    ).lastInsertRowid;
    const vestId = insertItem.run(
        'Worn Leather Vest', 'armor', 0, 2, 0, 0, 0,
        'Cracked and stiff with age, but it still turns a blade.'
    ).lastInsertRowid;

    const insertRoom = db.prepare(
        'INSERT INTO rooms (name, description, monster_id) VALUES (?, ?, ?)'
    );
    // Inserted first, so this is id 1 -- the starting room by convention
    // (see the comment above).
    const clearingId = insertRoom.run(
        'Forest Clearing',
        'A ring of ash-grey trees. Pale light filters down from somewhere above.',
        null
    ).lastInsertRowid;
    const denId = insertRoom.run(
        "Wolf's Den",
        'Claw marks score the bark. Something growls just out of sight.',
        wolfId
    ).lastInsertRowid;
    const hollowId = insertRoom.run(
        'Mossy Hollow',
        'Soft green moss blankets everything, muffling your footsteps.',
        null
    ).lastInsertRowid;
    const bridgeId = insertRoom.run(
        'Crooked Bridge',
        'A warped plank bridge creaks over a ravine lost to fog.',
        null
    ).lastInsertRowid;
    const shrineId = insertRoom.run(
        'Sunken Shrine',
        'Half-buried stonework, worn smooth by centuries of rain.',
        null
    ).lastInsertRowid;

    const insertExit = db.prepare(
        'INSERT INTO room_exits (room_id, direction, destination_room_id) VALUES (?, ?, ?)'
    );
    insertExit.run(clearingId, 'north', denId);
    insertExit.run(denId, 'south', clearingId);
    insertExit.run(clearingId, 'east', hollowId);
    insertExit.run(hollowId, 'west', clearingId);
    insertExit.run(hollowId, 'north', bridgeId);
    insertExit.run(bridgeId, 'south', hollowId);
    insertExit.run(bridgeId, 'east', shrineId);
    insertExit.run(shrineId, 'west', bridgeId);

    const insertRoomItem = db.prepare(
        'INSERT INTO room_items (room_id, item_id, quantity) VALUES (?, ?, ?)'
    );
    insertRoomItem.run(hollowId, daggerId, 1);
    insertRoomItem.run(hollowId, mushroomId, 1);
    insertRoomItem.run(shrineId, lockedId, 1);
    insertRoomItem.run(denId, vestId, 1);

    console.log('Seeded starter rooms, items, and a monster.');
} else {
    console.log('Rooms already seeded, skipping.');
}