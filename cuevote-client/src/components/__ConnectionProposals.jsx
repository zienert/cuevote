// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY design proposals for the connection states, not for merge.
// ?connDesign=b  one card from the start: it connects, then says what is wrong
// ?connDesign=c  the page keeps its shape (placeholders), the state is a bar
import React from "react";
import { CloudOff, WifiOff } from "lucide-react";
import { Spinner } from "./Spinner";
import { StatusBar, StatusBarButton } from "./PlayerStatus";

function Bar({ state, texts, onRetry }) {
	return (
		<StatusBar
			icon={state === 'offline' ? WifiOff : CloudOff}
			busy={state === 'connecting'}
			action={state === 'connecting' ? null : <StatusBarButton onClick={onRetry}>{texts.retry}</StatusBarButton>}
		>
			{state === 'connecting' ? texts.connecting : state === 'offline' ? texts.offline : texts.problem}
		</StatusBar>
	);
}

function LobbyPlaceholders({ alive }) {
	return (
		<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6" aria-hidden="true">
			{[0, 1, 2, 3, 4, 5].map((i) => (
				<div key={i} className={`relative aspect-[4/3] overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 ${alive ? "animate-pulse" : "opacity-50"}`}>
					<div className="absolute inset-x-3 bottom-3 space-y-2">
						<div className="h-3 w-2/3 rounded-full bg-neutral-800" />
						<div className="h-2.5 w-1/3 rounded-full bg-neutral-800" />
					</div>
				</div>
			))}
		</div>
	);
}

function RoomPlaceholders({ alive, children }) {
	return (
		<div role="status" className="fixed inset-0 z-[100] flex flex-col bg-[#050505] text-white">
			<div className="border-b border-neutral-900 px-4 pb-3 pt-4">
				<div className="mx-auto flex max-w-5xl items-center gap-3">
					<span className="bg-gradient-to-r from-orange-500 to-orange-400 bg-clip-text text-xl font-bold tracking-tighter text-transparent">CueVote</span>
					<div className="h-8 w-px bg-neutral-800" />
					<div className="space-y-1.5">
						<div className="h-3 w-28 rounded-full bg-neutral-800" />
						<div className="h-2 w-20 rounded-full bg-neutral-900" />
					</div>
					<div className="ml-auto flex gap-2">
						<div className="h-9 w-9 rounded-full bg-neutral-900" />
						<div className="h-9 w-9 rounded-full bg-neutral-900" />
					</div>
				</div>
				<div className="mx-auto mt-3 h-11 max-w-5xl rounded-xl bg-neutral-900" />
			</div>
			{children}
			<div className="mx-auto w-full max-w-3xl flex-1 space-y-3 overflow-hidden p-4" aria-hidden="true">
				{[0, 1, 2, 3, 4, 5, 6].map((i) => (
					<div key={i} className={`flex h-[76px] items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-3 ${alive ? "animate-pulse" : "opacity-50"}`}>
						<div className="h-12 w-12 rounded-xl bg-neutral-800" />
						<div className="flex-1 space-y-2">
							<div className="h-3 w-1/2 rounded-full bg-neutral-800" />
							<div className="h-2.5 w-1/3 rounded-full bg-neutral-800" />
						</div>
					</div>
				))}
			</div>
			<div className="border-t border-neutral-900 p-2">
				<div className="mx-auto h-11 max-w-5xl rounded-full border border-neutral-800 bg-[#121212]" />
			</div>
		</div>
	);
}

export function ConnectionProposal({ design, state, embedded, texts, card, onRetry }) {
	if (design === 'c') {
		const bar = <Bar state={state} texts={texts} onRetry={onRetry} />;
		if (embedded) {
			return (
				<div role="status">
					<div className="mb-4 overflow-hidden rounded-xl border border-neutral-800 [&>div]:border-b-0">{bar}</div>
					<LobbyPlaceholders alive={state === 'connecting'} />
				</div>
			);
		}
		return <RoomPlaceholders alive={state === 'connecting'}>{bar}</RoomPlaceholders>;
	}

	// b: the card is there from the start and changes what it says.
	const box = state === 'connecting' ? (
		<div className="w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-950/80 p-6 text-center shadow-2xl md:max-w-md md:p-8">
			<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 md:h-14 md:w-14">
				<Spinner className="h-6 w-6" />
			</div>
			<p className="text-base font-semibold leading-snug text-white md:text-lg">{texts.connecting}</p>
		</div>
	) : card;
	if (embedded) {
		return <div role="status" className="flex min-h-[19rem] items-center justify-center py-6">{box}</div>;
	}
	return (
		<div role="status" className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#050505] p-6 text-white">
			{box}
		</div>
	);
}
