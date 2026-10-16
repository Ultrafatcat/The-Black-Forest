// server/utils/password.js
//
// Password hashing via Node's built-in crypto (scrypt) -- no extra
// dependency needed, consistent with using node:sqlite instead of
// better-sqlite3 elsewhere in this project. Each hash carries its own
// random salt, stored alongside it as "salt:hash".

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
    return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;

    const hashBuffer = Buffer.from(hash, 'hex');
    const candidateBuffer = scryptSync(password, salt, KEY_LENGTH);

    // timingSafeEqual requires equal-length buffers, and throws otherwise --
    // guard that first so a malformed stored hash can't crash the request.
    return hashBuffer.length === candidateBuffer.length
        && timingSafeEqual(hashBuffer, candidateBuffer);
}

// Registration password rules. Mirrored in public/js/register.js for live
// feedback as the player types -- that copy is UX only, never trusted on
// its own, so it's checked again here on every submit.
const PASSWORD_REQUIREMENTS = [
    { label: 'at least 6 characters', test: (value) => value.length >= 6 },
    { label: 'at least one uppercase letter', test: (value) => /[A-Z]/.test(value) },
    { label: 'at least one number', test: (value) => /[0-9]/.test(value) },
    { label: 'at least one special character', test: (value) => /[^A-Za-z0-9]/.test(value) },
];

export function passwordRequirementFailures(password) {
    return PASSWORD_REQUIREMENTS.filter(({ test }) => !test(password)).map(({ label }) => label);
}