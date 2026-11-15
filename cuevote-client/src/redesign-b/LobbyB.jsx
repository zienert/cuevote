// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// Design proposal B ("Neu"), DEV previews only (/__lobby-preview?design=b).
//
// The start page says in one line what CueVote is, and next to the line the
// thing itself stands: a screen and a ranking to vote in, the same ranking a
// room has. Then how an evening goes, then the channels that are open.
//
// It speaks the lobby's real messages (LIST_ROOMS, CREATE_ROOM, JOIN_ROOM).
// Not built: the account's deletion, and the arrow-key focus of the TV app.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion as Motion, useReducedMotion } from 'motion/react';
import { ChevronDown, Lock, Plus, Search } from 'lucide-react';
import '@fontsource-variable/sofia-sans-extra-condensed/index.css';
import './b.css';
import { useWebSocketContext } from '../hooks/useWebSocketContext';
import { Language } from '../contexts/LanguageContext';
import { Consent } from '../contexts/ConsentContext';
import { LanguageSwitcherExports } from '../components/LanguageSwitcher';
import { GoogleAuthButton } from '../components/GoogleAuthButton';
import { YouTubeBrandSubtitle } from '../components/YouTubeBrandSubtitle';
import { Skeleton } from '../components/Skeleton';
import { channelLanguages, getFlagEmoji, hasFlag } from '../constants/channelLanguages';
import { displayName, isSignedIn } from '../utils/participation';
import { formatCount } from '../utils/numbers';
import { DEVELOPER_TOKEN_URL } from '../utils/musicKit';
import { EXAMPLE_PLAYING, SPRING, useExampleRoom, useLightPage } from './lib';
import { useCopy } from './copy';
import { Chart } from './Chart';
import { Account, Button, Cover, Segmented, Sheet, Toasts, Wordmark } from './ui';

const { LanguageSwitcher } = LanguageSwitcherExports;

// How many channels the list shows before "show more".
const PAGE = 12;

const field = 'h-12 w-full rounded-2xl bg-card px-4 text-[1.0625rem] text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink';

/**
 * The thing itself, small: a screen and the ranking next to it. A vote in the
 * ranking changes what the screen says comes next. One vote arrives by itself
 * shortly after the page loads, once, to show what a vote does.
 */
function Example() {
	const { t } = Language.useLanguage();
	const c = useCopy();
	const reduce = useReducedMotion();
	const room = useExampleRoom(4);
	const nudge = useRef(room.nudge);
	nudge.current = room.nudge;
	useEffect(() => {
		if (reduce) return undefined;
		const timer = setTimeout(() => nudge.current('t2'), 1600);
		return () => clearTimeout(timer);
	}, [reduce]);
	const next = room.tracks[0];

	return (
		<div>
			<div className="relative">
				{/* The screen: dark, as the only surface of the page. */}
				<div className="b-stage relative aspect-[16/10] overflow-hidden rounded-[1.75rem] lg:aspect-[16/9]" aria-hidden="true">
					<img src={EXAMPLE_PLAYING.thumbnail} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl" />
					<div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
					<p className="absolute left-5 top-4 text-[0.8125rem] font-medium text-white/75 sm:left-7 sm:top-6">{c('hero.screen')}</p>
					<div className="absolute inset-x-0 bottom-0 p-5 pb-20 sm:p-7 sm:pb-7 sm:pr-[22rem]">
						<p className="text-[0.8125rem] font-semibold text-white/80">{t('playlist.nowPlaying')}</p>
						<p className="b-display mt-1 text-[2.5rem] text-white sm:text-[3.5rem]">{EXAMPLE_PLAYING.title}</p>
						<p className="mt-2 flex items-baseline gap-2 text-[0.9375rem] text-white/85">
							<span className="flex-none">{c('room.next')}:</span>
							<AnimatePresence mode="popLayout" initial={false}>
								<Motion.span
									key={next.id}
									initial={{ opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0 }}
									transition={SPRING}
									className="truncate font-semibold text-white"
								>
									{next.title}
								</Motion.span>
							</AnimatePresence>
						</p>
					</div>
				</div>

				{/* The ranking, as a room has it: it works. */}
				<div className="relative z-10 -mt-14 ml-auto w-[calc(100%-1.5rem)] rounded-[1.5rem] bg-page p-2 shadow-[0_16px_48px_-12px_rgba(21,21,26,0.28),0_0_0_1px_rgba(21,21,26,0.06)] sm:absolute sm:-bottom-10 sm:-right-4 sm:mt-0 sm:w-[23rem] lg:-right-8">
					<Chart
						tracks={room.tracks}
						coverOf={(track) => ({ src: track.thumbnail, allowed: true })}
						onVote={room.vote}
						label={c('room.next')}
					/>
				</div>
			</div>
			<p className="mt-4 text-[0.9375rem] text-ink-2 sm:mt-16">{c('hero.try')}</p>
		</div>
	);
}

/** The form for a new channel. */
function CreateChannel({ user, onCreate }) {
	const { t, language } = Language.useLanguage();
	const c = useCopy();
	const [name, setName] = useState('');
	const [provider, setProvider] = useState('youtube');
	const [visibility, setVisibility] = useState('private');
	const [password, setPassword] = useState('');
	const [country, setCountry] = useState('international');
	const [appleOffered, setAppleOffered] = useState(false);

	// Apple Music is offered when the server has it: its token route answers JSON.
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

	const countries = useCountries(language);
	const isPrivate = visibility === 'private';

	const submit = (event) => {
		event.preventDefault();
		if (!name.trim()) return;
		onCreate({
			name: name.trim(),
			description: `Hosted by ${user.name}`,
			color: 'from-gray-700 to-black',
			isPrivate,
			password: isPrivate ? password : null,
			languageFlag: country,
			provider: appleOffered ? provider : 'youtube',
		});
	};

	return (
		<form onSubmit={submit} className="space-y-5">
			<div>
				<label htmlFor="b-channel-name" className="mb-2 block text-[0.9375rem] font-semibold text-ink">{t('lobby.channelName')}</label>
				<input
					id="b-channel-name"
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder={t('lobby.channelNamePlaceholder')}
					maxLength={100}
					required
					autoComplete="off"
					enterKeyHint="done"
					className={field}
				/>
			</div>

			{appleOffered ? (
				<div>
					<p className="mb-2 text-[0.9375rem] font-semibold text-ink">{t('appleMusic.source')}</p>
					<Segmented
						label={t('appleMusic.source')}
						value={provider}
						onChange={setProvider}
						// Brand names: the same in every language.
						options={[{ value: 'youtube', label: 'YouTube' }, { value: 'apple', label: 'Apple Music' }]}
					/>
					{provider === 'apple' ? <p className="mt-2 text-[0.9375rem] text-ink-2">{t('appleMusic.sourceHint')}</p> : null}
				</div>
			) : null}

			<div>
				<p className="mb-2 text-[0.9375rem] font-semibold text-ink">{t('lobby.privacy')}</p>
				<Segmented
					label={t('lobby.privacy')}
					value={visibility}
					onChange={setVisibility}
					options={[{ value: 'private', label: t('lobby.private') }, { value: 'public', label: t('lobby.public') }]}
				/>
				<p className="mt-2 text-[0.9375rem] text-ink-2">{isPrivate ? c('create.private.text') : c('create.public.text')}</p>
			</div>

			{isPrivate ? (
				<div>
					<label htmlFor="b-channel-password" className="mb-2 block text-[0.9375rem] font-semibold text-ink">{t('lobby.passwordOptional')}</label>
					<input
						id="b-channel-password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						placeholder={t('lobby.passwordPlaceholder')}
						autoComplete="off"
						autoCapitalize="none"
						autoCorrect="off"
						className={field}
					/>
				</div>
			) : null}

			<div>
				<label htmlFor="b-channel-country" className="mb-2 block text-[0.9375rem] font-semibold text-ink">{t('lobby.videoLanguage')}</label>
				<CountrySelect id="b-channel-country" value={country} onChange={setCountry} countries={countries} />
			</div>

			<Button type="submit" kind="primary" size="lg" wide disabled={!name.trim()}>{t('lobby.createChannel')}</Button>
		</form>
	);
}

CreateChannel.propTypes = { user: PropTypes.object.isRequired, onCreate: PropTypes.func.isRequired };

// The countries a channel can carry, named in the reader's language.
function useCountries(language) {
	const c = useCopy();
	return useMemo(() => {
		let names = null;
		try {
			names = new Intl.DisplayNames([language === 'sr' ? 'sr-Latn' : language], { type: 'region' });
		} catch { /* codes then */ }
		const all = channelLanguages
			.filter((entry) => entry.code !== 'international')
			.map((entry) => ({ code: entry.code, label: names?.of(entry.code) || entry.code }))
			.sort((a, b) => a.label.localeCompare(b.label, language));
		return [{ code: 'international', label: c('list.allCountries') }, ...all];
	}, [language, c]);
}

/** A long list on a phone belongs to the system's own picker. */
function CountrySelect({ id, value, onChange, countries, label, className = '' }) {
	return (
		<span className={`relative block ${className}`}>
			<select
				id={id}
				aria-label={label}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className={`${field} appearance-none pr-10`}
			>
				{countries.map((entry) => (
					<option key={entry.code} value={entry.code}>
						{entry.code === 'international' ? entry.label : `${getFlagEmoji(entry.code)} ${entry.label}`}
					</option>
				))}
			</select>
			<ChevronDown size={18} aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ink-2" />
		</span>
	);
}

CountrySelect.propTypes = {
	id: PropTypes.string,
	value: PropTypes.string.isRequired,
	onChange: PropTypes.func.isRequired,
	countries: PropTypes.array.isRequired,
	label: PropTypes.string,
	className: PropTypes.string,
};

/** One channel of the list: its name, what plays there, who is there. */
function ChannelRow({ channel, href, onOpen, allowed, language }) {
	const { t } = Language.useLanguage();
	const c = useCopy();
	const track = channel.currentTrack;
	const isApple = channel.provider === 'apple';
	return (
		<li>
			<a
				href={href}
				onClick={(event) => {
					// A plain click opens it here; a modified one is the browser's.
					if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
					event.preventDefault();
					onOpen(channel);
				}}
				className="flex items-center gap-4 rounded-2xl px-2 py-3 transition-colors duration-150 hover:bg-card active:bg-card"
			>
				<Cover src={track?.thumbnail} allowed={allowed && !isApple} size="h-14 w-14" radius="rounded-2xl" />
				<span className="min-w-0 flex-1">
					{/* The name says which party it is: up to two lines rather than cut short. */}
					<span dir="auto" className="b-display cv-bidi line-clamp-2 break-words pb-0.5 text-[1.625rem] text-ink">{channel.name}</span>
					<span className="block truncate text-[0.9375rem] leading-5 text-ink-2">
						{/* Apple's guidelines: the name in words, the same in every language. */}
						{isApple ? <span className="b-accent-text font-semibold">Apple Music</span>
							: track?.title ? <>{c('list.playing')} <span dir="auto">{[track.title, track.artist].filter(Boolean).join(', ')}</span></>
								: channel.listeners ? null : c('list.quiet')}
					</span>
				</span>
				<span className="flex flex-none flex-col items-end gap-1 text-[0.9375rem] text-ink-2">
					<span className="font-semibold tabular-nums text-ink">{formatCount(channel.listeners, language)} <span className="font-normal text-ink-2">{t('lobby.live')}</span></span>
					<span className="flex h-5 items-center gap-1.5">
						{channel.is_protected ? <Lock size={15} aria-label={c('list.password')} /> : null}
						{hasFlag(channel.language_flag) ? <span aria-hidden="true">{getFlagEmoji(channel.language_flag)}</span> : null}
					</span>
				</span>
			</a>
		</li>
	);
}

ChannelRow.propTypes = {
	channel: PropTypes.object.isRequired,
	href: PropTypes.string.isRequired,
	onOpen: PropTypes.func.isRequired,
	allowed: PropTypes.bool,
	language: PropTypes.string,
};

export default function LobbyB({ roomHref, startCreating = false }) {
	useLightPage();
	const navigate = useNavigate();
	const { t, language } = Language.useLanguage();
	const c = useCopy();
	const { hasConsent } = Consent.useConsent();
	const { state, sendMessage, lastMessage, lastErrorCode, isConnected, user, handleLoginSuccess, handleLogout, clearMessage } = useWebSocketContext();
	const signedIn = isSignedIn(user);

	const [listType, setListType] = useState('public');
	const [channels, setChannels] = useState(null);
	const [search, setSearch] = useState('');
	const [country, setCountry] = useState('international');
	const [shown, setShown] = useState(PAGE);
	const [creating, setCreating] = useState(startCreating);
	const [account, setAccount] = useState(false);
	const [locked, setLocked] = useState(null);
	const [password, setPassword] = useState('');
	const [wrong, setWrong] = useState(false);
	const countries = useCountries(language);

	useEffect(() => {
		if (isConnected) sendMessage({ type: 'LIST_ROOMS', payload: { type: listType } });
	}, [isConnected, sendMessage, listType]);

	useEffect(() => {
		if (!lastMessage) return;
		if (lastMessage.type === 'ROOM_LIST') {
			setChannels(lastMessage.payload);
		} else if (lastMessage.type === 'ROOM_CREATED') {
			// The share sheet opens by itself for a private channel.
			navigate(`/room/${lastMessage.payload.id}`, { state: { showShareOnLoad: !lastMessage.payload.is_public } });
			clearMessage();
		}
	}, [lastMessage, navigate, clearMessage]);

	// A channel with a password: the room is joined from here, then opened.
	useEffect(() => {
		if (locked && state && state.roomId === locked.id) {
			navigate(`/room/${locked.id}`, { state: { alreadyJoined: true, password } });
		}
	}, [state, locked, password, navigate]);
	useEffect(() => {
		if (!locked) return;
		if (lastErrorCode === 'PASSWORD_REQUIRED') setWrong(true);
		if (lastErrorCode === 'ROOM_NOT_FOUND') setLocked(null);
	}, [lastErrorCode, locked]);

	// Channels with people first, the fullest at the top, then by name.
	const list = useMemo(() => {
		const needle = search.trim().toLowerCase();
		return (channels || [])
			.filter((channel) => !needle || String(channel.name).toLowerCase().includes(needle))
			.filter((channel) => country === 'international' || String(channel.language_flag).toUpperCase() === country)
			.sort((a, b) => (Number(b.isActive) - Number(a.isActive))
				|| ((b.listeners || 0) - (a.listeners || 0))
				|| String(a.name).localeCompare(String(b.name)));
	}, [channels, search, country]);

	const hrefOf = (channel) => (roomHref ? roomHref(channel) : `/room/${channel.id}`);
	const open = (channel) => {
		if (roomHref) {
			window.location.assign(roomHref(channel));
		} else if (channel.is_protected) {
			setPassword('');
			setWrong(false);
			setLocked(channel);
		} else {
			navigate(`/room/${channel.id}`);
		}
	};
	const create = (payload) => {
		sendMessage({ type: 'CREATE_ROOM', payload });
		setCreating(false);
		setListType('my_channels');
	};

	// "Create a channel" for someone who is not signed in is the way to sign in.
	const createButton = (kind, size, className) => (signedIn ? (
		<Button kind={kind} size={size} className={className} onClick={() => setCreating(true)}>
			<Plus size={size === 'lg' ? 22 : 18} strokeWidth={2.5} /> {t('lobby.createChannel')}
		</Button>
	) : (
		<GoogleAuthButton
			onLoginSuccess={handleLoginSuccess}
			render={(performLogin) => (
				<Button kind={kind} size={size} className={className} onClick={() => performLogin()}>
					{/* The same words for everyone: the press leads through consent and sign-in. */}
					<Plus size={size === 'lg' ? 22 : 18} strokeWidth={2.5} /> {t('lobby.createChannel')}
				</Button>
			)}
		/>
	));

	const tabs = [
		{ value: 'public', label: t('lobby.public') },
		{ value: 'private', label: t('lobby.private') },
		...(signedIn ? [{ value: 'my_channels', label: t('lobby.myChannels') }] : []),
	];

	return (
		<MotionConfig reducedMotion="user">
			<div className="b-root min-h-dvh bg-page">
				<div className="mx-auto w-full max-w-[72rem] px-4 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] sm:px-8 sm:pt-6">
					<header className="relative z-30 flex items-center gap-2">
						<div className="mr-auto">
							<Wordmark className="block text-[2.25rem]" />
							<YouTubeBrandSubtitle className="whitespace-nowrap" />
						</div>
						<LanguageSwitcher compact={!signedIn} />
						<span className="sm:hidden"><Account user={user} onLoginSuccess={handleLoginSuccess} onOpen={() => setAccount(true)} /></span>
						<span className="max-sm:hidden"><Account user={user} onLoginSuccess={handleLoginSuccess} onOpen={() => setAccount(true)} withLabel /></span>
					</header>

					<section className="pb-10 pt-10 lg:pb-20 lg:pt-14">
						{/* The line as a poster: two lines across the page on a wide screen. */}
						<h1 className="b-display text-[clamp(3.5rem,11vw,8.5rem)] text-ink lg:whitespace-pre-line">{c('hero.title')}</h1>
						<div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:mt-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
							<div>
								<p className="max-w-[34rem] text-[1.1875rem] leading-7 text-ink-2">{c('hero.text')}</p>
								<div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
									{createButton('primary', 'lg')}
									<a href="#kanaele" className="cv-hit font-semibold text-ink underline decoration-ink/30 underline-offset-4 transition-colors duration-150 hover:decoration-ink">{c('hero.channels')}</a>
								</div>
							</div>
							<Example />
						</div>
					</section>

					<section aria-labelledby="b-steps" className="border-t border-line py-10 lg:py-14">
						<h2 id="b-steps" className="b-display text-[2.25rem] text-ink sm:text-[2.75rem]">{c('steps.title')}</h2>
						<ol className="mt-6 grid gap-6 sm:grid-cols-3 sm:gap-8">
							{[1, 2, 3].map((step) => (
								<li key={step} className="flex gap-3">
									<span aria-hidden="true" className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-card text-[0.9375rem] font-semibold tabular-nums text-ink">{step}</span>
									<div>
										<p className="font-semibold text-ink">{c(`steps.${step}`)}</p>
										<p className="mt-1 text-ink-2">{c(`steps.${step}.text`)}</p>
									</div>
								</li>
							))}
						</ol>
					</section>

					<section id="kanaele" aria-labelledby="b-channels" className="scroll-mt-6 border-t border-line pt-10 lg:pt-14">
						<div className="flex flex-wrap items-end justify-between gap-4">
							<h2 id="b-channels" className="b-display text-[2.25rem] text-ink sm:text-[2.75rem]">{c('list.title')}</h2>
							{createButton('quiet', 'md')}
						</div>
						<div className="mt-5 grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_16rem] lg:items-center">
							<Segmented label={c('list.title')} value={listType} onChange={(value) => { setListType(value); setChannels(null); setShown(PAGE); }} options={tabs} />
							<span className="relative block">
								<Search size={18} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
								<input
									type="search"
									value={search}
									onChange={(event) => { setSearch(event.target.value); setShown(PAGE); }}
									placeholder={t('lobby.searchPlaceholder')}
									aria-label={t('lobby.searchPlaceholder')}
									enterKeyHint="search"
									autoComplete="off"
									className={`${field} pl-11`}
								/>
							</span>
							<CountrySelect value={country} onChange={(value) => { setCountry(value); setShown(PAGE); }} countries={countries} label={c('list.country')} />
						</div>

						<div className="mt-4">
							{channels === null ? (
								<div role="status" aria-busy="true" className="space-y-2">
									{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl bg-card" />)}
								</div>
							) : list.length === 0 ? (
								<p className="py-10 text-center text-ink-2">{search.trim() || country !== 'international' ? c('list.noMatch') : c('list.none')}</p>
							) : (
								<>
									<ul className="divide-y divide-[rgb(var(--cv-ink)/0.08)]">
										{list.slice(0, shown).map((channel) => (
											<ChannelRow key={channel.id} channel={channel} href={hrefOf(channel)} onOpen={open} allowed={hasConsent} language={language} />
										))}
									</ul>
									{list.length > shown ? (
										<div className="pt-4 text-center">
											<Button onClick={() => setShown((count) => count + PAGE)}>{c('list.more')}</Button>
										</div>
									) : null}
								</>
							)}
						</div>
					</section>

					<footer className="mt-12 border-t border-line pt-6 text-[0.9375rem] text-ink-2">
						<Link to="/legal" className="cv-hit font-semibold text-ink underline decoration-ink/30 underline-offset-4 transition-colors duration-150 hover:decoration-ink">{t('header.legal')}</Link>
					</footer>
				</div>
			</div>

			<Sheet open={creating} onOpenChange={setCreating} title={t('lobby.createNewChannel')}>
				{signedIn ? <CreateChannel user={user} onCreate={create} /> : null}
			</Sheet>
			<Sheet open={account} onOpenChange={setAccount} title={c('account.title')} description={signedIn ? [displayName(user, t), user.email].filter(Boolean).join(', ') : undefined}>
				<Button wide onClick={() => { handleLogout(); setAccount(false); }}>{t('lobby.signOut')}</Button>
			</Sheet>
			<Sheet open={!!locked} onOpenChange={(open) => { if (!open) setLocked(null); }} title={t('lobby.enterPassword')} description={locked?.name}>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						setWrong(false);
						sendMessage({ type: 'JOIN_ROOM', payload: { roomId: locked.id, password } });
					}}
					className="space-y-3"
				>
					<input
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						placeholder={t('lobby.passwordInputPlaceholder')}
						aria-label={t('lobby.passwordInputPlaceholder')}
						aria-invalid={wrong}
						autoComplete="off"
						autoCapitalize="none"
						autoCorrect="off"
						className={field}
					/>
					{wrong ? <p role="alert" className="text-[0.9375rem] text-[#b42318]">{t('lobby.wrongPassword')}</p> : null}
					<Button type="submit" kind="primary" size="lg" wide disabled={!password}>{t('lobby.unlockJoin')}</Button>
				</form>
			</Sheet>
			<Toasts />
		</MotionConfig>
	);
}

LobbyB.propTypes = {
	// In a preview: where a channel leads, in place of its room.
	roomHref: PropTypes.func,
	// Open the form for a new channel right away.
	startCreating: PropTypes.bool,
};
