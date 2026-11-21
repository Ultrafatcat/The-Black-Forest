// test/friends.test.js
//
// Unit tests for the friend request rules (Checkpoint 6). Pure functions,
// no app or database needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveFriendRequest,
    resolveFriendResponse,
    otherUserId,
    acceptedFriendIds,
    relationshipStatus,
} from '../server/game/friends.js';

const me = 1;
const ann = { id: 2, username: 'ann', nickname: 'Ann' };

function row(overrides = {}) {
    return { id: 10, requester_user_id: me, addressee_user_id: 2, status: 'pending', ...overrides };
}

test('a request to an existing player with no history creates a new request', () => {
    const result = resolveFriendRequest(me, 'ann', ann, []);
    assert.deepEqual(result, { ok: true, action: 'create' });
});

test('a request to a name that matches no one is rejected with that name in the message', () => {
    const result = resolveFriendRequest(me, 'nobody', undefined, []);
    assert.equal(result.ok, false);
    assert.match(result.error, /No player named "nobody"/);
});

test('you cannot send a friend request to yourself', () => {
    const result = resolveFriendRequest(me, 'me', { id: me, nickname: 'Me' }, []);
    assert.equal(result.ok, false);
    assert.match(result.error, /yourself/);
});

test('asking someone you are already friends with is rejected', () => {
    const result = resolveFriendRequest(me, 'ann', ann, [row({ status: 'accepted' })]);
    assert.equal(result.ok, false);
    assert.match(result.error, /already friends with Ann/);
});

test('asking again while your own request is still pending is rejected', () => {
    const result = resolveFriendRequest(me, 'ann', ann, [row({ status: 'pending' })]);
    assert.equal(result.ok, false);
    assert.match(result.error, /already sent Ann a friend request/);
});

test('asking someone who already asked you points you at their request instead of duplicating it', () => {
    const theirs = row({ requester_user_id: 2, addressee_user_id: me, status: 'pending' });
    const result = resolveFriendRequest(me, 'ann', ann, [theirs]);
    assert.equal(result.ok, false);
    assert.match(result.error, /already sent you a request/);
});

test('a declined request can be sent again, reopening the same row', () => {
    const result = resolveFriendRequest(me, 'ann', ann, [row({ status: 'declined' })]);
    assert.deepEqual(result, { ok: true, action: 'reopen', friendshipId: 10 });
});

test('accepting a pending request addressed to you stores accepted', () => {
    const request = row({ requester_user_id: 2, addressee_user_id: me });
    assert.deepEqual(resolveFriendResponse(me, request, 'accept'), { ok: true, status: 'accepted' });
});

test('declining a pending request addressed to you stores declined', () => {
    const request = row({ requester_user_id: 2, addressee_user_id: me });
    assert.deepEqual(resolveFriendResponse(me, request, 'decline'), { ok: true, status: 'declined' });
});

test('the player who sent a request cannot answer it themselves', () => {
    const result = resolveFriendResponse(me, row({ requester_user_id: me, addressee_user_id: 2 }), 'accept');
    assert.equal(result.ok, false);
    assert.match(result.error, /not found/);
});

test('a third player cannot answer someone else\'s request', () => {
    const result = resolveFriendResponse(3, row({ requester_user_id: 2, addressee_user_id: me }), 'accept');
    assert.equal(result.ok, false);
});

test('a missing request is reported the same way as someone else\'s', () => {
    const result = resolveFriendResponse(me, undefined, 'accept');
    assert.equal(result.ok, false);
    assert.match(result.error, /not found/);
});

test('a request that was already answered cannot be answered again', () => {
    const request = row({ requester_user_id: 2, addressee_user_id: me, status: 'accepted' });
    const result = resolveFriendResponse(me, request, 'decline');
    assert.equal(result.ok, false);
    assert.match(result.error, /already been answered/);
});

test('an unknown decision is rejected', () => {
    const request = row({ requester_user_id: 2, addressee_user_id: me });
    assert.equal(resolveFriendResponse(me, request, 'maybe').ok, false);
});

test('otherUserId returns the other side from either point of view', () => {
    const friendship = row({ requester_user_id: 1, addressee_user_id: 2 });
    assert.equal(otherUserId(friendship, 1), 2);
    assert.equal(otherUserId(friendship, 2), 1);
});

test('acceptedFriendIds lists only accepted friendships, in either direction', () => {
    const friendships = [
        row({ id: 1, requester_user_id: 1, addressee_user_id: 2, status: 'accepted' }),
        row({ id: 2, requester_user_id: 3, addressee_user_id: 1, status: 'accepted' }),
        row({ id: 3, requester_user_id: 1, addressee_user_id: 4, status: 'pending' }),
        row({ id: 4, requester_user_id: 5, addressee_user_id: 1, status: 'declined' }),
    ];
    assert.deepEqual(acceptedFriendIds(friendships, 1), [2, 3]);
});
test('relationshipStatus is none when there is no row', () => {
    assert.equal(relationshipStatus([], 1, 2), 'none');
});

test('relationshipStatus reports friends for an accepted row, from either side', () => {
    const rows = [row({ requester_user_id: 1, addressee_user_id: 2, status: 'accepted' })];
    assert.equal(relationshipStatus(rows, 1, 2), 'friends');
    assert.equal(relationshipStatus(rows, 2, 1), 'friends');
});

test('relationshipStatus tells a sent request from a received one', () => {
    const rows = [row({ requester_user_id: 1, addressee_user_id: 2, status: 'pending' })];
    assert.equal(relationshipStatus(rows, 1, 2), 'request_sent');
    assert.equal(relationshipStatus(rows, 2, 1), 'request_received');
});

test('relationshipStatus treats a declined row as none so asking again is allowed', () => {
    const rows = [row({ requester_user_id: 1, addressee_user_id: 2, status: 'declined' })];
    assert.equal(relationshipStatus(rows, 1, 2), 'none');
    assert.equal(relationshipStatus(rows, 2, 1), 'none');
});

test('relationshipStatus ignores rows about other pairs', () => {
    const rows = [row({ requester_user_id: 3, addressee_user_id: 4, status: 'accepted' })];
    assert.equal(relationshipStatus(rows, 1, 2), 'none');
});