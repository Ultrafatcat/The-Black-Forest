// server/game/settings.js
//
// The rules for the Settings page (Checkpoint 7): which text sizes and
// colour themes exist, what a bad value does, and what a player gets before
// they have chosen anything. Plain functions with no Express or database --
// the same split as friends.js and combat.js -- so every rule is a unit test.

export const THEMES = ['dark', 'light'];
export const TEXT_SIZES = ['small', 'medium', 'large'];

// What a brand-new player (or a guest who hasn't chosen yet) sees. These
// match the column defaults in schema.sql, so an account that never opens
// Settings behaves exactly like a guest.
export const DEFAULT_SETTINGS = Object.freeze({ theme: 'dark', textSize: 'medium' });

// Checks what the Settings form sent. Both fields are required -- the form
// always submits a choice for each -- so a missing or unknown value means a
// hand-edited request, and nothing is saved.
//
// Returns { ok: true, settings: { theme, textSize } } or { ok: false, error }.
// Never throws: bad input is expected, not a bug.
export function resolveSettings(input) {
    const theme = typeof input?.theme === 'string' ? input.theme.trim().toLowerCase() : '';
    const textSize = typeof input?.textSize === 'string' ? input.textSize.trim().toLowerCase() : '';

    if (!THEMES.includes(theme)) {
        return { ok: false, error: 'Choose light or dark mode.' };
    }
    if (!TEXT_SIZES.includes(textSize)) {
        return { ok: false, error: 'Choose a small, medium, or large text size.' };
    }
    return { ok: true, settings: { theme, textSize } };
}

// Turns whatever is stored (a users row, a session object, or nothing at all)
// into settings that are safe to render. A value that isn't one of the known
// choices falls back to the default for just that field, so one bad column
// can never break every page.
export function normalizeSettings(stored) {
    const theme = THEMES.includes(stored?.theme) ? stored.theme : DEFAULT_SETTINGS.theme;
    const textSize = TEXT_SIZES.includes(stored?.textSize ?? stored?.text_size)
        ? (stored.textSize ?? stored.text_size)
        : DEFAULT_SETTINGS.textSize;
    return { theme, textSize };
}