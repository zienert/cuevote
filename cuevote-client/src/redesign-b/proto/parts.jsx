// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY prototype (/__prototype): what the three variants of the voting
// list share. The surroundings of the list are the same in each, so that a
// flip through them compares the list and nothing else.
import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { ArrowUp } from 'lucide-react';
import { EXAMPLE_PLAYING } from '../lib';
import { roomShape } from './shapes';

export function Cover({ src, size = 'h-12 w-12' }) {
	return <img src={src} alt="" draggable="false" className={`${size} flex-none rounded-xl object-cover`} />;
}

Cover.propTypes = { src: PropTypes.string, size: PropTypes.string };

export function ListHeading({ count, hint }) {
	return (
		<div className="px-1 pb-2 pt-5">
			<h2 className="flex items-baseline gap-2">
				<span className="b-display text-[1.75rem] text-ink">Gleich dran</span>
				<span className="text-[0.9375rem] tabular-nums text-ink-3">{count}</span>
			</h2>
			{hint ? <p className="mt-1 text-[0.9375rem] leading-5 text-ink-2">{hint}</p> : null}
		</div>
	);
}

ListHeading.propTypes = { count: PropTypes.number.isRequired, hint: PropTypes.string };

/**
 * A phone's room around the list: the channel's name, what plays now, and the
 * field for a wish under the thumb. The field works (it adds a title); the
 * rest is the setting.
 */
export function RoomFrame({ room, children }) {
	const [wish, setWish] = useState('');
	const submit = (event) => {
		event.preventDefault();
		const title = wish.trim();
		if (!title) return;
		room.add(title);
		setWish('');
	};
	return (
		<div className="b-root mx-auto flex h-dvh w-full max-w-[26.875rem] flex-col bg-page sm:border-x sm:border-line">
			<header className="flex-none px-5 pb-3 pt-[calc(4.25rem+env(safe-area-inset-top))]">
				<p className="b-display truncate text-[1.75rem] text-ink">WG-Party Küche</p>
				<div className="mt-3 flex items-center gap-3 rounded-2xl bg-card p-2 pr-4">
					<Cover src={EXAMPLE_PLAYING.cover} size="h-14 w-14" />
					<div className="min-w-0 flex-1">
						<p className="text-[0.8125rem] font-semibold leading-4 b-accent-text">Läuft gerade</p>
						<p className="truncate font-semibold leading-6 text-ink">{EXAMPLE_PLAYING.title}</p>
						<p className="truncate text-[0.9375rem] leading-5 text-ink-2">{EXAMPLE_PLAYING.artist}</p>
					</div>
				</div>
			</header>
			<main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				{children}
			</main>
			<form onSubmit={submit} className="b-material flex flex-none items-center gap-2 border-t border-line px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
				<label htmlFor="proto-wish" className="sr-only">Titel vorschlagen</label>
				<input
					id="proto-wish"
					value={wish}
					onChange={(event) => setWish(event.target.value)}
					placeholder="Titel vorschlagen"
					enterKeyHint="send"
					autoComplete="off"
					className="h-12 min-w-0 flex-1 rounded-full bg-card px-5 text-[1.0625rem] text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
				/>
				<button
					type="submit"
					aria-label="Vorschlagen"
					disabled={!wish.trim()}
					className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-accent text-accent-ink transition-[transform,opacity] duration-150 ease-cv active:scale-95 disabled:opacity-40 disabled:active:scale-100"
				>
					<ArrowUp size={22} strokeWidth={2.5} />
				</button>
			</form>
		</div>
	);
}

RoomFrame.propTypes = { room: roomShape.isRequired, children: PropTypes.node };
