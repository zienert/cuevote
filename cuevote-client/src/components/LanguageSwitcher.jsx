// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
/* eslint-disable react-refresh/only-export-components --
 * This module deliberately exports both a component (LanguageSwitcher)
 * and a non-component object (LanguageSwitcherExports) so the bundler
 * keeps the two together and TDZ ordering is preserved
 * (see docs/TDZ-FIXES.md). Fast-refresh is given up for this file.
 */
import React, { useState, useRef, useEffect } from 'react';
import { Globe, Check } from 'lucide-react';
import { Language } from '../contexts/LanguageContext';

// Single export object so bundler cannot reorder and cause TDZ (see docs/TDZ-FIXES.md).
const languages = [
	{ code: 'en', label: 'English' },
	{ code: 'nl', label: 'Nederlands' },
	{ code: 'de', label: 'Deutsch' },
	{ code: 'fr', label: 'Français' },
	{ code: 'es', label: 'Español' },
	{ code: 'it', label: 'Italiano' },
	{ code: 'pt', label: 'Português' },
	{ code: 'zh-CN', label: '简体中文' },
	{ code: 'zh-TW', label: '繁體中文' },
	{ code: 'ja', label: '日本語' },
	{ code: 'ko', label: '한국어' },
	{ code: 'hi', label: 'हिन्दी' },
	{ code: 'th', label: 'ไทย' },
	{ code: 'vi', label: 'Tiếng Việt' },
	{ code: 'id', label: 'Bahasa Indonesia' },
	{ code: 'ms', label: 'Bahasa Melayu' },
	{ code: 'tl', label: 'Tagalog' },
	{ code: 'pl', label: 'Polski' },
	{ code: 'sv', label: 'Svenska' },
	{ code: 'da', label: 'Dansk' },
	{ code: 'no', label: 'Norsk' },
	{ code: 'fi', label: 'Suomi' },
	{ code: 'tr', label: 'Türkçe' },
	{ code: 'el', label: 'Ελληνικά' },
	{ code: 'ru', label: 'Русский' },
	{ code: 'uk', label: 'Українська' },
	{ code: 'cs', label: 'Čeština' },
	{ code: 'hu', label: 'Magyar' },
	{ code: 'ro', label: 'Română' },
	{ code: 'bg', label: 'Български' },
	{ code: 'hr', label: 'Hrvatski' },
	{ code: 'sr', label: 'Српски' },
	{ code: 'sk', label: 'Slovenčina' },
	{ code: 'ar', label: 'العربية' },
	{ code: 'he', label: 'עברית' }
];

// `compact`: on a phone only the globe shows, where the header has to hold
// the sign-in button as well.
function LanguageSwitcher({ minimized = false, compact = false, className = "", isOpen: controlledIsOpen, onToggle: controlledOnToggle, focused = false, focusedLanguageIndex = -1 }) {
	const { language, setLanguage, t } = Language.useLanguage();
	const [internalIsOpen, setInternalIsOpen] = useState(false);
	const dropdownRef = useRef(null);
	const listRef = useRef(null);

	const isControlled = controlledIsOpen !== undefined;
	const isOpen = isControlled ? controlledIsOpen : internalIsOpen;

	useEffect(() => {
		const handleClickOutside = (event) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
				// Only close if it's internal state, generic click outside logic
				if (!isControlled) setInternalIsOpen(false);
				else if (controlledOnToggle) controlledOnToggle(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isControlled, controlledOnToggle]);

	// Auto-scroll to focused language
	useEffect(() => {
		if (isOpen && focusedLanguageIndex >= 0 && listRef.current) {
			const children = listRef.current.children;
			if (children && children[focusedLanguageIndex]) {
				children[focusedLanguageIndex].scrollIntoView({ block: 'nearest' });
			}
		}
	}, [isOpen, focusedLanguageIndex]);


	return (
		<div className={`relative ${className}`} ref={dropdownRef} id="lobby-language-switcher">
			<button
				onClick={(e) => {
					e.stopPropagation();
					if (isControlled) controlledOnToggle && controlledOnToggle(!isOpen);
					else setInternalIsOpen(!internalIsOpen);
				}}
				className={`flex h-9 items-center gap-1.5 rounded-lg px-2 transition-colors duration-150 hover:bg-raised ${isOpen ? 'bg-raised text-ink' : 'text-ink-2 hover:text-ink'} ${focused ? 'ring-2 ring-accent text-ink z-20 bg-raised' : ''}`}
				title={t('header.changeLanguage')}
			>
				<Globe size={18} />
				{!minimized && <span className={`text-[13px] font-medium uppercase ${compact ? "max-sm:hidden" : ""}`}>{language}</span>}
			</button>

			{isOpen && (
				<div
					ref={listRef}
					className="absolute right-0 top-full mt-2 w-48 origin-top-right bg-card border border-line rounded-xl shadow-xl overflow-hidden py-1 z-[100] animate-in fade-in zoom-in-95 duration-150 max-h-80 overflow-y-auto"
				>
					{languages.map((lang, index) => (
						<button
							key={lang.code}
							onClick={(e) => {
								e.stopPropagation();
								setLanguage(lang.code);
								if (isControlled) controlledOnToggle && controlledOnToggle(false);
								else setInternalIsOpen(false);
							}}
							className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-raised transition-colors duration-150 ${language === lang.code ? 'text-accent font-medium bg-accent/10' : 'text-ink'} ${focusedLanguageIndex === index ? 'bg-raised text-ink ring-1 ring-inset ring-ink/20' : ''}`}
						>
							<span>{lang.label}</span>
							{language === lang.code && <Check size={16} />}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export const LanguageSwitcherExports = { languages, LanguageSwitcher };
