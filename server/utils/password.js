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