// server/leaderboard.js
//
// The ranked, limited query behind the Leaderboard page (Checkpoint 6).
// Lives in its own module so the public board and, later, the friends-only
// board can share one query instead of two copies drifting apart.
//
// Ranking per the spec: monsters defeated plus rooms explored (combined),
// with character level as the tiebreaker. Only the top `limit` rows come
// back -- never the whole characters table.
//
// One entry per account: a player can start several characters, so each
// account is represented by its newest one (the same one Continue resumes),
// otherwise old runs would crowd the board. Guest runs have no account and
// so never appear.

export const LEADERBOARD_LIMIT = 20;

// The ranking shared by both boards: same columns, same score, same
// tiebreak, same one-entry-per-account rule. Only the WHERE clause differs.
function rankedQuery(whereClause) {
    return `
        SELECT c.id AS characterId, c.name AS characterName, c.race, c.class AS characterClass,
               c.level, c.monsters_defeated AS monstersDefeated, c.rooms_explored AS roomsExplored,
               c.monsters_defeated + c.rooms_explored AS score,
               u.id AS userId, u.nickname
        FROM characters c
        JOIN users u ON u.id = c.user_id
        WHERE c.id = (SELECT MAX(c2.id) FROM characters c2 WHERE c2.user_id = u.id)
          AND ${whereClause}
        ORDER BY score DESC, c.level DESC, c.id ASC
        LIMIT ?
    `;
}

function withRanks(rows) {
    return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

// Everyone on the public board: accounts that haven't marked themselves private.
export function getPublicLeaderboard(db, limit = LEADERBOARD_LIMIT) {
    return withRanks(db.prepare(rankedQuery('u.is_public = 1')).all(limit));
}

// Just one player's friend group: that player plus everyone they have an
// accepted friendship with, in either direction. Privacy is ignored on
// purpose -- friends can already see each other's sheets, and a private
// account only opts out of the PUBLIC board.
export function getFriendsLeaderboard(db, userId, limit = LEADERBOARD_LIMIT) {
    const inGroup = `(u.id = ? OR u.id IN (
        SELECT CASE WHEN f.requester_user_id = ? THEN f.addressee_user_id ELSE f.requester_user_id END
        FROM friendships f
        WHERE f.status = 'accepted' AND (f.requester_user_id = ? OR f.addressee_user_id = ?)
    ))`;
    return withRanks(db.prepare(rankedQuery(inGroup)).all(userId, userId, userId, userId, limit));
}