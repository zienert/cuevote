// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from "react";
import PropTypes from "prop-types";
import { Library, List, Send } from "lucide-react";
import { Language } from "../contexts/LanguageContext";

/**
 * PROTOTYPE (design proposal b). The room's bar at the bottom of a phone:
 * the playlist and the library as tabs, and between them the one thing a guest
 * came to do, suggesting.
 */
export function PhoneTabBar({ mode, onPlaylist, onLibrary, onSuggest, suggestDisabled }) {
	const { t } = Language.useLanguage();

	const tab = (active, onClick, Icon, label) => (
		<button
			type="button"
			onClick={onClick}
			aria-current={active ? "page" : undefined}
			className={`keep-open flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 transition-colors active:scale-95 ${active ? "text-orange-500" : "text-neutral-400 hover:text-neutral-200"}`}
		>
			<Icon size={20} aria-hidden="true" />
			<span className="max-w-full truncate px-1 text-[11px] font-medium leading-normal">{label}</span>
		</button>
	);

	return (
		<nav className="flex items-center gap-1 px-2 py-2">
			{tab(mode === "playlist", onPlaylist, List, t('header.playlist'))}
			<button
				type="button"
				onClick={onSuggest}
				disabled={suggestDisabled}
				className={`keep-open flex h-12 flex-none items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-orange-600 px-6 font-semibold text-white shadow-lg shadow-orange-500/30 transition-all active:scale-95 ${suggestDisabled ? "opacity-40" : "hover:from-orange-400 hover:to-orange-500"}`}
			>
				<Send size={18} aria-hidden="true" />
				<span className="max-w-[9rem] truncate">{t('header.suggest')}</span>
			</button>
			{tab(mode === "library", onLibrary, Library, t('header.library'))}
		</nav>
	);
}

PhoneTabBar.propTypes = {
	mode: PropTypes.string,
	onPlaylist: PropTypes.func.isRequired,
	onLibrary: PropTypes.func.isRequired,
	onSuggest: PropTypes.func.isRequired,
	suggestDisabled: PropTypes.bool,
};
