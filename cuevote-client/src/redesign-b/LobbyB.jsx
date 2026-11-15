// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// Design proposal B ("Neu"), DEV previews only (/__lobby-preview?design=b).
//
// The start page says first what CueVote is, in one sentence and with a small
// chart that can be voted on, then shows what is open right now. Everything
// the lobby does stays: the three lists, the search, the country filter,
// creating a channel, signing in, the language.
//
// A draft. It speaks the lobby's real messages (LIST_ROOMS, CREATE_ROOM). Not
// built: the arrow-key focus of a TV remote, pages for long lists, checking a
// channel's password, the account dialog with "delete account".
import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Lock, LogOut, Plus, Search, Users, X } from 'lucide-react';
import { useWebSocketContext } from '../hooks/useWebSocketContext';
import { Consent } from '../contexts/ConsentContext';
import { Language } from '../contexts/LanguageContext';
import { LanguageSwitcherExports } from '../components/LanguageSwitcher';
import { GoogleAuthButton } from '../components/GoogleAuthButton';
import { GoogleGIcon } from '../components/GoogleGIcon';
import { SegmentedControl } from '../components/SegmentedControl';
import { YouTubeBrandSubtitle } from '../components/YouTubeBrandSubtitle';
import { channelLanguages, getFlagEmoji } from '../constants/channelLanguages';
import { displayName, isSignedIn } from '../utils/participation';
import { DEVELOPER_TOKEN_URL } from '../utils/musicKit';
import { Wordmark, ChartRow, BButton } from './parts';
import { useLightPage, useFlip } from './hooks';
import { useCopy } from './copy';

const { LanguageSwitcher } = LanguageSwitcherExports;

// Stage-light stand-ins for the covers of the example chart: nothing is
// loaded from YouTube or Apple for it.
function exampleCover(base, glowA, glowB) {
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">'
		+ `<defs><radialGradient id="a" cx="20%" cy="15%" r="80%"><stop offset="0" stop-color="${glowA}"/><stop offset="1" stop-color="${glowA}" stop-opacity="0"/></radialGradient>`
		+ `<radialGradient id="b" cx="85%" cy="85%" r="75%"><stop offset="0" stop-color="${glowB}"/><stop offset="1" stop-color="${glowB}" stop-opacity="0"/></radialGradient></defs>`
		+ `<rect width="120" height="120" fill="${base}"/><rect width="120" height="120" fill="url(#a)"/><rect width="120" height="120" fill="url(#b)"/></svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const EXAMPLE = [
	{ id: 'x1', title: 'Flowers', artist: 'Miley Cyrus', score: 5, thumbnail: exampleCover('#0a1410', '#22c55e', '#0ea5e9') },
	{ id: 'x2', title: 'Mr. Brightside', artist: 'The Killers', score: 4, thumbnail: exampleCover('#1f1021', '#ec4899', '#8b5cf6') },
	{ id: 'x3', title: '99 Luftballons', artist: 'Nena', score: 4, thumbnail: exampleCover('#1c1917', '#facc15', '#ea580c') },
	{ id: 'x4', title: 'Bad Guy', artist: 'Billie Eilish', score: 2, thumbnail: exampleCover('#0f172a', '#38bdf8', '#f472b6') },
];

// The highest count first; equal counts keep their order.
function ranked(tracks) {
	return tracks.map((track, index) => ({ track, index }))
		.sort((a, b) => (b.track.score - a.track.score) || (a.index - b.index))
		.map((entry) => entry.track);
}

/**
 * A room in small: the screen, and under it four places that can be voted on.
 * Once, a moment after the page is up, a vote from "someone else" arrives and
 * a title climbs, so the idea shows without a click.
 */
function ExampleChart() {
	const { t } = Language.useLanguage();
	const c = useCopy();
	const [tracks, setTracks] = useState(EXAMPLE);
	const touched = useRef(false);
	const list = useRef(null);
	useFlip(list, tracks.map((track) => track.id).join(' '));

	useEffect(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
		const timer = setTimeout(() => {
			if (touched.current) return;
			setTracks((now) => ranked(now.map((track) => (track.id === 'x3' ? { ...track, score: track.score + 1 } : track))));
		}, 1600);
		return () => clearTimeout(timer);
	}, []);

	const vote = (id, type) => {
		touched.current = true;
		setTracks((now) => ranked(now.map((track) => {
			if (track.id !== id) return track;
			const before = track.myVote === 'up' ? 1 : track.myVote === 'down' ? -1 : 0;
			const myVote = track.myVote === type ? undefined : type;
			const after = myVote === 'up' ? 1 : myVote === 'down' ? -1 : 0;
			return { ...track, myVote, score: track.score - before + after };
		})));
	};

	return (
		<figure className="m-0">
			<div className="rounded-[28px] bg-card p-3">
				<div className="b-video-still relative aspect-video overflow-hidden rounded-2xl">
					<div className="absolute inset-x-0 bottom-0 p-4">
						<p className="text-[13px] font-semibold text-accent">{t('playlist.nowPlaying')}</p>
						<p className="b-display mt-1 text-[32px] text-white">As It Was</p>
						<p className="text-[14px] text-white/85">Harry Styles</p>
					</div>
				</div>
				<ol ref={list} className="relative mt-3 rounded-2xl bg-page px-3 [&>li:last-child]:border-b-0">
					{tracks.map((track, index) => (
						<ChartRow
							key={track.id}
							place={index + 1}
							track={track}
							vote={track.myVote}
							onVote={vote}
							labels={{ up: c('voteUp'), down: c('voteDown') }}
							localCover
						/>
					))}
				</ol>
			</div>
			<figcaption className="mt-3 px-3 text-[15px] text-ink">
				<span className="text-ink-3">{c('demoLabel')}.</span> {c('demoHint')}
			</figcaption>
		</figure>
	);
}

function useCountries(language) {
	return useMemo(() => {
		const names = new Intl.DisplayNames([language, 'en'], { type: 'region' });
		return channelLanguages
			.filter((entry) => entry.code !== 'international')
			.map((entry) => ({ code: entry.code, emoji: entry.emoji, label: names.of(entry.code) || entry.code }))
			.sort((a, b) => a.label.localeCompare(b.label, language));
	}, [language]);
}

function Field({ label, children }) {
	return (
		<label className="block">
			<span className="mb-1.5 block text-[14px] font-semibold text-ink">{label}</span>
			{children}
		</label>
	);
}

Field.propTypes = { label: PropTypes.string, children: PropTypes.node };

const inputClass = 'block h-12 w-full rounded-2xl bg-card px-4 text-[16px] text-ink placeholder:text-ink-3 transition-shadow duration-150 focus:outline-none focus:ring-2 focus:ring-ink';

/** Creating a channel: the same questions as today, on one light sheet. */
function CreateChannel({ user, countries, onCreate, onClose }) {
	const { t } = Language.useLanguage();
	const [name, setName] = useState('');
	const [provider, setProvider] = useState('youtube');
	const [isPrivate, setIsPrivate] = useState(true);
	const [password, setPassword] = useState('');
	const [country, setCountry] = useState('international');
	const [appleOffered, setAppleOffered] = useState(false);

	// Apple Music channels exist only where the server has a MusicKit key: its
	// token route answers JSON then.
	useEffect(() => {
		let cancelled = false;
		fetch(DEVELOPER_TOKEN_URL, { method: 'HEAD', cache: 'no-store' })
			.then((response) => {
				const isJson = (response.headers.get('content-type') || '').includes('application/json');
				if (!cancelled) setAppleOffered(response.ok && isJson);
			})
			.catch(() => { /* YouTube only */ });
		return () => { cancelled = true; };
	}, []);

	useEffect(() => {
		const onKey = (event) => { if (event.key === 'Escape') onClose(); };
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	const submit = (event) => {
		event.preventDefault();
		if (!name.trim()) return;
		onCreate({
			name,
			description: `Hosted by ${user.name}`,
			color: 'from-gray-700 to-black',
			isPrivate,
			password: isPrivate ? password : null,
			languageFlag: isPrivate ? 'international' : country,
			provider: appleOffered ? provider : 'youtube',
		});
	};

	return (
		<div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 animate-in fade-in duration-200 sm:items-center sm:p-6" onClick={onClose}>
			<form
				onSubmit={submit}
				onClick={(event) => event.stopPropagation()}
				className="w-full max-w-md rounded-t-[28px] bg-page p-6 animate-in slide-in-from-bottom-6 duration-300 sm:rounded-[28px] sm:zoom-in-95"
				style={{ paddingBottom: 'calc(1.5rem + var(--sab))' }}
			>
				<div className="mb-5 flex items-center justify-between gap-4">
					<h2 className="b-display text-[40px] text-ink">{t('lobby.createNewChannel')}</h2>
					<button type="button" onClick={onClose} aria-label={t('header.close')} className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-card text-ink transition-[background-color,transform] duration-150 ease-cv hover:bg-raised active:scale-90">
						<X size={20} />
					</button>
				</div>

				<div className="space-y-4">
					<Field label={t('lobby.channelName')}>
						<input
							autoFocus
							type="text"
							value={name}
							maxLength={100}
							onChange={(event) => setName(event.target.value.slice(0, 100))}
							placeholder={t('lobby.channelNamePlaceholder')}
							className={inputClass}
						/>
					</Field>

					{appleOffered && (
						<div>
							<p id="b-create-source" className="mb-1.5 text-[14px] font-semibold text-ink">{t('appleMusic.source')}</p>
							<SegmentedControl
								labelledBy="b-create-source"
								value={provider}
								onChange={setProvider}
								options={[{ value: 'youtube', label: 'YouTube' }, { value: 'apple', label: 'Apple Music' }]}
							/>
							{provider === 'apple' && <p className="mt-2 text-[14px] text-ink-2">{t('appleMusic.sourceHint')}</p>}
						</div>
					)}

					<div>
						<p id="b-create-privacy" className="mb-1.5 text-[14px] font-semibold text-ink">{t('lobby.privacy')}</p>
						<SegmentedControl
							labelledBy="b-create-privacy"
							value={isPrivate ? 'private' : 'public'}
							onChange={(choice) => setIsPrivate(choice === 'private')}
							options={[{ value: 'public', label: t('lobby.public') }, { value: 'private', label: t('lobby.private') }]}
						/>
					</div>

					{isPrivate ? (
						<Field label={t('lobby.passwordOptional')}>
							<input type="text" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('lobby.passwordPlaceholder')} className={inputClass} />
						</Field>
					) : (
						<Field label={t('lobby.videoLanguage')}>
							<select value={country} onChange={(event) => setCountry(event.target.value)} className={inputClass}>
								<option value="international">International</option>
								{countries.map((entry) => <option key={entry.code} value={entry.code}>{entry.emoji} {entry.label}</option>)}
							</select>
						</Field>
					)}
				</div>

				<div className="mt-6 flex justify-end gap-2">
					<BButton kind="ghost" onClick={onClose}>{t('lobby.cancel')}</BButton>
					<BButton kind="accent" type="submit" disabled={!name.trim()}>{t('lobby.createChannel')}</BButton>
				</div>
			</form>
		</div>
	);
}

CreateChannel.propTypes = {
	user: PropTypes.object,
	countries: PropTypes.array.isRequired,
	onCreate: PropTypes.func.isRequired,
	onClose: PropTypes.func.isRequired,
};

/** A channel in the list: what it is called, who is there, where it plays from. */
function ChannelRow({ channel, showPicture, onOpen, countryLabel }) {
	const { t } = Language.useLanguage();
	const listeners = channel.listeners || 0;
	const picture = showPicture && channel.currentTrack?.thumbnail;
	return (
		<button
			type="button"
			onClick={() => onOpen(channel)}
			className="group flex w-full items-center gap-3 rounded-2xl bg-card p-2.5 text-left transition-[background-color,transform] duration-150 ease-cv hover:bg-raised active:scale-[0.985]"
		>
			<span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-xl bg-raised">
				{picture
					? <img src={picture} alt="" loading="lazy" className="h-full w-full object-cover" />
					: <span className="b-display text-[30px] text-ink-3" aria-hidden="true">{channel.name.trim().charAt(0).toUpperCase()}</span>}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[17px] font-semibold leading-6 text-ink">{channel.name}</span>
				<span className="mt-0.5 flex items-center gap-2 text-[13px] leading-5 text-ink-2">
					<span className={`flex items-center gap-1 tabular-nums ${listeners > 0 ? 'font-semibold text-ink' : ''}`}>
						<Users size={14} aria-hidden="true" /> {listeners} {t('lobby.live')}
					</span>
					{channel.provider === 'apple' && <span className="font-semibold b-accent-text">Apple Music</span>}
					{channel.language_flag && channel.language_flag !== 'international' && (
						<span title={countryLabel}>{getFlagEmoji(channel.language_flag)}</span>
					)}
					{channel.is_protected && <Lock size={13} aria-hidden="true" />}
				</span>
			</span>
			<ChevronRight size={20} className="flex-none text-ink-3 transition-transform duration-150 ease-cv group-hover:translate-x-0.5" aria-hidden="true" />
		</button>
	);
}

ChannelRow.propTypes = {
	channel: PropTypes.object.isRequired,
	showPicture: PropTypes.bool,
	onOpen: PropTypes.func.isRequired,
	countryLabel: PropTypes.string,
};

export default function LobbyB({ roomHref, startCreating = false }) {
	useLightPage();
	const navigate = useNavigate();
	const { t, language } = Language.useLanguage();
	const c = useCopy();
	const { hasConsent } = Consent.useConsent();
	const { sendMessage, lastMessage, isConnected, user, handleLoginSuccess, handleLogout, clearMessage } = useWebSocketContext();
	const countries = useCountries(language);

	const [listType, setListType] = useState('public');
	const [channels, setChannels] = useState(null); // null: on its way
	const [search, setSearch] = useState('');
	const [country, setCountry] = useState('international');
	const [creating, setCreating] = useState(startCreating);
	const [accountOpen, setAccountOpen] = useState(false);
	const [languageOpen, setLanguageOpen] = useState(false);
	const listRef = useRef(null);

	useEffect(() => {
		if (isConnected) sendMessage({ type: 'LIST_ROOMS', payload: { type: listType } });
	}, [isConnected, sendMessage, listType]);

	useEffect(() => {
		if (!lastMessage) return;
		if (lastMessage.type === 'ROOM_LIST') {
			setChannels(lastMessage.payload);
		} else if (lastMessage.type === 'ROOM_CREATED') {
			navigate(`/room/${lastMessage.payload.id}`, { state: { showShareOnLoad: !lastMessage.payload.is_public } });
			clearMessage();
		}
	}, [lastMessage, navigate, clearMessage]);

	// Channels with people first, the fullest at the top, then by name.
	const shown = useMemo(() => {
		const needle = search.trim().toLowerCase();
		return (channels || [])
			.filter((channel) => !needle || channel.name.toLowerCase().includes(needle))
			.filter((channel) => country === 'international' || channel.language_flag === country)
			.sort((a, b) => (Number(b.isActive) - Number(a.isActive))
				|| ((b.listeners || 0) - (a.listeners || 0))
				|| a.name.localeCompare(b.name));
	}, [channels, search, country]);

	// The fullest channel that has a picture leads the list, with what plays there.
	const lead = hasConsent && !search && shown[0]?.listeners > 0 && shown[0].currentTrack?.thumbnail ? shown[0] : null;
	const rest = lead ? shown.slice(1) : shown;

	const open = (channel) => {
		if (roomHref) window.location.assign(roomHref(channel));
		else navigate(`/room/${channel.id}`);
	};
	const create = (payload) => {
		sendMessage({ type: 'CREATE_ROOM', payload });
		setCreating(false);
		setListType('my_channels');
	};
	const countryLabel = (code) => countries.find((entry) => entry.code === code)?.label;

	// "Create a channel" for someone who is not signed in opens the sign-in.
	const createButton = (kind, size, className = '') => (isSignedIn(user) ? (
		<BButton kind={kind} size={size} className={className} onClick={() => setCreating(true)}>
			<Plus size={size === 'lg' ? 22 : 18} strokeWidth={2.5} /> {t('lobby.createChannel')}
		</BButton>
	) : (
		<GoogleAuthButton
			onLoginSuccess={handleLoginSuccess}
			render={(performLogin) => (
				<BButton kind={kind} size={size} className={className} onClick={() => performLogin()} title={t('lobby.loginToCreate')}>
					<Plus size={size === 'lg' ? 22 : 18} strokeWidth={2.5} /> {t('lobby.createChannel')}
				</BButton>
			)}
		/>
	));

	const listTabs = [
		['public', t('lobby.public')],
		['private', t('lobby.private')],
		...(isSignedIn(user) ? [['my_channels', t('lobby.myChannels')]] : []),
	];

	return (
		<div className="b-root min-h-screen">
			<div className="mx-auto w-full max-w-[1200px] px-4 pb-10 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-8">
				<header className="relative z-40 flex h-14 items-center justify-between gap-3">
					<Wordmark className="text-[36px] sm:text-[40px]" />
					<div className="flex items-center gap-1 sm:gap-2">
						<LanguageSwitcher isOpen={languageOpen} onToggle={setLanguageOpen} compact />
						{isSignedIn(user) ? (
							<div className="relative">
								<button
									type="button"
									onClick={() => setAccountOpen((value) => !value)}
									aria-expanded={accountOpen}
									className="flex h-10 items-center gap-2 rounded-full bg-card pl-1 pr-1 transition-[background-color,transform] duration-150 ease-cv hover:bg-raised active:scale-[0.97] sm:pr-3.5"
								>
									{user.picture
										? <img src={user.picture} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full" />
										: <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[14px] font-semibold text-page">{displayName(user, t).charAt(0)}</span>}
									<span className="text-[15px] font-semibold text-ink max-sm:hidden">{displayName(user, t)}</span>
								</button>
								{accountOpen && (
									<div className="absolute right-0 top-full z-50 mt-2 w-60 origin-top-right rounded-2xl bg-page p-2 shadow-[0_12px_40px_rgba(20,20,24,0.16)] ring-1 ring-ink/10 animate-in fade-in zoom-in-95 duration-150">
										<p className="truncate px-3 pb-2 pt-1 text-[13px] text-ink-2">{user.email}</p>
										<button
											type="button"
											onClick={() => { handleLogout(); setAccountOpen(false); }}
											className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[15px] font-semibold text-ink transition-colors duration-150 hover:bg-card"
										>
											<LogOut size={18} /> {t('lobby.signOut')}
										</button>
									</div>
								)}
							</div>
						) : (
							<GoogleAuthButton
								onLoginSuccess={handleLoginSuccess}
								render={(performLogin) => (
									<BButton kind="quiet" size="sm" onClick={() => performLogin()} className="!h-10">
										<GoogleGIcon className="h-4 w-4" /> {t('lobby.signInGoogle')}
									</BButton>
								)}
							/>
						)}
					</div>
				</header>

				<section className="grid items-center gap-8 pb-10 pt-6 sm:pt-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12 lg:pb-14">
					<div className="b-rise">
						<h1 className="b-display text-[clamp(3.25rem,9.2vw,7rem)] text-ink">{c('heroTitle')}</h1>
						<p className="mt-5 max-w-[34rem] text-[18px] leading-7 text-ink sm:text-[20px] sm:leading-8">{c('heroText')}</p>
						<div className="mt-7 flex flex-wrap items-center gap-3">
							{createButton('accent', 'lg', 'max-sm:w-full')}
							<BButton kind="quiet" size="lg" className="max-sm:w-full" onClick={() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
								{c('heroSecondary')}
							</BButton>
						</div>
						<p className="mt-5 text-[15px] leading-6 text-ink-2">{c('heroNote')}</p>
					</div>
					<div className="b-rise" style={{ animationDelay: '90ms' }}>
						<ExampleChart />
					</div>
				</section>

				<ol className="grid gap-x-10 gap-y-6 border-y border-ink/10 py-8 sm:grid-cols-3">
					{[1, 2, 3].map((step) => (
						<li key={step} className="flex gap-4">
							<span className="b-display w-9 flex-none text-[56px] leading-[0.8] text-ink-3" aria-hidden="true">{step}</span>
							<div>
								<h2 className="b-display text-[30px] text-ink">{c(`step${step}Title`)}</h2>
								<p className="mt-1.5 text-[16px] leading-6 text-ink">{c(`step${step}Text`)}</p>
							</div>
						</li>
					))}
				</ol>

				<section ref={listRef} className="scroll-mt-6 pt-10">
					<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
						<div className="flex items-baseline gap-5" role="tablist">
							{listTabs.map(([key, label]) => (
								<button
									key={key}
									type="button"
									role="tab"
									aria-selected={listType === key}
									onClick={() => { setListType(key); setChannels(null); }}
									className={`b-display relative pb-1.5 text-[32px] transition-colors duration-150 sm:text-[40px] ${listType === key ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}
								>
									{label}
									<span className={`absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-accent transition-opacity duration-150 ${listType === key ? 'opacity-100' : 'opacity-0'}`} />
								</button>
							))}
						</div>
						<div className="flex w-full items-center gap-2 sm:w-auto">
							<label className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
								<Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
								<input
									type="search"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder={t('lobby.searchPlaceholder')}
									aria-label={t('lobby.searchPlaceholder')}
									className="block h-11 w-full rounded-full bg-card pl-11 pr-4 text-[16px] text-ink placeholder:text-ink-3 transition-shadow duration-150 focus:outline-none focus:ring-2 focus:ring-ink"
								/>
							</label>
							<span className="relative flex-none">
								<select
									value={country}
									onChange={(event) => setCountry(event.target.value)}
									aria-label={t('lobby.videoLanguage')}
									className="h-11 w-[8.75rem] appearance-none truncate rounded-full bg-card pl-4 pr-9 text-[15px] font-medium text-ink transition-shadow duration-150 focus:outline-none focus:ring-2 focus:ring-ink sm:w-[10.5rem]"
								>
									<option value="international">{c('allCountries')}</option>
									{countries.map((entry) => <option key={entry.code} value={entry.code}>{entry.emoji} {entry.label}</option>)}
								</select>
								<ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-2" aria-hidden="true" />
							</span>
							{createButton('dark', 'md', 'max-sm:hidden')}
						</div>
					</div>

					<div className="mt-6">
						{channels === null ? (
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label={t('lobby.connecting')}>
								{[0, 1, 2, 3, 4, 5].map((index) => <div key={index} className="h-[76px] animate-pulse rounded-2xl bg-card" />)}
							</div>
						) : shown.length === 0 ? (
							<p className="py-10 text-[18px] text-ink">
								{search ? `${t('lobby.noChannelsFound')} "${search}"` : c('channelsEmpty')}
							</p>
						) : (
							<>
								{lead && (
									<button
										type="button"
										onClick={() => open(lead)}
										className="group mb-3 grid w-full overflow-hidden rounded-[28px] bg-card text-left transition-[background-color,transform] duration-150 ease-cv hover:bg-raised active:scale-[0.99] sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
									>
										<span className="relative block aspect-video overflow-hidden sm:aspect-auto sm:min-h-[220px]">
											<img src={lead.currentTrack.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" />
										</span>
										<span className="flex flex-col justify-center p-5 sm:p-8">
											<span className="b-display block text-[44px] text-ink sm:text-[56px]">{lead.name}</span>
											{lead.currentTrack.title && (
												<span className="mt-3 block">
													<span className="block text-[14px] font-semibold b-accent-text">{c('nowIn')}</span>
													<span className="block truncate text-[18px] font-semibold leading-6 text-ink">{lead.currentTrack.title}</span>
													{lead.currentTrack.artist && <span className="block truncate text-[15px] leading-6 text-ink-2">{lead.currentTrack.artist}</span>}
												</span>
											)}
											<span className="mt-4 flex items-center gap-4 text-[15px] text-ink">
												<span className="flex items-center gap-1.5 font-semibold tabular-nums"><Users size={16} aria-hidden="true" /> {lead.listeners} {t('lobby.live')}</span>
												{lead.language_flag && lead.language_flag !== 'international' && <span title={countryLabel(lead.language_flag)}>{getFlagEmoji(lead.language_flag)}</span>}
												<span className="ml-auto flex h-11 items-center gap-1 rounded-full bg-ink px-5 text-[15px] font-semibold text-page">
													{c('join')} <ChevronRight size={18} className="transition-transform duration-150 ease-cv group-hover:translate-x-0.5" aria-hidden="true" />
												</span>
											</span>
										</span>
									</button>
								)}
								<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
									{rest.map((channel) => (
										<ChannelRow key={channel.id} channel={channel} showPicture={hasConsent} onOpen={open} countryLabel={countryLabel(channel.language_flag)} />
									))}
								</div>
							</>
						)}
					</div>
					<div className="mt-6 sm:hidden">{createButton('dark', 'md', 'w-full')}</div>
				</section>

				<footer className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-ink/10 pt-6 text-[14px]">
					<YouTubeBrandSubtitle className="!text-[14px] !text-ink-2 hover:!text-ink" />
					<Link to="/legal" className="font-semibold text-ink underline decoration-ink/30 underline-offset-4 transition-colors duration-150 hover:decoration-ink">
						{t('lobby.terms')}
					</Link>
				</footer>
			</div>

			{creating && <CreateChannel user={user} countries={countries} onCreate={create} onClose={() => setCreating(false)} />}
		</div>
	);
}

LobbyB.propTypes = {
	// The preview's way into a room: there is no server behind it.
	roomHref: PropTypes.func,
	// The preview's ?create: the dialog is open from the start.
	startCreating: PropTypes.bool,
};
