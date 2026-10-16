// server/app.js
//
// Builds the Express app but never calls app.listen() -- that's server.js's
// job. Splitting them like this means tests can exercise routes directly
// without actually opening a network port.

import express from 'express';
import session from 'express-session';
import { db } from './db/connection.js'; // creates/verifies the database on startup
import { hashPassword, verifyPassword, passwordRequirementFailures } from './utils/password.js';
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
        response.render('menu', { title: 'The Black Forest', hasRun: false });
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

    app.get('/health', (request, response) => {
        response.json({ status: 'ok', uptime: process.uptime() });
    });

    return app;
}