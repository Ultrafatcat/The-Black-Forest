// server/app.js
//
// Builds the Express app but never calls app.listen() -- that's server.js's
// job. Splitting them like this means tests can exercise routes directly
// without actually opening a network port.

import express from 'express';
import session from 'express-session';
import { db } from './db/connection.js'; // creates/verifies the database on startup
import { hashPassword, verifyPassword, passwordRequirementFailures } from './utils/password.js';
import { RACES, CLASSES, isValidRace, isValidClass, computeStartingStats, STARTING_ATTRIBUTE_POINTS } from './game/characterCreation.js';
import { spendAttributePoint, ALLOCATABLE_ATTRIBUTES } from './game/attributePoints.js';
import { resolveCommand } from './game/commandParser.js';
import { DICTIONARY_ENTRIES } from './game/dictionary.js';
import { resolveEquip, resolveUse } from './game/inventory.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

export function createApp() {
    const app = express();
    app.set('view engine', 'pug');
    app.set('views', path.join(ROOT_DIR, 'views'));
    app.use(express.static(path.join(ROOT_DIR, 'public')));
    app.use(express.urlencoded({ extended: false })); // parses the login/register form posts

    // SESSION_SECRET is set in production by setup-ec2.sh; a fixed fallback
    // is fine for local development -- there's nothing in a dev session
    // worth protecting against a guessed secret.
    app.use(session({
        secret: process.env.SESSION_SECRET || 'black-forest-dev-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // a week
    }));

    // Makes the logged-in user (if any) available to every template without
    // passing it explicitly from every route.
    app.use((request, response, next) => {
        response.locals.user = request.session.user || null;
        next();
    });

    // True when the session points at a character row that still exists --
    // used to warn before New Game quietly overwrites a run in progress.
    function hasExistingRun(request) {
        return Boolean(request.session.characterId
            && db.prepare('SELECT 1 FROM characters WHERE id = ?').get(request.session.characterId));
    }

    app.get('/', (request, response) => {
        // A "run" is just a character the session points at -- true for a
        // guest (characterId only) and for a logged-in player alike, so
        // Continue/Character unlock the same way regardless of login.
        response.render('menu', { title: 'The Black Forest', hasRun: Boolean(request.session.characterId) });
    });

    app.get('/login', (request, response) => {
        response.render('login', { title: 'Login', error: null, username: '' });
    });

    app.get('/register', (request, response) => {
        response.render('register', { title: 'Register', error: null, username: '' });
    });

    app.post('/register', (request, response) => {
        const { username, password, confirmPassword } = request.body;

        if (!username || !password || !confirmPassword) {
            return response.status(400).render('register', {
                title: 'Register',
                error: 'Username, password, and password confirmation are all required.',
                username,
            });
        }

        if (password !== confirmPassword) {
            return response.status(400).render('register', {
                title: 'Register',
                error: 'Passwords do not match.',
                username,
            });
        }

        const failures = passwordRequirementFailures(password);
        if (failures.length > 0) {
            return response.status(400).render('register', {
                title: 'Register',
                error: `Password is missing: ${failures.join(', ')}.`,
                username,
            });
        }

        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            return response.status(409).render('register', {
                title: 'Register',
                error: 'That username is already taken.',
                username,
            });
        }

        const passwordHash = hashPassword(password);
        const result = db.prepare(
            'INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, ?)'
        ).run(username, username, passwordHash);

        request.session.user = { id: Number(result.lastInsertRowid), username, nickname: username };
        response.redirect('/');
    });

    app.post('/login', (request, response) => {
        const { username, password } = request.body;

        const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        const passwordOk = row && verifyPassword(password, row.password_hash);

        if (!passwordOk) {
            return response.status(401).render('login', {
                title: 'Login',
                error: 'Incorrect username or password.',
                username,
            });
        }

        request.session.user = { id: row.id, username: row.username, nickname: row.nickname };

        // Resume this account's existing character (if it has one) instead
        // of leaving the session pointed at nothing -- without this, Continue
        // and Character stay locked until the player hits New Game again,
        // which creates a second, orphaned character row for the account.
        const existingCharacter = db.prepare('SELECT id FROM characters WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(row.id);
        if (existingCharacter) {
            request.session.characterId = existingCharacter.id;
        }

        response.redirect('/');
    });

    app.post('/logout', (request, response) => {
        request.session.destroy(() => response.redirect('/'));
    });

    app.get('/character/new', (request, response) => {
        response.render('character-new', {
            title: 'Character Creation',
            races: RACES,
            classes: CLASSES,
            error: null,
            name: '',
            race: RACES[0],
            characterClass: CLASSES[0],
            hasExistingRun: hasExistingRun(request),
        });
    });

    app.post('/character/new', (request, response) => {
        const { name, race, class: characterClass } = request.body;

        const renderError = (error) => response.status(400).render('character-new', {
            title: 'Character Creation',
            races: RACES,
            classes: CLASSES,
            error,
            name: name || '',
            race: isValidRace(race) ? race : RACES[0],
            characterClass: isValidClass(characterClass) ? characterClass : CLASSES[0],
            hasExistingRun: hasExistingRun(request),
        });

        if (!name || !name.trim()) {
            return renderError('A character needs a name.');
        }
        if (!isValidRace(race)) {
            return renderError('Choose a race from the list.');
        }
        if (!isValidClass(characterClass)) {
            return renderError('Choose a class from the list.');
        }

        const stats = computeStartingStats(race, characterClass);
        // user_id is NULL for a guest run -- the characters table allows that
        // (see schema.sql), and the session-held characterId is what both
        // guest and logged-in play key off of from here on.
        const userId = request.session.user ? request.session.user.id : null;

        // By convention the lowest-id room (Forest Clearing) is where every
        // new character spawns -- see the comment at the top of seed.js.
        const startingRoom = db.prepare('SELECT id FROM rooms ORDER BY id LIMIT 1').get();

        const result = db.prepare(`
            INSERT INTO characters (
                user_id, name, race, class, health, max_health, mana, max_mana,
                strength, stamina, agility, dexterity, resilience, intelligence, luck,
                attribute_points, current_room_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId, name.trim(), race, characterClass,
            stats.maxHealth, stats.maxHealth, stats.maxMana, stats.maxMana,
            stats.strength, stats.stamina, stats.agility, stats.dexterity,
            stats.resilience, stats.intelligence, stats.luck,
            STARTING_ATTRIBUTE_POINTS, startingRoom ? startingRoom.id : null,
        );

        request.session.characterId = Number(result.lastInsertRowid);

        response.redirect('/character/adventure');
    });

    app.get('/character', (request, response) => {
        if (!request.session.characterId) {
            return response.redirect('/character/new');
        }

        const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(request.session.characterId);
        if (!character) {
            // The character behind this session vanished (e.g. a reseeded
            // dev database) -- clear the stale pointer instead of 500ing.
            request.session.characterId = null;
            return response.redirect('/character/new');
        }

        response.render('character-sheet', { title: character.name, character, error: null, allocatableAttributes: ALLOCATABLE_ATTRIBUTES });
    });

    app.post('/character/attributes', (request, response) => {
        if (!request.session.characterId) {
            return response.redirect('/character/new');
        }

        const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(request.session.characterId);
        if (!character) {
            request.session.characterId = null;
            return response.redirect('/character/new');
        }

        const result = spendAttributePoint(character, request.body.stat);
        if (!result.ok) {
            return response.status(400).render('character-sheet', { title: character.name, character, error: result.error, allocatableAttributes: ALLOCATABLE_ATTRIBUTES });
        }

        const columns = Object.keys(result.changes);
        const assignments = columns.map((column) => `${column} = ?`).join(', ');
        db.prepare(`UPDATE characters SET ${assignments}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
            .run(...columns.map((column) => result.changes[column]), character.id);

        response.redirect('/character');
    });

    app.get('/character/adventure', (request, response) => {
        if (!request.session.characterId) {
            return response.redirect('/character/new');
        }

        let character = db.prepare('SELECT * FROM characters WHERE id = ?').get(request.session.characterId);
        if (!character) {
            request.session.characterId = null;
            return response.redirect('/character/new');
        }

        // A character created before Checkpoint 3 (or any other way
        // current_room_id ended up empty) gets dropped into the starting
        // room now, rather than erroring out.
        if (!character.current_room_id) {
            const startingRoom = db.prepare('SELECT id FROM rooms ORDER BY id LIMIT 1').get();
            if (startingRoom) {
                db.prepare('UPDATE characters SET current_room_id = ? WHERE id = ?').run(startingRoom.id, character.id);
                character = db.prepare('SELECT * FROM characters WHERE id = ?').get(character.id);
            }
        }

        const room = character.current_room_id
            ? db.prepare('SELECT * FROM rooms WHERE id = ?').get(character.current_room_id)
            : null;

        if (!room) {
            // No rooms seeded at all -- shouldn't happen past `npm run seed`,
            // but fail with a readable message instead of crashing.
            return response.status(500).render('adventure', {
                title: character.name,
                character,
                room: null,
                exits: [],
                roomItems: [],
                monster: null,
                inventory: [],
                log: [],
                error: 'No rooms are seeded yet. Run "npm run seed" and reload.',
            });
        }

        const exits = db.prepare('SELECT direction, destination_room_id FROM room_exits WHERE room_id = ?').all(room.id);

        const roomItems = db.prepare(`
            SELECT ri.id AS roomItemId, ri.item_id AS itemId, i.name, ri.quantity
            FROM room_items ri JOIN items i ON i.id = ri.item_id
            WHERE ri.room_id = ?
        `).all(room.id);

        const monster = room.monster_id
            ? db.prepare('SELECT id, name FROM monsters WHERE id = ?').get(room.monster_id)
            : null;

        const inventory = db.prepare(`
            SELECT ci.item_id AS itemId, i.name, ci.quantity
            FROM character_items ci JOIN items i ON i.id = ci.item_id
            WHERE ci.character_id = ?
        `).all(character.id);

        // Most recent 100 commands, oldest first so the log reads top to bottom.
        const log = db.prepare(`
            SELECT raw_command, response_text, created_at FROM command_log
            WHERE character_id = ? ORDER BY id DESC LIMIT 100
        `).all(character.id).reverse();

        response.render('adventure', { title: character.name, character, room, exits, roomItems, monster, inventory, log, error: null });
    });

    app.post('/character/adventure/command', (request, response) => {
        if (!request.session.characterId) {
            return response.redirect('/character/new');
        }

        const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(request.session.characterId);
        if (!character) {
            request.session.characterId = null;
            return response.redirect('/character/new');
        }
        if (!character.current_room_id) {
            // No room to act in yet -- the Adventure GET route's own guard
            // handles assigning one (unseeded db, pre-Checkpoint-3 character),
            // so just send the player back there instead of duplicating that.
            return response.redirect('/character/adventure');
        }

        const rawCommand = (request.body.command || '').trim();
        if (!rawCommand) {
            // Nothing typed -- nothing to log, just go back.
            return response.redirect('/character/adventure');
        }

        const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(character.current_room_id);
        const exits = db.prepare('SELECT direction, destination_room_id FROM room_exits WHERE room_id = ?').all(room.id);
        const roomItems = db.prepare(`
            SELECT ri.id AS roomItemId, ri.item_id AS itemId, i.name, ri.quantity
            FROM room_items ri JOIN items i ON i.id = ri.item_id
            WHERE ri.room_id = ?
        `).all(room.id);
        const monster = room.monster_id
            ? db.prepare('SELECT id, name FROM monsters WHERE id = ?').get(room.monster_id)
            : null;
        const inventory = db.prepare(`
            SELECT ci.item_id AS itemId, i.name, ci.quantity
            FROM character_items ci JOIN items i ON i.id = ci.item_id
            WHERE ci.character_id = ?
        `).all(character.id);

        const { response: responseText, effects } = resolveCommand(rawCommand, { room, exits, roomItems, monster, inventory });

        for (const effect of effects) {
            if (effect.type === 'move') {
                db.prepare("UPDATE characters SET current_room_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
                    .run(effect.destinationRoomId, character.id);
            } else if (effect.type === 'take') {
                const roomItemRow = db.prepare('SELECT quantity FROM room_items WHERE id = ?').get(effect.roomItemId);
                if (roomItemRow.quantity > 1) {
                    db.prepare('UPDATE room_items SET quantity = quantity - 1 WHERE id = ?').run(effect.roomItemId);
                } else {
                    db.prepare('DELETE FROM room_items WHERE id = ?').run(effect.roomItemId);
                }

                const existing = db.prepare('SELECT id, quantity FROM character_items WHERE character_id = ? AND item_id = ?')
                    .get(character.id, effect.itemId);
                if (existing) {
                    db.prepare('UPDATE character_items SET quantity = quantity + 1 WHERE id = ?').run(existing.id);
                } else {
                    db.prepare('INSERT INTO character_items (character_id, item_id, quantity, is_equipped) VALUES (?, ?, 1, 0)')
                        .run(character.id, effect.itemId);
                }
            }
        }

        db.prepare('INSERT INTO command_log (character_id, raw_command, response_text) VALUES (?, ?, ?)')
            .run(character.id, rawCommand, responseText);

        response.redirect('/character/adventure');
    });

    app.get('/character/inventory', (request, response) => {
        if (!request.session.characterId) {
            return response.redirect('/character/new');
        }

        const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(request.session.characterId);
        if (!character) {
            request.session.characterId = null;
            return response.redirect('/character/new');
        }

        const inventory = db.prepare(`
            SELECT ci.id AS characterItemId, i.id AS itemId, i.name, i.item_type, i.description,
                   i.attack_bonus, i.defense_bonus, i.heal_amount, ci.quantity, ci.is_equipped
            FROM character_items ci JOIN items i ON i.id = ci.item_id
            WHERE ci.character_id = ?
            ORDER BY i.name
        `).all(character.id);

        response.render('inventory', { title: 'Inventory', character, inventory });
    });

    // Shared by the three inventory action routes below: loads the
    // character_item row (joined with its item) and checks it actually
    // belongs to this session's character, so one player can't equip or
    // drop a row by guessing another character's characterItemId.
    function loadOwnedCharacterItem(characterId, characterItemId) {
        return db.prepare(`
            SELECT ci.id AS characterItemId, ci.quantity, ci.is_equipped,
                   i.id AS itemId, i.name, i.item_type, i.heal_amount
            FROM character_items ci JOIN items i ON i.id = ci.item_id
            WHERE ci.id = ? AND ci.character_id = ?
        `).get(characterItemId, characterId);
    }

    app.post('/character/inventory/equip', (request, response) => {
        if (!request.session.characterId) {
            return response.redirect('/character/new');
        }

        const characterItem = loadOwnedCharacterItem(request.session.characterId, request.body.characterItemId);
        if (characterItem) {
            const result = resolveEquip(characterItem, characterItem);
            if (result.ok) {
                db.prepare('UPDATE character_items SET is_equipped = ? WHERE id = ?')
                    .run(result.isEquipped, characterItem.characterItemId);
            }
        }

        response.redirect('/character/inventory');
    });

    app.post('/character/inventory/use', (request, response) => {
        if (!request.session.characterId) {
            return response.redirect('/character/new');
        }

        const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(request.session.characterId);
        const characterItem = character && loadOwnedCharacterItem(character.id, request.body.characterItemId);
        if (character && characterItem) {
            const result = resolveUse(character, characterItem, characterItem);
            if (result.ok) {
                db.prepare("UPDATE characters SET health = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
                    .run(result.newHealth, character.id);

                if (result.removeRow) {
                    db.prepare('DELETE FROM character_items WHERE id = ?').run(characterItem.characterItemId);
                } else {
                    db.prepare('UPDATE character_items SET quantity = ? WHERE id = ?')
                        .run(result.newQuantity, characterItem.characterItemId);
                }
            }
        }

        response.redirect('/character/inventory');
    });

    app.post('/character/inventory/drop', (request, response) => {
        if (!request.session.characterId) {
            return response.redirect('/character/new');
        }

        const characterItem = loadOwnedCharacterItem(request.session.characterId, request.body.characterItemId);
        if (characterItem) {
            db.prepare('DELETE FROM character_items WHERE id = ?').run(characterItem.characterItemId);
        }

        response.redirect('/character/inventory');
    });

    app.get('/account', (request, response) => {
        if (!request.session.user) {
            return response.redirect('/login');
        }

        const account = db.prepare('SELECT username, nickname, is_public FROM users WHERE id = ?').get(request.session.user.id);
        response.render('account', { title: 'Account', account, error: null, saved: false });
    });

    app.post('/account', (request, response) => {
        if (!request.session.user) {
            return response.redirect('/login');
        }

        const { nickname } = request.body;
        // Checkboxes only appear in the POST body when checked, so a toggle
        // left off arrives as undefined -- that's what "unchecked" looks like.
        const isPublic = request.body.isPublic ? 1 : 0;

        if (!nickname || !nickname.trim()) {
            const account = db.prepare('SELECT username, nickname, is_public FROM users WHERE id = ?').get(request.session.user.id);
            return response.status(400).render('account', { title: 'Account', account, error: 'Nickname cannot be empty.', saved: false });
        }

        db.prepare('UPDATE users SET nickname = ?, is_public = ? WHERE id = ?')
            .run(nickname.trim(), isPublic, request.session.user.id);

        request.session.user.nickname = nickname.trim();

        const account = db.prepare('SELECT username, nickname, is_public FROM users WHERE id = ?').get(request.session.user.id);
        response.render('account', { title: 'Account', account, error: null, saved: true });
    });

    app.get('/dictionary', (request, response) => {
        // Reachable regardless of login or run state, like the Menu Page
        // section of the spec describes -- no session guard here.
        //
        // ?from=adventure sends the "back" button to the Adventure page
        // instead of the Menu -- anything else (including it being absent)
        // falls back to Menu, which is also where a bare /dictionary visit
        // (typed directly, bookmarked, etc.) should land.
        const returnTo = request.query.from === 'adventure' ? '/character/adventure' : '/';
        response.render('dictionary', { title: 'Dictionary', entries: DICTIONARY_ENTRIES, returnTo });
    });

    app.get('/health', (request, response) => {
        response.json({ status: 'ok', uptime: process.uptime() });
    });

    return app;
}