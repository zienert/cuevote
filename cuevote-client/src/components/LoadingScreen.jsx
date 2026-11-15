// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState, useEffect } from "react";
import { CloudOff, RotateCw, WifiOff } from "lucide-react";
import { Language } from "../contexts/LanguageContext";
import { StatusButton, StatusCard } from "./PlayerStatus";
import { LobbySkeleton, RoomSkeleton } from "./Skeletons";

// A connection that has not come after this long, and after several attempts,
// is a problem to tell about. Until then the app is simply connecting.
const PROBLEM_AFTER_MS = 12000;
// "Retry" stays busy this long: long enough to see that it was pressed.
const RETRY_BUSY_MS = 1500;

/**
 * What the app shows while it has no connection: the whole screen when a
 * channel opens, or (`embedded`) the lobby's place for its channels.
 *
 * Connecting passes on its own: placeholders in the shape of what is coming,
 * with a light passing over them. A connection that does not come, or a
 * device that is offline, gets the card with the way to try again.
 */
export function LoadingScreen({ isOnline, embedded = false, message, reconnectAttempt = 0, onForceReconnect }) {
	const { t } = Language.useLanguage();
	const [waitedLong, setWaitedLong] = useState(false);
	const [isRetrying, setIsRetrying] = useState(false);

	useEffect(() => {
		const timer = setTimeout(() => setWaitedLong(true), PROBLEM_AFTER_MS);
		return () => clearTimeout(timer);
	}, []);

	useEffect(() => {
		if (!isRetrying || !onForceReconnect) return undefined;
		const timer = setTimeout(() => setIsRetrying(false), RETRY_BUSY_MS);
		return () => clearTimeout(timer);
	}, [isRetrying, onForceReconnect]);

	const handleRetry = () => {
		setIsRetrying(true);
		if (onForceReconnect) {
			onForceReconnect();
			return;
		}
		setTimeout(() => {
			window.location.reload();
		}, 500);
	};

	let state = 'connecting';
	if (!isOnline) state = 'offline';
	else if (waitedLong && reconnectAttempt > 3) state = 'problem';

	const connecting = message || t('app.connecting', "Connecting to server...");
	const card = state === 'connecting' ? null : (
		<div className="flex w-full justify-center animate-in fade-in zoom-in-95 duration-300">
			<StatusCard
				icon={state === 'offline' ? WifiOff : CloudOff}
				tone="attention"
				title={state === 'offline' ? t('app.noInternet', "No Internet Connection") : t('app.connectionIssue', "Connection Issue")}
				text={state === 'offline' ? t('app.checkConnection', "Please check your internet connection.") : t('app.takingTooLong', "Taking longer than usual...")}
			>
				<StatusButton icon={RotateCw} busy={isRetrying} onClick={handleRetry}>
					{t('app.retry', "Retry Connection")}
				</StatusButton>
			</StatusCard>
		</div>
	);

	if (embedded) {
		if (!card) return <LobbySkeleton label={connecting} />;
		return (
			<div role="status" className="flex min-h-[19rem] items-center justify-center py-6">
				{card}
			</div>
		);
	}

	if (!card) return <RoomSkeleton label={connecting} />;
	return (
		<div role="status" className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#050505] p-6 text-white">
			{card}
		</div>
	);
}
