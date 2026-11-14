// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert

/**
 * Whether this viewer is backed by a real account.
 *
 * `user` is truthy for guests too, so `user ? … : <sign in>` now means "has any
 * identity" — which hid the sign-in button from everyone who had not already
 * signed in. Anything that needs an account (creating a channel, the profile
 * and delete-account UI, connecting an AI) must ask this instead.
 */
export function isSignedIn(user) {
	return !!(user && !user.isGuest);
}

/**
 * A translation key for a refusal the server sent, or null when we have none
 * and the server's own message should be shown.
 */
export function participationErrorKey(code) {
	switch (code) {
		case 'LOGIN_REQUIRED': return 'errors.loginRequired';
		case 'ACCOUNT_REQUIRED': return 'errors.accountRequired';
		case 'NO_IDENTITY': return 'errors.sessionNotReady';
		case 'GUEST_LIMIT': return 'errors.guestLimit';
		case 'APPLE_MUSIC_UNAVAILABLE': return 'errors.appleMusicUnavailable';
		case 'APPLE_MUSIC_NOT_CONNECTED': return 'errors.appleMusicNotConnected';
		case 'APPLE_MUSIC_ROOM': return 'errors.appleMusicRoom';
		case 'APPLE_MUSIC_NOT_FOUND': return 'errors.appleMusicNotFound';
		case 'APPLE_MUSIC_LINK_UNSUPPORTED': return 'errors.appleMusicLinkUnsupported';
		case 'APPLE_MUSIC_NOT_IN_STOREFRONT': return 'errors.appleMusicNotInStorefront';
		case 'APPLE_MUSIC_CATALOG_ERROR': return 'errors.appleMusicCatalogError';
		default: return null;
	}
}

/**
 * Whether this viewer may vote and suggest in this room.
 *
 * Mirrors Room.canParticipate on the server. The server decides — this only
 * exists so the UI can explain the rule up front instead of letting someone tap
 * a vote button and collect an error toast.
 */
export function canParticipate(user, requireLogin) {
	if (!user) return false;
	if (requireLogin && user.isGuest) return false;
	return true;
}

/**
 * The name to show for a signed-in user or a guest.
 *
 * The server names a guest "Guest ABCD" so that clients which know nothing
 * about guests still show something sensible. Anywhere the name is shown to a
 * person, translate the word instead — a German UI should greet a "Gast".
 */
export function displayName(user, t) {
	if (!user) return '';
	if (user.isGuest) {
		return user.guestTag ? `${t('track.guest')} ${user.guestTag}` : t('track.guest');
	}
	return user.name || '';
}

/**
 * The name to show next to a track for whoever suggested it.
 *
 * Guests have no account name, so the server sends a flag and a short tag and
 * the word itself is translated here — otherwise every guest in a German room
 * would be labelled "Guest".
 */
export function suggesterLabel(track, t) {
	if (!track) return null;
	if (track.suggestedByIsGuest) {
		return track.suggestedByGuestTag
			? `${t('track.guest')} ${track.suggestedByGuestTag}`
			: t('track.guest');
	}
	return track.suggestedByUsername || null;
}
