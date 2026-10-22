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

        const result = db.prepare(`
            INSERT INTO characters (
                user_id, name, race, class, health, max_health, mana, max_mana,
                strength, stamina, agility, dexterity, resilience, intelligence, luck,
                attribute_points
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId, name.trim(), race, characterClass,
            stats.maxHealth, stats.maxHealth, stats.maxMana, stats.maxMana,
            stats.strength, stats.stamina, stats.agility, stats.dexterity,
            stats.resilience, stats.intelligence, stats.luck,
            STARTING_ATTRIBUTE_POINTS,
        );

        request.session.characterId = Number(result.lastInsertRowid);

        // The Adventure page doesn't exist until Checkpoint 3, so the
        // Character Sheet is where a new run lands for now.
        response.redirect('/character');
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

    app.get('/health', (request, response) => {
        response.json({ status: 'ok', uptime: process.uptime() });
    });

    return app;
}