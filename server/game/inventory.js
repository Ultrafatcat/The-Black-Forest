// server/game/inventory.js
//
// The Inventory page's equip/use rules (Checkpoint 4). Same pattern as
// attributePoints.js -- plain, testable functions with no Express or
// database access. The route fetches the character/item/character_item
// rows as plain data, calls one of these, and applies whatever the result
// says to the database.

export const EQUIPPABLE_TYPES = ['weapon', 'armor'];

export function isEquippable(item) {
    return EQUIPPABLE_TYPES.includes(item.item_type);
}

export function isConsumable(item) {
    return item.item_type === 'consumable';
}

// Toggles is_equipped. There's no equip-slot limit yet (e.g. one weapon at
// a time), so this never fails for an equippable item -- it only rejects
// items that were never equippable in the first place, which the Inventory
// page's buttons shouldn't allow but a route still has to guard against.
export function resolveEquip(item, characterItem) {
    if (!isEquippable(item)) {
        return { ok: false, error: `${item.name} can't be equipped.` };
    }

    return { ok: true, isEquipped: characterItem.is_equipped ? 0 : 1 };
}

// Using a consumable heals the character (capped at max_health) and
// consumes one from the stack -- the caller deletes the character_items
// row entirely when removeRow comes back true, same as TAKE's "last one"
// handling in commandParser.js.
export function resolveUse(character, item, characterItem) {
    if (!isConsumable(item)) {
        return { ok: false, error: `${item.name} can't be used.` };
    }

    const newHealth = Math.min(character.max_health, character.health + item.heal_amount);
    const newQuantity = characterItem.quantity - 1;

    return {
        ok: true,
        newHealth,
        newQuantity,
        removeRow: newQuantity <= 0,
    };
}