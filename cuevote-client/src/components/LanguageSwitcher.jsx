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
	{ code: 'sr', label: 'Srpski' },
	{ code: 'sk', label: 'Slovenčina' },
	{ code: 'ar', label: 'العربية' },
	{ code: 'he', label: 'עברית' }
];

function LanguageSwitcher({ minimized = false, className = "", isOpen: controlledIsOpen, onToggle: controlledOnToggle, focused = false, focusedLanguageIndex = -1 }) {
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
				className={`flex items-center gap-2 p-2 rounded-full hover:bg-neutral-800 transition-all ${isOpen ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'} ${focused ? 'ring-2 ring-orange-500 text-white z-20 bg-neutral-800' : ''}`}
				title={t('header.changeLanguage')}
			>
				<Globe size={20} />
				{!minimized && <span className="text-sm font-medium uppercase font-mono">{language}</span>}
			</button>

			{isOpen && (
				<div
					ref={listRef}
					className="absolute right-0 top-full mt-2 w-48 bg-[#1a1a1a] border border-neutral-800 rounded-xl shadow-xl overflow-hidden py-1 z-[100] animate-in fade-in zoom-in-95 duration-200 max-h-80 overflow-y-auto"
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
							className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between hover:bg-neutral-800 transition-colors ${language === lang.code ? 'text-orange-500 font-bold bg-orange-500/10' : 'text-neutral-300'} ${focusedLanguageIndex === index ? 'bg-neutral-800 text-white ring-1 ring-inset ring-neutral-700' : ''}`}
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
