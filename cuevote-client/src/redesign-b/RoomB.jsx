// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// Design proposal B ("Neu"), DEV previews only (/__room-preview?design=b).
//
// A room as the party's chart. On a computer the video and the chart stand
// side by side, so what the guests decide is on screen all the time, next to
// the code that lets the next guest join. On a phone the chart is the page:
// what plays now, then the places, and the field for a wish under the thumb.
//
// A draft of the two main views. It speaks the room's real messages (VOTE,
// SUGGEST_SONG, PLAY_PAUSE), so the preview's mock room answers it. Not built:
// the video player itself (a still frame stands in, as in the app's preview),
// prelisten, deleting, similar titles, settings, requests, cinema mode.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, QrCode, Settings, Pause, Play, Volume2, VolumeX, ArrowUp, Check, Copy, Plus, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useWebSocketContext } from '../hooks/useWebSocketContext';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Language } from '../contexts/LanguageContext';
import { GoogleAuthButton } from '../components/GoogleAuthButton';
import { GoogleGIcon } from '../components/GoogleGIcon';
import { YouTubeBrandSubtitle } from '../components/YouTubeBrandSubtitle';
import { canParticipate, displayName, isSignedIn, suggesterLabel } from '../utils/participation';
import { isAppleKey } from '../utils/trackKeys';
import { Wordmark, Cover, ChartRow, Wisher } from './parts';
import { useLightPage, useFlip, useProgress, clock } from './hooks';
import { useCopy } from './copy';

// The link the server resolves without a search, as the room's library uses.
function linkFor(track) {
	if (isAppleKey(track.videoId)) {
		const [, kind, id] = String(track.videoId).split(':');
		return `https://music.apple.com/us/${kind === 'musicVideo' ? 'music-video' : 'song'}/${id}`;
	}
	return `https://www.youtube.com/watch?v=${track.videoId}`;
}

const NO_ROOM = {};
const NONE = [];

function Account({ user, onLoginSuccess }) {
	const { t } = Language.useLanguage();
	if (isSignedIn(user)) {
		return user.picture ? (
			<img src={user.picture} alt={user.name} referrerPolicy="no-referrer" className="h-9 w-9 flex-none rounded-full" />
		) : (
			<span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-ink text-[14px] font-semibold text-page" title={displayName(user, t)}>
				{displayName(user, t).charAt(0)}
			</span>
		);
	}
	return (
		<GoogleAuthButton
			onLoginSuccess={onLoginSuccess}
			render={(performLogin, disabled) => (
				<button
					type="button"
					onClick={() => performLogin()}
					title={disabled ? t('header.acceptCookies') : t('header.signIn')}
					aria-label={t('header.signIn')}
					className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-card transition-[background-color,transform] duration-150 ease-cv hover:bg-raised active:scale-90"
				>
					<GoogleGIcon className="h-4 w-4" />
				</button>
			)}
		/>
	);
}

Account.propTypes = { user: PropTypes.object, onLoginSuccess: PropTypes.func };

/** The field for a wish. `docked`: the bar at the bottom of a phone. */
function SuggestField({ onSuggest, answer, busy, disabled, docked = false }) {
	const { t } = Language.useLanguage();
	const c = useCopy();
	const [value, setValue] = useState('');
	const sentRef = useRef(false);

	// The room's answer to the last wish clears the field.
	useEffect(() => {
		if (answer?.ok && sentRef.current) {
			sentRef.current = false;
			setValue('');
		}
	}, [answer]);

	const submit = (event) => {
		event.preventDefault();
		const query = value.trim();
		if (!query || busy || disabled) return;
		sentRef.current = true;
		onSuggest(query);
	};

	return (
		<form onSubmit={submit} className="w-full">
			<div className="flex items-center gap-2">
				<input
					type="text"
					value={value}
					onChange={(event) => setValue(event.target.value)}
					disabled={disabled}
					enterKeyHint="send"
					aria-label={c('suggestTitle')}
					placeholder={disabled ? t('suggest.disabledPlaceholder') : t('suggest.placeholder')}
					className={`min-w-0 flex-1 rounded-full bg-card px-5 text-[16px] text-ink placeholder:text-ink-3 transition-shadow duration-150 focus:outline-none focus:ring-2 focus:ring-ink disabled:opacity-60 ${docked ? 'h-12' : 'h-[52px]'}`}
				/>
				<button
					type="submit"
					disabled={busy || disabled}
					aria-label={t('suggest.submit')}
					className={`flex flex-none items-center justify-center rounded-full bg-accent text-accent-ink transition-[background-color,transform,opacity] duration-150 ease-cv hover:bg-[#ff6f1f] active:scale-90 disabled:opacity-50 ${docked ? 'h-12 w-12' : 'h-[52px] w-[52px]'}`}
				>
					{busy
						? <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" aria-hidden="true" />
						: answer?.ok ? <Check size={22} strokeWidth={2.5} /> : <ArrowUp size={22} strokeWidth={2.5} />}
				</button>
			</div>
			{answer && (
				<p role="status" className={`px-5 pt-1.5 text-[14px] font-medium ${answer.ok ? 'text-ink' : 'text-red-700'}`}>
					{answer.text}
				</p>
			)}
		</form>
	);
}

SuggestField.propTypes = {
	onSuggest: PropTypes.func.isRequired,
	answer: PropTypes.object,
	busy: PropTypes.bool,
	disabled: PropTypes.bool,
	docked: PropTypes.bool,
};

/** The way in for the next guest: the code, dark on white, and the link. */
function JoinCode({ compact = false }) {
	const c = useCopy();
	const [copied, setCopied] = useState(false);
	const url = window.location.href;
	const shown = `${window.location.host}${window.location.pathname}`;
	const copy = () => {
		navigator.clipboard?.writeText(url)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			})
			.catch(() => { /* the clipboard is not available */ });
	};
	return (
		<div className={`b-stage flex items-center gap-4 rounded-2xl ${compact ? 'p-3' : 'p-4'}`}>
			<div className="flex-none rounded-xl bg-white p-2">
				<QRCodeSVG value={url} size={compact ? 84 : 132} level="M" fgColor="#111015" bgColor="#ffffff" />
			</div>
			<div className="min-w-0 flex-1">
				<p className={`b-display text-white ${compact ? 'text-[28px]' : 'text-[40px]'}`}>{c('joinTitle')}</p>
				<p className="mt-1 text-[14px] leading-5 text-white/85">{c('joinText')}</p>
				<button
					type="button"
					onClick={copy}
					title={shown}
					className="mt-3 inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-white/10 px-3 text-[13px] font-medium text-white transition-[background-color,transform] duration-150 ease-cv hover:bg-white/20 active:scale-[0.97]"
				>
					{copied ? <Check size={14} /> : <Copy size={14} />}
					<span className="truncate">{copied ? c('copied') : c('copyLink')}</span>
				</button>
			</div>
		</div>
	);
}

JoinCode.propTypes = { compact: PropTypes.bool };

export default function RoomB() {
	useLightPage();
	const navigate = useNavigate();
	const { t } = Language.useLanguage();
	const c = useCopy();
	const { state, sendMessage, user, lastMessage, lastError, handleLoginSuccess, progressRef, progressAtRef } = useWebSocketContext();
	const isPhone = useMediaQuery('(max-width: 767px)');

	const room = state || NO_ROOM;
	const queue = room.queue || NONE;
	const current = room.currentTrack || null;
	const upcoming = useMemo(() => queue.filter((track) => track.id !== current?.id), [queue, current]);
	const history = room.history || NONE;
	const isOwner = !!(user && room.ownerId && user.id === room.ownerId);
	const isApple = room.provider === 'apple';
	const mayTakePart = canParticipate(user, room.requireLogin);
	const labels = { up: c('voteUp'), down: c('voteDown') };

	const [view, setView] = useState('chart'); // 'chart' | 'library'
	const [showCode, setShowCode] = useState(false);
	const [muted, setMuted] = useState(true);
	const [volume, setVolume] = useState(80);
	const [paused, setPaused] = useState(false); // a guest's own pause
	const playing = !!room.isPlaying && !paused;
	const seconds = useProgress(progressRef?.current ?? room.progress ?? 0, progressAtRef?.current ?? 0, playing, current?.duration);
	const percent = current?.duration ? Math.min(100, (seconds / current.duration) * 100) : 0;

	// A wish and the room's answer to it.
	const [busy, setBusy] = useState(false);
	const [answer, setAnswer] = useState(null);
	const seen = useRef(lastMessage);
	useEffect(() => {
		if (lastMessage === seen.current) return undefined;
		seen.current = lastMessage;
		if (!busy || !lastMessage) return undefined;
		if (lastMessage.type === 'success' || lastMessage.type === 'info') {
			setBusy(false);
			setAnswer({ ok: true, text: lastMessage.type === 'info' ? lastMessage.message : t('suggest.added') });
		} else if (lastMessage.type === 'error') {
			setBusy(false);
			setAnswer({ ok: false, text: lastMessage.message || lastError || '' });
		}
		const timer = setTimeout(() => setAnswer(null), 2500);
		return () => clearTimeout(timer);
	}, [lastMessage, lastError, busy, t]);

	const suggest = (query) => {
		if (!mayTakePart) return;
		setAnswer(null);
		setBusy(true);
		sendMessage({ type: 'SUGGEST_SONG', payload: { query, userId: user?.id } });
	};
	const vote = (trackId, voteType) => {
		if (!mayTakePart) return;
		sendMessage({ type: 'VOTE', payload: { trackId, voteType } });
	};
	const playPause = () => {
		if (isOwner) sendMessage({ type: 'PLAY_PAUSE', payload: !room.isPlaying });
		else setPaused((value) => !value);
	};

	const chartRef = useRef(null);
	useFlip(chartRef, upcoming.map((track) => track.id).join(' '));

	// The library: every title that has played, the newest first, once each.
	const library = useMemo(() => {
		const byKey = new Map();
		for (const track of history) if (track.videoId) byKey.set(track.videoId, track);
		return [...byKey.values()].reverse();
	}, [history]);
	const queued = useMemo(() => new Set(queue.map((track) => track.videoId)), [queue]);

	const source = isApple
		? <span className="text-[12px] font-semibold leading-4 b-accent-text">Apple Music</span>
		: <YouTubeBrandSubtitle className="!text-[12px] !text-ink-3 hover:!text-ink whitespace-nowrap" />;

	const tabs = (
		<div className="flex items-baseline gap-5" role="tablist">
			{[
				['chart', t('playlist.upNext'), upcoming.length],
				['library', t('header.library'), null],
			].map(([key, label, count]) => (
				<button
					key={key}
					type="button"
					role="tab"
					aria-selected={view === key}
					onClick={() => setView(key)}
					className={`b-display relative pb-1.5 text-[30px] transition-colors duration-150 md:text-[34px] ${view === key ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}
				>
					{label}
					{count !== null && <span className="ml-2 text-ink-3 tabular-nums">{count}</span>}
					<span className={`absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-accent transition-opacity duration-150 ${view === key ? 'opacity-100' : 'opacity-0'}`} />
				</button>
			))}
		</div>
	);

	const chart = view === 'chart' ? (
		<>
			{upcoming.length > 0 ? (
				<ol ref={chartRef} className="relative">
					{upcoming.map((track, index) => (
						<ChartRow
							key={track.id}
							place={index + 1}
							track={track}
							vote={track.myVote}
							onVote={vote}
							labels={labels}
							suggester={suggesterLabel(track, t)}
							votable={room.votesEnabled !== false && mayTakePart}
						/>
					))}
				</ol>
			) : (
				<p className="py-8 text-[16px] text-ink">{c('emptyQueue')}</p>
			)}
			{history.length > 0 && (
				<section className="mt-8">
					<h3 className="text-[14px] font-semibold text-ink-2">{c('played')}</h3>
					<ul className="mt-1">
						{[...history].reverse().slice(0, 50).map((track, index) => (
							<li key={`${track.id}-${index}`} className="flex items-center gap-3 border-b border-ink/10 py-2">
								<Cover track={track} className="h-9 w-9 rounded-lg" />
								<p className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink-2">
									<span className="mr-2 font-semibold text-ink">{track.title}</span>{track.artist}
								</p>
							</li>
						))}
					</ul>
				</section>
			)}
		</>
	) : (
		<ul>
			{library.map((track) => (
				<li key={track.videoId} className="flex items-center gap-3 border-b border-ink/10 py-2.5">
					<Cover track={track} className="h-12 w-12 rounded-[10px]" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-[16px] font-semibold leading-5 text-ink">{track.title}</p>
						<p className="mt-0.5 truncate text-[13px] leading-5 text-ink-2">{track.artist}</p>
					</div>
					<button
						type="button"
						disabled={queued.has(track.videoId) || !mayTakePart}
						onClick={() => suggest(linkFor(track))}
						title={c('addAgain')}
						aria-label={c('addAgain')}
						className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-card text-ink transition-[background-color,transform,opacity] duration-150 ease-cv hover:bg-raised active:scale-90 disabled:opacity-40"
					>
						{queued.has(track.videoId) ? <Check size={18} /> : <Plus size={18} />}
					</button>
				</li>
			))}
			{library.length === 0 && <p className="py-8 text-[16px] text-ink">{c('emptyQueue')}</p>}
		</ul>
	);

	const playButton = (size) => (
		<button
			type="button"
			onClick={playPause}
			disabled={!current}
			className={`flex flex-none items-center justify-center rounded-full bg-accent text-accent-ink transition-[background-color,transform,opacity] duration-150 ease-cv hover:bg-[#ff6f1f] active:scale-90 disabled:opacity-50 ${size}`}
		>
			{playing
				? <Pause size={22} fill="currentColor" strokeWidth={0} />
				: <Play size={22} fill="currentColor" strokeWidth={0} className="translate-x-px" />}
		</button>
	);

	const leave = () => navigate('/__lobby-preview?design=b');

	if (isPhone) {
		return (
			<div className="b-root flex h-screen flex-col overflow-hidden supports-[height:100dvh]:h-[100dvh]">
				<header className="flex flex-none items-center gap-1.5 px-2 pb-3 pt-[calc(0.75rem+var(--sat))]">
					<button type="button" onClick={leave} aria-label={t('header.leave')} className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-150 ease-cv hover:bg-card active:scale-90">
						<ChevronLeft size={24} />
					</button>
					<div className="min-w-0 flex-1">
						<div className="flex items-baseline gap-2">
							<Wordmark className="flex-none text-[22px]" />
							<h1 className="b-display min-w-0 truncate text-[26px] text-ink">{room.activeChannel}</h1>
						</div>
						<div className="mt-0.5 flex">{source}</div>
					</div>
					<button type="button" onClick={() => setShowCode(true)} aria-label={t('header.share')} className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-150 ease-cv hover:bg-card active:scale-90">
						<QrCode size={22} />
					</button>
					<Account user={user} onLoginSuccess={handleLoginSuccess} />
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
					{current && (
						<section className="b-stage relative overflow-hidden rounded-2xl">
							<div className="flex items-center gap-3 p-3">
								<Cover track={current} className="h-14 w-14 rounded-xl !bg-white/10 !text-white/60" />
								<div className="min-w-0 flex-1">
									<p className="text-[12px] font-semibold leading-4 text-accent">{t('playlist.nowPlaying')}</p>
									<p className="truncate text-[17px] font-semibold leading-6 text-white">{current.title}</p>
									<p className="truncate text-[13px] leading-5 text-white/80">{current.artist}</p>
								</div>
								{isOwner
									? playButton('h-11 w-11')
									: <span className="flex-none text-[13px] font-medium tabular-nums text-white/80">{clock(seconds)}</span>}
							</div>
							<div className="h-1 bg-white/15">
								<div className="h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${percent}%` }} />
							</div>
						</section>
					)}

					<div className="mt-6">{tabs}</div>
					<div className="mt-1">{chart}</div>
				</div>

				<div className="flex-none border-t border-ink/10 bg-page px-3 pt-2" style={{ paddingBottom: 'calc(0.5rem + var(--sab))' }}>
					<SuggestField onSuggest={suggest} answer={answer} busy={busy} disabled={room.suggestionsEnabled === false && !isOwner} docked />
				</div>

				{showCode && (
					<div className="fixed inset-0 z-50 flex items-end bg-ink/50 animate-in fade-in duration-200" onClick={() => setShowCode(false)}>
						<div className="w-full rounded-t-3xl bg-page p-4 animate-in slide-in-from-bottom-8 duration-300" style={{ paddingBottom: 'calc(1rem + var(--sab))' }} onClick={(event) => event.stopPropagation()}>
							<div className="mb-3 flex items-center justify-between">
								<h2 className="b-display text-[30px] text-ink">{t('header.share')}</h2>
								<button type="button" onClick={() => setShowCode(false)} aria-label={t('header.close')} className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-90">
									<X size={20} />
								</button>
							</div>
							<JoinCode />
						</div>
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="b-root flex h-screen flex-col overflow-hidden supports-[height:100dvh]:h-[100dvh]">
			<header className="flex h-16 flex-none items-center gap-3 px-6">
				<button type="button" onClick={leave} title={t('header.leave')} aria-label={t('header.leave')} className="-ml-2 flex h-10 w-10 flex-none items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-150 ease-cv hover:bg-card active:scale-90">
					<ChevronLeft size={24} />
				</button>
				<Wordmark className="text-[30px]" />
				<span className="h-6 w-px bg-ink/15" />
				<h1 className="b-display min-w-0 truncate text-[30px] text-ink">{room.activeChannel}</h1>
				<div className="ml-auto flex items-center gap-3">
					{source}
					{isOwner && (
						<button type="button" title={t('header.settings')} aria-label={t('header.settings')} className="flex h-10 w-10 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-150 ease-cv hover:bg-card active:scale-90">
							<Settings size={20} />
						</button>
					)}
					<Account user={user} onLoginSuccess={handleLoginSuccess} />
				</div>
			</header>

			<div className="mx-auto grid min-h-0 w-full max-w-[1480px] flex-1 grid-cols-[minmax(0,1fr)_400px] gap-8 px-6 pb-6">
				<section className="flex min-h-0 min-w-0 flex-col">
					{/* The screen: the one dark surface of the room. */}
					<div className="b-video-still relative min-h-0 w-full flex-1 overflow-hidden rounded-2xl">
						{isApple && current && <Cover track={current} className="absolute inset-0 h-full w-full !bg-transparent" />}
					</div>

					<div className="flex-none pt-5">
						<div className="flex items-end gap-6">
							<div className="min-w-0 flex-1">
								<p className="text-[14px] font-semibold b-accent-text">{current ? t('playlist.nowPlaying') : t('playlist.queueEmpty')}</p>
								<h2 className="b-display mt-1 truncate text-[52px] text-ink">{current ? current.title : t('playlist.addVideos')}</h2>
								{current && (
									<p className="mt-1 flex min-w-0 items-center gap-2.5 text-[16px] leading-6 text-ink-2">
										<span className="truncate">{current.artist}</span>
										{suggesterLabel(current, t) ? <Wisher name={suggesterLabel(current, t)} className="text-[14px]" /> : null}
									</p>
								)}
							</div>
							<div className="flex flex-none items-center gap-2 pb-1">
								<button type="button" onClick={() => setMuted((value) => !value)} className="flex h-10 w-10 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-150 ease-cv hover:bg-card active:scale-90">
									{muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
								</button>
								<input
									type="range"
									min="0"
									max="100"
									value={volume}
									onChange={(event) => { setVolume(Number(event.target.value)); setMuted(false); }}
									className={`w-24 accent-[rgb(var(--cv-ink))] ${muted ? 'opacity-40' : ''}`}
								/>
								{playButton('ml-2 h-14 w-14')}
							</div>
						</div>
						<div className="mt-4 flex items-center gap-3 text-[13px] font-medium tabular-nums text-ink-2">
							<span className="w-9">{clock(seconds)}</span>
							<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
								<div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${percent}%` }} />
							</div>
							<span className="w-9 text-right">{clock(current?.duration)}</span>
						</div>
					</div>
				</section>

				<aside className="flex min-h-0 flex-col">
					<div className="flex-none">
						<SuggestField onSuggest={suggest} answer={answer} busy={busy} disabled={room.suggestionsEnabled === false && !isOwner} />
					</div>
					<div className="mt-5 flex-none">{tabs}</div>
					<div className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">{chart}</div>
					<div className="flex-none pt-4">
						<JoinCode compact />
					</div>
				</aside>
			</div>
		</div>
	);
}
