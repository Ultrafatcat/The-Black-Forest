// server/game/friends.js
//
// The rules for friend requests on the Friends page (Checkpoint 6). Split
// out from the routes the same way attributePoints.js and combat.js are --
// plain functions over rows, with no Express or database, so every rule is a
// unit test instead of a click-through.
//
// A friendship row is { id, requester_user_id, addressee_user_id, status }
// with status 'pending', 'accepted' or 'declined'. A pair of players has at
// most one row, whichever of them asked first.

// Decides what happens when `requesterId` asks the player named
// `targetUsername` to be friends. `addressee` is that player's users row (or
// undefined if no such account exists) and `existingRows` are any friendship
// rows already between the two, in either direction.
//
// Returns { ok: false, error } for the form to show, or { ok: true, action }
// where action is 'create' (insert a new pending row) or 'reopen' (flip a
// previously declined row back to pending, with the new requester). Never
// throws -- a typo'd name or a duplicate click is expected input, not a bug.
export function resolveFriendRequest(requesterId, targetUsername, addressee, existingRows) {
    if (!addressee) {
        return { ok: false, error: `No player named "${targetUsername}" was found.` };
    }
    if (addressee.id === requesterId) {
        return { ok: false, error: "You can't send a friend request to yourself." };
    }

    const existing = existingRows[0];
    if (!existing) {
        return { ok: true, action: 'create' };
    }

    if (existing.status === 'accepted') {
        return { ok: false, error: `You're already friends with ${addressee.nickname}.` };
    }
    if (existing.status === 'pending') {
        return existing.requester_user_id === requesterId
            ? { ok: false, error: `You already sent ${addressee.nickname} a friend request.` }
            : { ok: false, error: `${addressee.nickname} already sent you a request -- accept it below.` };
    }

    // Declined earlier. That isn't a permanent block, so asking again reopens it.
    return { ok: true, action: 'reopen', friendshipId: existing.id };
}

// Decides whether `userId` may accept or decline `friendship`. Only the player
// who was asked can answer, and only while the request is still pending.
// Returns { ok: true, status } with the status to store, or { ok: false, error }.
export function resolveFriendResponse(userId, friendship, decision) {
    if (decision !== 'accept' && decision !== 'decline') {
        return { ok: false, error: 'Choose accept or decline.' };
    }
    if (!friendship || friendship.addressee_user_id !== userId) {
        // Same answer whether the request is missing or someone else's, so
        // guessing ids reveals nothing about other players' requests.
        return { ok: false, error: 'That friend request was not found.' };
    }
    if (friendship.status !== 'pending') {
        return { ok: false, error: 'That friend request has already been answered.' };
    }
    return { ok: true, status: decision === 'accept' ? 'accepted' : 'declined' };
}

// The other player in a friendship, from `userId`'s point of view.
export function otherUserId(friendship, userId) {
    return friendship.requester_user_id === userId
        ? friendship.addressee_user_id
        : friendship.requester_user_id;
}

// Ids of everyone `userId` is friends with, from a list of their friendship
// rows. Only accepted rows count -- pending and declined are not friends.
export function acceptedFriendIds(friendships, userId) {
    return friendships
        .filter((friendship) => friendship.status === 'accepted')
        .map((friendship) => otherUserId(friendship, userId));
}
// How `myId` stands with `otherId`, from any list of friendship rows that
// includes the pair. One of:
//   'friends'          -- an accepted friendship
//   'request_sent'     -- I asked them and it's still pending
//   'request_received' -- they asked me and it's still pending
//   'none'             -- no row, or a declined one (a declined request
//                         doesn't block asking again, see resolveFriendRequest)
// The Leaderboard uses this to decide which button each row gets.
export function relationshipStatus(friendships, myId, otherId) {
    const row = friendships.find((friendship) =>
        (friendship.requester_user_id === myId && friendship.addressee_user_id === otherId)
        || (friendship.requester_user_id === otherId && friendship.addressee_user_id === myId));

    if (!row || row.status === 'declined') {
        return 'none';
    }
    if (row.status === 'accepted') {
        return 'friends';
    }
    return row.requester_user_id === myId ? 'request_sent' : 'request_received';
}