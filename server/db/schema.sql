-- server/db/schema.sql
-- Keep this file as the one source of truth for table shape. connection.js
-- runs it every start, so it has to be safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    nickname      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_public     INTEGER NOT NULL DEFAULT 1,
    theme         TEXT NOT NULL DEFAULT 'dark',
    text_size     TEXT NOT NULL DEFAULT 'medium',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS characters (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER REFERENCES users(id),
    name              TEXT NOT NULL,
    race              TEXT NOT NULL,
    class             TEXT NOT NULL,
    level             INTEGER NOT NULL DEFAULT 1,
    xp                INTEGER NOT NULL DEFAULT 0,
    health            INTEGER NOT NULL,
    max_health        INTEGER NOT NULL,
    mana              INTEGER NOT NULL,
    max_mana          INTEGER NOT NULL,
    strength          INTEGER NOT NULL,
    stamina           INTEGER NOT NULL,
    agility           INTEGER NOT NULL,
    dexterity         INTEGER NOT NULL,
    resilience        INTEGER NOT NULL,
    intelligence      INTEGER NOT NULL,
    luck              INTEGER NOT NULL,
    attribute_points  INTEGER NOT NULL DEFAULT 0,
    gold              INTEGER NOT NULL DEFAULT 0,
    current_room_id   INTEGER REFERENCES rooms(id),
    monsters_defeated INTEGER NOT NULL DEFAULT 0,
    rooms_explored    INTEGER NOT NULL DEFAULT 0,
    is_alive          INTEGER NOT NULL DEFAULT 1,
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS rooms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    monster_id  INTEGER REFERENCES monsters(id)
);

CREATE TABLE IF NOT EXISTS monsters (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    health        INTEGER NOT NULL,
    attack        INTEGER NOT NULL,
    defense       INTEGER NOT NULL,
    xp_reward     INTEGER NOT NULL,
    gold_reward   INTEGER NOT NULL,
    loot_item_id  INTEGER REFERENCES items(id)
);

CREATE TABLE IF NOT EXISTS items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    item_type      TEXT NOT NULL, -- weapon / armor / consumable / treasure
    attack_bonus   INTEGER NOT NULL DEFAULT 0,
    defense_bonus  INTEGER NOT NULL DEFAULT 0,
    heal_amount    INTEGER NOT NULL DEFAULT 0,
    is_treasure    INTEGER NOT NULL DEFAULT 0,
    point_value    INTEGER NOT NULL DEFAULT 0,
    description    TEXT
);

CREATE TABLE IF NOT EXISTS room_exits (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id             INTEGER NOT NULL REFERENCES rooms(id),
    direction           TEXT NOT NULL,
    destination_room_id INTEGER NOT NULL REFERENCES rooms(id)
);

CREATE TABLE IF NOT EXISTS room_items (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id  INTEGER NOT NULL REFERENCES rooms(id),
    item_id  INTEGER NOT NULL REFERENCES items(id),
    quantity INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS character_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id  INTEGER NOT NULL REFERENCES characters(id),
    item_id       INTEGER NOT NULL REFERENCES items(id),
    quantity      INTEGER NOT NULL DEFAULT 1,
    is_equipped   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS skills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    class       TEXT, -- NULL for a universal action (Dodge/Heal/Run)
    min_level   INTEGER NOT NULL DEFAULT 1,
    mana_cost   INTEGER NOT NULL DEFAULT 0,
    effect_type TEXT NOT NULL, -- damage / heal / buff / debuff / utility
    power       INTEGER NOT NULL DEFAULT 0,
    description TEXT
);

CREATE TABLE IF NOT EXISTS combat_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id),
    monster_id   INTEGER NOT NULL REFERENCES monsters(id),
    outcome      TEXT NOT NULL,
    xp_gained    INTEGER NOT NULL DEFAULT 0,
    gold_gained  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS friendships (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_user_id   INTEGER NOT NULL REFERENCES users(id),
    addressee_user_id   INTEGER NOT NULL REFERENCES users(id),
    status              TEXT NOT NULL DEFAULT 'pending', -- pending / accepted / declined
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS command_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id  INTEGER NOT NULL REFERENCES characters(id),
    raw_command   TEXT NOT NULL,
    response_text TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);