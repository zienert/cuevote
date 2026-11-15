// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from "react";
import PropTypes from "prop-types";

// What a player shows in place of playback, and the lobby in place of its
// channels. Two weights: a card when there is something to do (sign in, start,
// try again), a quiet line when there is not (loading, nothing queued).

/**
 * A card over the player: a symbol, what is going on, what to do about it.
 * `tone="attention"` marks a problem. `code` is a technical code for support,
 * shown small below everything else.
 */
export function StatusCard({ icon: Icon, tone = "neutral", title, text, code, children }) {
	return (
		<div className="w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-950/80 p-6 text-center shadow-2xl md:max-w-md md:p-8">
			{Icon && (
				<div
					className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full md:h-14 md:w-14 ${tone === "attention"
						? "bg-orange-500/15 text-orange-400"
						: "bg-white/10 text-neutral-200"}`}
				>
					<Icon size={24} aria-hidden="true" />
				</div>
			)}
			{title && <p className="text-base font-semibold leading-snug text-white text-balance md:text-lg">{title}</p>}
			{text && <p className={`text-sm leading-relaxed text-neutral-300 text-balance md:text-base ${title ? "mt-1.5" : ""}`}>{text}</p>}
			{children && <div className="mt-5 flex flex-col gap-2">{children}</div>}
			{code && <p className="mt-4 select-all font-mono text-[11px] tracking-wide text-neutral-500">{code}</p>}
		</div>
	);
}

StatusCard.propTypes = {
	icon: PropTypes.elementType,
	tone: PropTypes.oneOf(["neutral", "attention"]),
	title: PropTypes.node,
	text: PropTypes.node,
	code: PropTypes.string,
	children: PropTypes.node,
};

/** A card's action. `busy` turns the symbol into a spinner and blocks the button. */
export function StatusButton({ variant = "primary", icon: Icon, busy = false, children, ...props }) {
	const look = variant === "primary"
		? "bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20 hover:from-orange-400 hover:to-orange-500"
		: "bg-white/10 text-white hover:bg-white/15";
	return (
		<button
			type="button"
			disabled={busy}
			className={`flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 font-semibold transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-wait disabled:opacity-70 ${look}`}
			{...props}
		>
			{busy
				? <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
				: Icon && <Icon size={18} aria-hidden="true" />}
			{children}
		</button>
	);
}

StatusButton.propTypes = {
	variant: PropTypes.oneOf(["primary", "secondary"]),
	icon: PropTypes.elementType,
	busy: PropTypes.bool,
	children: PropTypes.node,
};

/** One quiet line, for states that pass on their own or need nothing. */
export function StatusLine({ icon: Icon, spin = false, children }) {
	return (
		<p className="flex items-center justify-center gap-2.5 text-sm text-neutral-400">
			{Icon && <Icon size={18} className={spin ? "animate-spin" : ""} aria-hidden="true" />}
			<span>{children}</span>
		</p>
	);
}

StatusLine.propTypes = {
	icon: PropTypes.elementType,
	spin: PropTypes.bool,
	children: PropTypes.node,
};

/** A slim bar above the playlist: one line everyone in the room should know. */
export function StatusBar({ icon: Icon, children }) {
	return (
		<div role="status" className="flex-none border-b border-neutral-800 bg-neutral-900/80 px-4 py-2">
			<p className="mx-auto flex max-w-3xl items-center justify-center gap-2 text-xs leading-snug text-neutral-300">
				{Icon && <Icon size={14} className="shrink-0 text-orange-400" aria-hidden="true" />}
				<span>{children}</span>
			</p>
		</div>
	);
}

StatusBar.propTypes = {
	icon: PropTypes.elementType,
	children: PropTypes.node,
};
