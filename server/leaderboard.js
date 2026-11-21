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

export function getPublicLeaderboard(db, limit = LEADERBOARD_LIMIT) {
    const rows = db.prepare(`
        SELECT c.id AS characterId, c.name AS characterName, c.race, c.class AS characterClass,
               c.level, c.monsters_defeated AS monstersDefeated, c.rooms_explored AS roomsExplored,
               c.monsters_defeated + c.rooms_explored AS score,
               u.id AS userId, u.nickname
        FROM characters c
        JOIN users u ON u.id = c.user_id
        WHERE u.is_public = 1
          AND c.id = (SELECT MAX(c2.id) FROM characters c2 WHERE c2.user_id = u.id)
        ORDER BY score DESC, c.level DESC, c.id ASC
        LIMIT ?
    `).all(limit);

    return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}