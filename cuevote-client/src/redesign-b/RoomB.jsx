// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// Design proposal B ("Neu"), DEV previews only (/__room-preview?design=b).
//
// A room is its ranking. On a phone the list is the page: what plays now,
// then the places, and the field for a wish under the thumb. On a computer or
// TV the video stands next to the ranking, with the code that lets the next
// guest in always on screen.
//
// The draft speaks the room's real messages (VOTE, SUGGEST_SONG, DELETE_SONG,
// PLAY_PAUSE, SEEK_TO, FETCH_SUGGESTIONS), so the preview's mock room answers
// it. Not built: the video player itself (a still stands in, as in the app's
// own preview), prelisten, volume, settings, requests, cinema mode.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { Slider } from '@base-ui/react/slider';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowUp, Check, ChevronLeft, Copy, Loader2, Pause, Play, Plus, QrCode, Trash2 } from 'lucide-react';
import '@fontsource-variable/sofia-sans-extra-condensed/index.css';
import './b.css';
import { useWebSocketContext } from '../hooks/useWebSocketContext';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Language } from '../contexts/LanguageContext';
import { Consent } from '../contexts/ConsentContext';
import { YouTubeBrandSubtitle } from '../components/YouTubeBrandSubtitle';
import { Skeleton } from '../components/Skeleton';
import { canParticipate, displayName, isSignedIn, participationErrorKey, suggesterLabel } from '../utils/participation';
import { isAppleKey } from '../utils/trackKeys';
import { clock, useLightPage, useProgress } from './lib';
import { useCopy } from './copy';
import { Chart } from './Chart';
import { Account, Button, Cover, IconButton, Segmented, Sheet, Toasts } from './ui';

const NO_ROOM = {};
const NONE = [];

// The link the server resolves without a search, as the room's library uses.
function linkFor(track) {
	if (isAppleKey(track.videoId)) {
		const [, kind, id] = String(track.videoId).split(':');
		return `https://music.apple.com/us/${kind === 'musicVideo' ? 'music-video' : 'song'}/${id}`;
	}
	return `https://www.youtube.com/watch?v=${track.videoId}`;
}

/** What plays now: on a phone the first thing of the page. */
function NowPlaying({ track, cover, seconds, playing, isOwner, onPlayPause }) {
	const { t } = Language.useLanguage();
	const c = useCopy();
	if (!track) {
		return (
			<section className="rounded-[1.5rem] bg-card px-5 py-4">
				<p className="font-semibold text-ink">{c('room.nothing')}</p>
			</section>
		);
	}
	const share = track.duration ? Math.min(1, seconds / track.duration) : 0;
	return (
		<section className="relative overflow-hidden rounded-[1.5rem] bg-card p-3" aria-label={t('playlist.nowPlaying')}>
			{/* The cover's colours behind the title: mood, no detail. */}
			{cover.src && cover.allowed ? (
				<>
					<img src={cover.src} alt="" aria-hidden="true" className="b-wash pointer-events-none absolute inset-0 h-full w-full object-cover" />
					{/* A veil of the page's colour: the card stays light under any cover. */}
					<span aria-hidden="true" className="absolute inset-0 bg-page/60" />
				</>
			) : null}
			<div className="relative flex items-center gap-3">
				<Cover src={cover.src} allowed={cover.allowed} size="h-[4.5rem] w-[4.5rem]" radius="rounded-2xl" />
				<div className="min-w-0 flex-1">
					<p className="text-[0.8125rem] font-semibold leading-4 text-ink-2">{t('playlist.nowPlaying')}</p>
					{track.title
						? <p dir="auto" className="b-display cv-bidi mt-1 truncate text-[1.75rem] text-ink">{track.title}</p>
						: <Skeleton className="mt-2 h-5 w-40 max-w-full bg-raised" />}
					{track.artist ? <p dir="auto" className="cv-bidi truncate text-[0.9375rem] leading-5 text-ink-2">{track.artist}</p> : null}
				</div>
				{isOwner ? (
					<IconButton label={playing ? t('playlist.pause') : t('playlist.play')} onClick={onPlayPause} className="bg-ink text-page hover:bg-ink">
						{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="translate-x-px" />}
					</IconButton>
				) : null}
			</div>
			<div className="relative mt-3 flex items-center gap-2 text-[0.75rem] font-medium tabular-nums text-ink-2">
				<span>{clock(seconds)}</span>
				<span className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10" role="presentation">
					<span className="block h-full origin-left bg-ink transition-transform duration-1000 ease-linear" style={{ transform: `scaleX(${share})` }} />
				</span>
				<span>{clock(track.duration)}</span>
			</div>
		</section>
	);
}

NowPlaying.propTypes = {
	track: PropTypes.object,
	cover: PropTypes.object.isRequired,
	seconds: PropTypes.number.isRequired,
	playing: PropTypes.bool,
	isOwner: PropTypes.bool,
	onPlayPause: PropTypes.func,
};

/** The field for a wish: a title or a link, sent with the round button. */
function SuggestField({ value, onChange, onSubmit, busy, disabled, problem }) {
	const { t } = Language.useLanguage();
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (value.trim() && !busy && !disabled) onSubmit(value.trim());
			}}
		>
			{problem ? <p role="alert" className="px-2 pb-2 text-[0.9375rem] leading-5 text-[#b42318]">{problem}</p> : null}
			<div className="flex items-center gap-2">
				<label htmlFor="b-wish" className="sr-only">{t('suggest.placeholder')}</label>
				<input
					id="b-wish"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
					placeholder={disabled ? t('suggest.disabledPlaceholder') : t('suggest.placeholder')}
					enterKeyHint="send"
					autoComplete="off"
					autoCapitalize="sentences"
					className="h-12 min-w-0 flex-1 rounded-full bg-card px-5 text-[1.0625rem] text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-60"
				/>
				<button
					type="submit"
					aria-label={t('suggest.submit')}
					disabled={!value.trim() || busy || disabled}
					className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-accent text-accent-ink transition-[transform,opacity] duration-150 ease-cv active:scale-95 disabled:opacity-40 disabled:active:scale-100"
				>
					{busy ? <Loader2 size={22} className="animate-spin" /> : <ArrowUp size={22} strokeWidth={2.5} />}
				</button>
			</div>
		</form>
	);
}

SuggestField.propTypes = {
	value: PropTypes.string.isRequired,
	onChange: PropTypes.func.isRequired,
	onSubmit: PropTypes.func.isRequired,
	busy: PropTypes.bool,
	disabled: PropTypes.bool,
	problem: PropTypes.string,
};

/** The code and the link that let the next guest in. */
function JoinCode({ size, className }) {
	const c = useCopy();
	const url = window.location.href;
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(url);
			toast(c('room.copied'), { icon: <Check size={18} /> });
		} catch {
			toast.error(url);
		}
	};
	return (
		<div className={clsx('flex items-center gap-4', className)}>
			<span className="flex-none rounded-2xl bg-white p-2 shadow-[0_0_0_1px_rgba(21,21,26,0.1)]">
				<QRCodeSVG value={url} size={size} fgColor="#15151a" bgColor="#ffffff" level="M" />
			</span>
			<div className="min-w-0">
				<p className="b-display text-[1.625rem] text-ink">{c('room.join')}</p>
				<p className="mt-1 truncate text-[0.9375rem] text-ink-2">{window.location.host}{window.location.pathname}</p>
				<Button size="sm" className="mt-3" onClick={copy}><Copy size={16} /> {c('room.copy')}</Button>
			</div>
		</div>
	);
}

JoinCode.propTypes = { size: PropTypes.number.isRequired, className: PropTypes.string };

/** What can be done with one title: opened from its row. */
function TrackSheet({ track, rank, cover, isOwner, onDelete, onAdd, similar, onSimilar, onClose }) {
	const { t } = Language.useLanguage();
	const c = useCopy();
	const [confirming, setConfirming] = useState(false);
	const by = suggesterLabel(track, t);
	return (
		<Sheet
			open
			onOpenChange={(open) => { if (!open) onClose(); }}
			title={<span dir="auto" className="cv-bidi block break-words">{track.title || t('playlist.nowPlaying')}</span>}
			description={[track.artist, by ? `${c('room.by')} ${by}` : null, rank ? `${c('room.place')} ${rank}` : null].filter(Boolean).join(', ')}
		>
			<div className="space-y-3">
				{similar.for === track.id ? (
					<div className="rounded-2xl bg-card p-3">
						<p className="px-1 pb-2 text-[0.9375rem] font-semibold text-ink">{t('suggestions.title')}</p>
						{similar.loading ? (
							<p className="flex items-center gap-2 px-1 py-2 text-[0.9375rem] text-ink-2"><Loader2 size={18} className="animate-spin" /> {t('suggestions.loading')}</p>
						) : similar.list.length === 0 ? (
							<p className="px-1 py-2 text-[0.9375rem] text-ink-2">{t('suggestions.empty')}</p>
						) : (
							<ul className="space-y-1">
								{similar.list.map((entry) => (
									<li key={entry.id || entry.videoId} className="flex items-center gap-3">
										<Cover src={cover(entry).src} allowed={cover(entry).allowed} size="h-11 w-11" />
										<span className="min-w-0 flex-1">
											<span dir="auto" className="cv-bidi block truncate font-semibold leading-5 text-ink">{entry.title}</span>
											<span dir="auto" className="cv-bidi block truncate text-[0.9375rem] leading-5 text-ink-2">{entry.artist}</span>
										</span>
										<IconButton label={`${t('track.add')}: ${entry.title}`} onClick={() => onAdd(entry)} className="bg-page"><Plus size={20} /></IconButton>
									</li>
								))}
							</ul>
						)}
					</div>
				) : (
					<Button wide onClick={() => onSimilar(track)}>{t('track.recommend')}</Button>
				)}

				{isAppleKey(track.videoId) ? null : (
					<a
						href={`https://www.youtube.com/watch?v=${track.videoId}`}
						target="_blank"
						rel="noopener noreferrer"
						className="flex h-11 w-full items-center justify-center rounded-full bg-card font-semibold text-ink transition-[background-color,transform] duration-150 ease-cv hover:bg-raised active:scale-[0.97]"
					>
						{t('track.watch')}
					</a>
				)}

				{isOwner ? (
					confirming ? (
						<div className="grid grid-cols-2 gap-2">
							<Button onClick={() => setConfirming(false)}>{t('track.cancel')}</Button>
							<Button kind="danger" onClick={() => { onDelete(track.id); onClose(); }}><Trash2 size={18} /> {t('track.confirmDelete')}</Button>
						</div>
					) : (
						<Button kind="danger" wide onClick={() => setConfirming(true)}><Trash2 size={18} /> {t('track.delete')}</Button>
					)
				) : null}
			</div>
		</Sheet>
	);
}

TrackSheet.propTypes = {
	track: PropTypes.object.isRequired,
	rank: PropTypes.number,
	cover: PropTypes.func.isRequired,
	isOwner: PropTypes.bool,
	onDelete: PropTypes.func.isRequired,
	onAdd: PropTypes.func.isRequired,
	similar: PropTypes.object.isRequired,
	onSimilar: PropTypes.func.isRequired,
	onClose: PropTypes.func.isRequired,
};

/** The titles that have played: each can be suggested again. */
function Library({ history, queue, cover, onAdd, disabled }) {
	const { t } = Language.useLanguage();
	const c = useCopy();
	const titles = useMemo(() => {
		const seen = new Set();
		return [...history].reverse().filter((track) => track.title && !seen.has(track.videoId) && seen.add(track.videoId));
	}, [history]);
	const queued = useMemo(() => new Set(queue.map((track) => track.videoId)), [queue]);
	if (titles.length === 0) return <p className="px-2 py-10 text-center text-ink-2">{t('library.empty')}</p>;
	return (
		<ul className="space-y-1">
			{titles.map((track) => (
				<li key={track.videoId} className="flex items-center gap-3 rounded-2xl py-2 pl-2 pr-1">
					<Cover src={cover(track).src} allowed={cover(track).allowed} />
					<span className="min-w-0 flex-1">
						<span dir="auto" className="cv-bidi block truncate font-semibold leading-6 text-ink">{track.title}</span>
						<span dir="auto" className="cv-bidi block truncate text-[0.9375rem] leading-5 text-ink-2">{track.artist}</span>
					</span>
					{queued.has(track.videoId) ? (
						<span className="flex h-11 w-11 flex-none items-center justify-center text-ink-3" title={t('suggest.added')}><Check size={20} /></span>
					) : (
						<IconButton label={`${c('room.addAgain')}: ${track.title}`} disabled={disabled} onClick={() => onAdd(track)} className="bg-card disabled:opacity-40"><Plus size={20} /></IconButton>
					)}
				</li>
			))}
		</ul>
	);
}

Library.propTypes = { history: PropTypes.array.isRequired, queue: PropTypes.array.isRequired, cover: PropTypes.func.isRequired, onAdd: PropTypes.func.isRequired, disabled: PropTypes.bool };

function Opening() {
	return (
		<div className="b-root flex h-dvh flex-col gap-3 bg-page p-4" role="status" aria-busy="true">
			<Skeleton className="h-9 w-48 bg-card" />
			<Skeleton className="h-28 w-full rounded-[1.5rem] bg-card" />
			{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl bg-card" />)}
		</div>
	);
}

export default function RoomB({ homeHref }) {
	useLightPage();
	const navigate = useNavigate();
	const { t } = Language.useLanguage();
	const c = useCopy();
	const { hasConsent, hasAppleConsent } = Consent.useConsent();
	const { state, sendMessage, user, lastMessage, lastError, handleLoginSuccess, handleLogout, progressRef, progressAtRef } = useWebSocketContext();
	const wide = useMediaQuery('(min-width: 1024px)');

	const room = state || NO_ROOM;
	const queue = room.queue || NONE;
	const history = room.history || NONE;
	const current = room.currentTrack || null;
	const upcoming = useMemo(() => queue.filter((track) => track.id !== current?.id), [queue, current?.id]);
	const playing = !!room.isPlaying && !!current;
	const isOwner = !!(user && room.ownerId && user.id === room.ownerId);
	const isApple = room.provider === 'apple';
	const mayTakePart = canParticipate(user, room.requireLogin);
	const canVote = room.votesEnabled !== false && mayTakePart;
	const canSuggest = mayTakePart && (room.suggestionsEnabled !== false || isOwner);

	const seconds = useProgress(progressRef?.current ?? room.progress ?? 0, progressAtRef?.current ?? 0, playing, current?.duration);

	// Which picture a title has, and whether it may load: the service it comes
	// from needs its own consent, and a title without fresh metadata shows none.
	const coverOf = (track) => {
		if (!track?.title) return { src: null, allowed: false };
		if (isAppleKey(track.videoId)) return { src: track.thumbnail || null, allowed: hasAppleConsent };
		return { src: track.thumbnail || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`, allowed: hasConsent };
	};

	const [view, setView] = useState('next');
	const [wish, setWish] = useState('');
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState('');
	const [openId, setOpenId] = useState(null);
	const [sharing, setSharing] = useState(false);
	const [account, setAccount] = useState(false);
	const [similar, setSimilar] = useState({ for: null, loading: false, list: NONE });
	const [scrub, setScrub] = useState(null);

	const suggest = (query) => {
		setBusy(true);
		setProblem('');
		sendMessage({ type: 'SUGGEST_SONG', payload: { query, userId: user?.id } });
	};

	// The room's answers: to a wish, and to "similar titles".
	const seen = useRef(lastMessage);
	useEffect(() => {
		if (lastMessage === seen.current) return;
		seen.current = lastMessage;
		if (!lastMessage) return;
		if (lastMessage.type === 'SUGGESTION_RESULT') {
			setSimilar((now) => ({ ...now, loading: false, list: lastMessage.payload?.suggestions || NONE }));
		} else if (busy && (lastMessage.type === 'success' || lastMessage.type === 'info')) {
			setBusy(false);
			setWish('');
			toast(lastMessage.type === 'info' && lastMessage.message ? lastMessage.message : t('suggest.added'), { icon: <Check size={18} /> });
		} else if (busy && lastMessage.type === 'error') {
			setBusy(false);
			const key = participationErrorKey(lastMessage.code);
			setProblem(key ? t(key) : (lastMessage.message || lastError || t('suggest.error')));
		}
	}, [lastMessage, lastError, busy, t]);
	// A wish the room never answers does not block the field for good.
	useEffect(() => {
		if (!busy) return undefined;
		const timer = setTimeout(() => setBusy(false), 10000);
		return () => clearTimeout(timer);
	}, [busy]);

	if (!state) return <Opening />;

	const vote = (trackId, voteType) => sendMessage({ type: 'VOTE', payload: { trackId, voteType } });
	const remove = (trackId) => sendMessage({ type: 'DELETE_SONG', payload: { trackId } });
	const playPause = () => sendMessage({ type: 'PLAY_PAUSE', payload: !room.isPlaying });
	const loadSimilar = (track) => {
		setSimilar({ for: track.id, loading: true, list: NONE });
		sendMessage({ type: 'FETCH_SUGGESTIONS', payload: { videoId: track.videoId } });
	};
	const leave = () => (homeHref ? window.location.assign(homeHref) : navigate('/'));

	const openTrack = openId ? queue.find((track) => track.id === openId) : null;
	const openRank = openTrack ? upcoming.findIndex((track) => track.id === openTrack.id) + 1 : 0;

	const source = isApple
		// Apple's guidelines: the name in words, never translated or restyled.
		? <p className="b-accent-text text-[0.75rem] font-semibold leading-4">Apple Music</p>
		: <YouTubeBrandSubtitle className="whitespace-nowrap" />;

	const list = upcoming.length > 0 ? (
		<Chart tracks={upcoming} coverOf={coverOf} canVote={canVote} onVote={vote} onOpen={(track) => setOpenId(track.id)} label={c('room.next')} />
	) : (
		<div className="px-2 py-10 text-center">
			<p className="font-semibold text-ink">{c('room.empty')}</p>
			{canSuggest ? <p className="mt-1 text-ink-2">{c('room.emptyHint')}</p> : null}
		</div>
	);
	// The two views of a room; how many titles wait stands on the first.
	const views = [{ value: 'next', label: c('room.next'), count: upcoming.length }, { value: 'library', label: t('header.library') }];
	const noVoteNote = !canVote && upcoming.length > 0 ? (
		<p className="px-2 pb-3 text-[0.9375rem] text-ink-2">{room.votesEnabled === false ? c('room.votesOff') : c('room.signIn')}</p>
	) : null;
	const field = (
		<SuggestField value={wish} onChange={setWish} onSubmit={suggest} busy={busy} disabled={!canSuggest} problem={problem} />
	);

	const sheets = (
		<>
			{openTrack ? (
				<TrackSheet
					track={openTrack}
					rank={openRank}
					cover={coverOf}
					isOwner={isOwner}
					onDelete={remove}
					onAdd={(entry) => suggest(linkFor(entry))}
					similar={similar}
					onSimilar={loadSimilar}
					onClose={() => setOpenId(null)}
				/>
			) : null}
			<Sheet open={sharing} onOpenChange={setSharing} title={c('room.share')} description={c('room.shareText')}>
				<JoinCode size={132} />
			</Sheet>
			<Sheet open={account} onOpenChange={setAccount} title={c('account.title')} description={isSignedIn(user) ? [displayName(user, t), user.email].filter(Boolean).join(', ') : undefined}>
				<Button wide onClick={() => { handleLogout(); setAccount(false); }}>{t('lobby.signOut')}</Button>
			</Sheet>
		</>
	);

	if (wide) {
		const duration = current?.duration || 0;
		const shown = scrub ?? seconds;
		return (
			<MotionConfig reducedMotion="user">
				<div className="b-root grid h-dvh grid-cols-[minmax(0,1fr)_26rem] bg-page">
					<div className="flex min-w-0 flex-col gap-4 p-6">
						<header className="flex flex-none items-center gap-2">
							<IconButton label={t('header.leave')} onClick={leave}><ChevronLeft size={24} /></IconButton>
							<div className="min-w-0 flex-1">
								<h1 dir="auto" className="b-display cv-bidi truncate text-[2.25rem] text-ink" title={room.activeChannel}>{room.activeChannel}</h1>
								{source}
							</div>
							<Account user={user} onLoginSuccess={handleLoginSuccess} onOpen={() => setAccount(true)} withLabel />
						</header>

						{/* The screen. In the draft a still stands where the video plays. */}
						<div className="b-stage relative min-h-0 flex-1 overflow-hidden rounded-[1.75rem]">
							{current && coverOf(current).src && coverOf(current).allowed ? (
								<img src={coverOf(current).src} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl" />
							) : null}
							<div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
							<p className="absolute right-5 top-4 text-[0.8125rem] text-white/70">{c('room.still')}</p>
							<div className="absolute inset-x-0 bottom-0 p-8">
								{current ? (
									<>
										<p className="text-[0.9375rem] font-semibold text-white/80">{t('playlist.nowPlaying')}</p>
										<p dir="auto" className="b-display cv-bidi mt-2 line-clamp-2 text-[clamp(2.5rem,5vw,4.5rem)] text-white">{current.title}</p>
										{current.artist ? <p dir="auto" className="cv-bidi mt-2 truncate text-[1.25rem] text-white/85">{current.artist}</p> : null}
									</>
								) : (
									<p className="b-display text-[3rem] text-white">{c('room.nothing')}</p>
								)}
							</div>
						</div>

						<div className="flex flex-none items-center gap-4">
							{isOwner ? (
								<IconButton label={playing ? t('playlist.pause') : t('playlist.play')} onClick={playPause} className="h-12 w-12 bg-ink text-page hover:bg-ink">
									{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="translate-x-px" />}
								</IconButton>
							) : null}
							<span className="w-11 flex-none text-right text-[0.9375rem] font-medium tabular-nums text-ink-2">{clock(shown)}</span>
							{isOwner && duration ? (
								<Slider.Root
									className="min-w-0 flex-1"
									value={Math.min(duration, shown)}
									min={0}
									max={duration}
									onValueChange={(value) => setScrub(value)}
									onValueCommitted={(value) => { sendMessage({ type: 'SEEK_TO', payload: value }); setScrub(null); }}
								>
									<Slider.Control className="flex h-11 w-full touch-none select-none items-center">
										<Slider.Track className="h-1.5 w-full rounded-full bg-raised">
											<Slider.Indicator className="rounded-full bg-ink" />
											<Slider.Thumb aria-label={t('playlist.nowPlaying')} className="h-4 w-4 rounded-full bg-ink shadow-[0_0_0_3px_#fff] transition-transform duration-150 ease-cv data-[dragging]:scale-125" />
										</Slider.Track>
									</Slider.Control>
								</Slider.Root>
							) : (
								<span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-raised" role="presentation">
									<span className="block h-full origin-left bg-ink transition-transform duration-1000 ease-linear" style={{ transform: `scaleX(${duration ? Math.min(1, seconds / duration) : 0})` }} />
								</span>
							)}
							<span className="w-11 flex-none text-[0.9375rem] font-medium tabular-nums text-ink-2">{clock(duration)}</span>
						</div>
					</div>

					<aside className="flex min-h-0 flex-col border-l border-line">
						<JoinCode size={112} className="flex-none border-b border-line p-6" />
						<Segmented
							label={room.activeChannel || ''}
							value={view}
							onChange={setView}
							options={views}
							className="flex-none px-4 pt-4"
						/>
						<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-4">
							{view === 'next' ? <>{noVoteNote}{list}</> : <Library history={history} queue={queue} cover={coverOf} onAdd={(track) => suggest(linkFor(track))} disabled={!canSuggest || busy} />}
						</div>
						<div className="flex-none border-t border-line p-4">{field}</div>
					</aside>
				</div>
				{sheets}
				<Toasts lift={24} />
			</MotionConfig>
		);
	}

	return (
		<MotionConfig reducedMotion="user">
			<div className="b-root flex h-dvh flex-col bg-page">
				<header className="flex-none px-2 pb-3 pt-[calc(0.5rem+env(safe-area-inset-top))]">
					<div className="flex items-center gap-1">
						<IconButton label={t('header.leave')} onClick={leave}><ChevronLeft size={24} /></IconButton>
						<div className="min-w-0 flex-1">
							<h1 dir="auto" className="b-display cv-bidi truncate text-[1.75rem] text-ink" title={room.activeChannel}>{room.activeChannel}</h1>
							{source}
						</div>
						<IconButton label={c('room.share')} onClick={() => setSharing(true)}><QrCode size={22} /></IconButton>
						<Account user={user} onLoginSuccess={handleLoginSuccess} onOpen={() => setAccount(true)} />
					</div>
					<Segmented
						label={room.activeChannel || ''}
						value={view}
						onChange={setView}
						options={views}
						className="mt-3 px-2"
					/>
				</header>

				<main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6">
					{view === 'next' ? (
						<>
							<NowPlaying track={current} cover={coverOf(current)} seconds={seconds} playing={playing} isOwner={isOwner} onPlayPause={playPause} />
							<div className="pt-4">{noVoteNote}{list}</div>
						</>
					) : (
						<Library history={history} queue={queue} cover={coverOf} onAdd={(track) => suggest(linkFor(track))} disabled={!canSuggest || busy} />
					)}
				</main>

				{/* Under the thumb: a material over the list, not a strip. */}
				<div className="b-material flex-none border-t border-line px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">{field}</div>
			</div>
			{sheets}
			<Toasts lift={96} />
		</MotionConfig>
	);
}

RoomB.propTypes = {
	// Where "leave" goes in a preview; the lobby's own address otherwise.
	homeHref: PropTypes.string,
};
