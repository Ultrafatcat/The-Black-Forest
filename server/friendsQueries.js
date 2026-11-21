// server/friendsQueries.js
//
// The database reads and writes behind the Friends page (Checkpoint 6). The
// rules about who may do what live in game/friends.js; this file only loads
// rows and stores the outcome, the same split the routes use elsewhere.

// Finds a player by the username someone typed. Case-insensitive so "Ann"
// still finds "ann", but an exact-case match wins if two accounts differ only
// by case (usernames are stored as typed, so both can exist).
export function findUserByUsername(db, typedName) {
    return db.prepare(`
        SELECT id, username, nickname FROM users
        WHERE username = ? COLLATE NOCASE
        ORDER BY (username = ?) DESC
        LIMIT 1
    `).get(typedName, typedName);
}

// Any friendship row between two players, whichever of them asked first.
export function findFriendshipsBetween(db, userA, userB) {
    return db.prepare(`
        SELECT * FROM friendships
        WHERE (requester_user_id = ? AND addressee_user_id = ?)
           OR (requester_user_id = ? AND addressee_user_id = ?)
        ORDER BY id
    `).all(userA, userB, userB, userA);
}

export function createFriendRequest(db, requesterId, addresseeId) {
    db.prepare('INSERT INTO friendships (requester_user_id, addressee_user_id, status) VALUES (?, ?, ?)')
        .run(requesterId, addresseeId, 'pending');
}

// Turns a declined row back into a fresh pending request from `requesterId`.
export function reopenFriendRequest(db, friendshipId, requesterId, addresseeId) {
    db.prepare(`
        UPDATE friendships
        SET requester_user_id = ?, addressee_user_id = ?, status = 'pending',
            created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
    `).run(requesterId, addresseeId, friendshipId);
}

export function findFriendship(db, friendshipId) {
    return db.prepare('SELECT * FROM friendships WHERE id = ?').get(friendshipId);
}

export function setFriendshipStatus(db, friendshipId, status) {
    db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run(status, friendshipId);
}

// Everything the Friends page shows for one player: requests waiting on
// them, requests they sent that are still pending, and their friends (each
// with their newest character, if they have one).
export function loadFriendsPage(db, userId) {
    const incoming = db.prepare(`
        SELECT f.id AS friendshipId, u.nickname, u.username
        FROM friendships f JOIN users u ON u.id = f.requester_user_id
        WHERE f.addressee_user_id = ? AND f.status = 'pending'
        ORDER BY f.id
    `).all(userId);

    const outgoing = db.prepare(`
        SELECT f.id AS friendshipId, u.nickname, u.username
        FROM friendships f JOIN users u ON u.id = f.addressee_user_id
        WHERE f.requester_user_id = ? AND f.status = 'pending'
        ORDER BY f.id
    `).all(userId);

    const friends = db.prepare(`
        SELECT u.id AS userId, u.nickname, u.username,
               c.id AS characterId, c.name AS characterName, c.class AS characterClass, c.level
        FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.requester_user_id = ? THEN f.addressee_user_id ELSE f.requester_user_id END
        LEFT JOIN characters c ON c.id = (SELECT MAX(c2.id) FROM characters c2 WHERE c2.user_id = u.id)
        WHERE (f.requester_user_id = ? OR f.addressee_user_id = ?) AND f.status = 'accepted'
        ORDER BY u.nickname COLLATE NOCASE
    `).all(userId, userId, userId);

    return { incoming, outgoing, friends };
}
// A player's display name and newest character, for a friend's read-only
// sheet. `character` is null if they haven't started one. Returns undefined
// if there is no such account.
export function loadFriendCharacter(db, userId) {
    const user = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(userId);
    if (!user) {
        return undefined;
    }
    const character = db.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId) || null;
    return { nickname: user.nickname, character };
}