// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from "react";
import PropTypes from "prop-types";

// Placeholders in the shape of what is on its way: the lobby's channels, a
// channel's header and playlist. A soft light passes over them, one after the
// other (`.skeleton` in index.css), so the page reads as loading and not as
// empty. No words: they also stand in before any translation has loaded.

// The light reaches each placeholder this much later than the one before it.
const STEP_MS = 110;

function Bone({ className = "", order = 0, children }) {
	return (
		<div className={`skeleton ${className}`} style={order ? { animationDelay: `${order * STEP_MS}ms` } : undefined}>
			{children}
		</div>
	);
}

Bone.propTypes = {
	className: PropTypes.string,
	order: PropTypes.number,
	children: PropTypes.node,
};

/** The lobby's place for its channels while the list is on its way. */
export function LobbySkeleton({ label = "Loading" }) {
	return (
		<div role="status" aria-label={label} className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
			{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
				// Two full rows on a computer, three on a phone.
				<Bone
					key={i}
					order={i}
					className={`relative aspect-[4/3] rounded-2xl border border-line bg-card ${i > 5 ? "hidden lg:block" : ""}`}
				>
					{/* Where a card has its name and its count: at the bottom. */}
					<div className="absolute inset-x-3 bottom-3 space-y-2.5 sm:inset-x-5 sm:bottom-5">
						<div className="h-4 w-3/4 rounded-full bg-white/[0.07]" />
						<div className="h-3 w-1/3 rounded-full bg-white/[0.05]" />
					</div>
				</Bone>
			))}
		</div>
	);
}

LobbySkeleton.propTypes = {
	label: PropTypes.string,
};

/**
 * A channel that is opening, in the room's own measures: the header with the
 * wordmark where it will be, then the playlist on a phone or the player on a
 * computer, and the bar at the bottom.
 */
export function RoomSkeleton({ label = "Loading" }) {
	return (
		<div role="status" aria-label={label} className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-page text-ink">
			<div className="flex-none border-b border-line bg-page">
				<div className="w-full px-2 py-1.5 md:px-3 md:py-2 safe-pt">
					<div className="md:hidden">
						<div className="flex items-center gap-1">
							<span className="h-8 w-8 flex-none" />
							<span className="flex-none whitespace-nowrap text-lg font-bold tracking-tight text-accent">CueVote</span>
							<div className="ml-2 min-w-0 flex-1 space-y-1.5">
								<Bone className="h-3 w-28 rounded-full bg-raised" />
								<Bone className="h-2 w-20 rounded-full bg-card" />
							</div>
							<Bone className="h-9 w-9 flex-none rounded-lg bg-card" />
							<Bone className="h-7 w-7 flex-none rounded-full bg-card" />
						</div>
						<div className="mb-0.5 mt-2 grid grid-cols-2 rounded-xl border border-line bg-page p-1">
							<Bone className="h-10 rounded-lg bg-card" />
						</div>
					</div>
					<div className="hidden h-9 items-center gap-5 md:flex">
						<span className="whitespace-nowrap text-lg font-bold tracking-tight text-accent">CueVote</span>
						<Bone className="h-7 w-7 rounded-full bg-card" />
						<Bone className="h-3.5 w-32 rounded-full bg-card" />
						<Bone className="h-3.5 w-28 rounded-full bg-card" />
						<Bone className="h-3.5 w-36 rounded-full bg-card" />
					</div>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-hidden md:hidden">
				<div className="mx-auto max-w-3xl space-y-1 px-3 py-4">
					<Bone className="mb-3 ml-3 h-3 w-28 rounded-full bg-card" />
					{[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
						<Bone key={i} order={i + 1} className="flex items-center gap-3 rounded-xl bg-card px-3 py-2.5">
							<div className="h-12 w-12 flex-none rounded-lg bg-white/[0.06]" />
							<div className="min-w-0 flex-1 space-y-2.5">
								<div className="h-3.5 w-3/5 rounded-full bg-white/[0.07]" />
								<div className="h-3 w-2/5 rounded-full bg-white/[0.05]" />
							</div>
						</Bone>
					))}
				</div>
			</div>
			<div className="hidden min-h-0 flex-1 items-center justify-center bg-black md:flex">
				<Bone className="h-20 w-20 rounded-full bg-card" />
			</div>

			<div
				className="flex-none border-t border-line bg-page px-3 pt-2 md:hidden"
				style={{ paddingBottom: 'calc(0.5rem + var(--sab))' }}
			>
				<div className="flex items-center gap-2">
					<div className="h-11 min-w-0 flex-1 rounded-full border border-line bg-card" />
					<Bone className="h-11 w-11 flex-none rounded-full bg-card" />
				</div>
			</div>
			<div className="hidden flex-none items-center gap-3 border-t border-line bg-page px-6 py-5 md:flex">
				<Bone className="h-11 w-11 flex-none rounded-full bg-card" />
				<div className="min-w-0 flex-1 space-y-2.5">
					<Bone className="h-3.5 w-56 rounded-full bg-card" />
					<Bone className="h-3 w-40 rounded-full bg-card" />
				</div>
				<Bone className="h-3 w-40 flex-none rounded-full bg-card" />
			</div>
		</div>
	);
}

RoomSkeleton.propTypes = {
	label: PropTypes.string,
};
