// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState, useEffect } from "react";
import { WifiOff, RefreshCw, Loader2, ServerCrash } from "lucide-react";
import { Language } from "../contexts/LanguageContext";
import { StatusButton, StatusCard } from "./PlayerStatus";

export function LoadingScreen({ isOnline, embedded = false, message, reconnectAttempt = 0, onForceReconnect }) {
	const { t } = Language.useLanguage();
	const [showTimeoutCheck, setShowTimeoutCheck] = useState(false);
	const [isRetrying, setIsRetrying] = useState(false);

	useEffect(() => {
		const timer = setTimeout(() => {
			setShowTimeoutCheck(true);
		}, 12000);

		return () => clearTimeout(timer);
	}, []);

	const handleRetry = () => {
		if (onForceReconnect) {
			onForceReconnect();
			return;
		}
		setIsRetrying(true);
		setTimeout(() => {
			window.location.reload();
		}, 500);
	};

	let state = 'loading';
	if (!isOnline) state = 'offline';
	else if (showTimeoutCheck && reconnectAttempt > 3) state = 'error';
	else state = 'loading';

	const getConfig = () => {
		switch (state) {
			case 'offline':
				return {
					icon: <WifiOff size={48} className="text-neutral-500 mb-6" />,
					title: t('app.noInternet', "No Internet Connection"),
					sub: t('app.checkConnection', "Please check your internet connection."),
					action: true
				};
			case 'error':
				return {
					icon: <ServerCrash size={48} className="text-orange-500 mb-6" />,
					title: t('app.connectionIssue', "Connection Issue"),
					sub: reconnectAttempt > 1
						? `${t('app.reconnecting', "Reconnecting")}... (${reconnectAttempt})`
						: t('app.takingTooLong', "Taking longer than usual..."),
					action: true
				};
		case 'loading':
		default:
			return {
				icon: <Loader2 size={48} className="text-orange-500 animate-spin mb-6" />,
				title: message || (reconnectAttempt > 0
					? t('app.reconnecting', "Reconnecting") + "..."
					: t('app.connecting', "Connecting to server...")),
				sub: reconnectAttempt > 1
					? `${t('app.attempt', "Attempt")} ${reconnectAttempt}`
					: null,
				action: reconnectAttempt > 3
			};
		}
	};

	const config = getConfig();

	const content = (
		<div className={`flex flex-col items-center justify-center text-center animate-in fade-in zoom-in-95 duration-500 ${embedded ? "" : "max-w-md p-8"}`}>
			<div className={`transition-all duration-500 ${isRetrying ? "opacity-50 scale-90" : "opacity-100 scale-100"}`}>
				{config.icon}
			</div>

			<h2 className="text-2xl md:text-3xl font-bold text-white mb-2 tracking-tight">
				{config.title}
			</h2>

			{config.sub && (
				<p className="text-neutral-400 font-medium mb-8">
					{config.sub}
				</p>
			)}

			{config.action && (
				<button
					onClick={handleRetry}
					disabled={isRetrying}
					className="flex items-center gap-2 px-8 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold text-lg shadow-lg hover:shadow-orange-500/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<RefreshCw size={20} className={isRetrying ? "animate-spin" : ""} />
					{isRetrying ? t('app.retrying', "Retrying...") : t('app.retry', "Retry Connection")}
				</button>
			)}
		</div>
	);

	// In the lobby, where the channel list will be. Connecting usually takes a
	// moment: one quiet line over placeholders for the channels. Only a
	// connection that does not come gets a card, with the way to try again.
	if (embedded) {
		if (state === 'loading') {
			return (
				<div role="status">
					<p className="mb-4 flex items-center gap-2 text-sm text-neutral-500">
						<Loader2 size={16} className="shrink-0 animate-spin text-orange-500" aria-hidden="true" />
						<span>{config.title}</span>
					</p>
					<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6" aria-hidden="true">
						{[0, 1, 2, 3, 4, 5].map((i) => (
							<div key={i} className="aspect-[4/3] rounded-2xl border border-neutral-900 bg-neutral-900/50 animate-pulse" />
						))}
					</div>
				</div>
			);
		}
		return (
			<div role="status" className="flex justify-center py-6">
				<StatusCard icon={state === 'offline' ? WifiOff : ServerCrash} tone="attention" title={config.title} text={config.sub}>
					<StatusButton variant="secondary" icon={RefreshCw} busy={isRetrying} onClick={handleRetry}>
						{t('app.retry', "Retry Connection")}
					</StatusButton>
				</StatusCard>
			</div>
		);
	}

	// Full Screen Mode
	return (
		<div className="fixed inset-0 z-[100] bg-[#050505] text-white flex items-center justify-center p-6 overflow-hidden">
			{/* Background Gradient */}
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-orange-900/20 via-[#050505] to-[#050505] pointer-events-none" />

			{/* Content */}
			<div className="relative z-10 w-full flex items-center justify-center">
				{content}
			</div>
		</div>
	);
}

