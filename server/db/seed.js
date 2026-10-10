// server/db/seed.js
// Inserts starter rooms/monsters/items only if the database is empty, so
// running start.sh twice doesn't duplicate rows. Run with `npm run seed`
// (start.sh calls this automatically).

import { db } from './connection.js';

const { count } = db.prepare('SELECT COUNT(*) AS count FROM rooms').get();

if (count === 0) {
    const insertMonster = db.prepare(
        'INSERT INTO monsters (name, health, attack, defense, xp_reward, gold_reward) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const wolfId = insertMonster.run('Ashen Wolf', 20, 4, 1, 15, 5).lastInsertRowid;

    const insertRoom = db.prepare(
        'INSERT INTO rooms (name, description, monster_id) VALUES (?, ?, ?)'
    );
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

    db.prepare(
        'INSERT INTO room_exits (room_id, direction, destination_room_id) VALUES (?, ?, ?)'
    ).run(clearingId, 'north', denId);

    console.log('Seeded starter rooms and a monster.');
} else {
    console.log('Rooms already seeded, skipping.');
}