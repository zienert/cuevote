// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useEffect } from "react";
import PropTypes from "prop-types";
import { HelpCircle, ChevronLeft } from "lucide-react";
import { Language } from '../contexts/LanguageContext';

export function SettingsView({
	onClose,
	pendingCount,
	suggestionMode,
	onManageRequests,
	onUpdateSettings,
	suggestionsEnabled,
	autoApproveKnown,
	musicOnly,
	maxDuration,
	maxQueueSize,
	duplicateCooldown,
	smartQueue,
	autoRefill,
	requireLogin,
	playlistViewMode,
	allowPrelisten,
	votesEnabled,
	ownerBypass,
	ownerQueueBypass,
	ownerPopups,
	onDeleteChannel,
	captionsEnabled,
	isConnected = true,
	onFullscreenOverlay,
	// Apple Music channels: music only, venue mode and captions do nothing
	// there (the catalog is music, guests always get the playlist, no captions).
	isAppleRoom = false,
}) {
	const { t } = Language.useLanguage();
	const [deleteChannelText, setDeleteChannelText] = React.useState("");
	const [showDeleteChannelConfirm, setShowDeleteChannelConfirm] = React.useState(false);

	useEffect(() => {
		onFullscreenOverlay?.(showDeleteChannelConfirm);
	}, [showDeleteChannelConfirm, onFullscreenOverlay]);

	return (
		<div className="w-full h-full bg-[#1a1a1a] px-4 md:px-8 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] overflow-y-auto custom-scrollbar">
			<div className="max-w-6xl mx-auto">
				<div className="flex items-center gap-4 mb-8 border-b border-neutral-800 pb-4 justify-between">
					<div className="flex items-center gap-4">
						<button
							onClick={onClose}
							className="p-2 -ml-2 hover:bg-neutral-800 rounded-full text-white transition-colors flex items-center gap-2 group"
						>
							<ChevronLeft size={24} className="group-hover:-translate-x-1 transition-transform" />
							<span className="text-lg font-bold">{t('header.back')}</span>
						</button>
						<div className="h-6 w-px bg-neutral-800" />
						<h2 className="text-xl font-bold text-neutral-400">{t('header.settings')}</h2>
					</div>
				</div>

				<div className={`grid grid-cols-1 lg:grid-cols-3 gap-6 transition-opacity duration-300 ${!isConnected ? "opacity-50 pointer-events-none grayscale" : ""}`}>
					{/* Column 1: Requests & Suggestions */}
					<div className="space-y-4">
						<h4 className="text-xs font-semibold text-neutral-500 uppercase">{t('header.suggestions')}</h4>

						{(pendingCount > 0 || suggestionMode === 'manual') && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									// No onClose() here: the handler in RoomBody opens the
									// requests page and closes this panel itself.
									onManageRequests();
								}}
								className="w-full flex items-center justify-between p-3 rounded-lg bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 transition-colors border border-orange-500/20"
							>
								<span className="text-sm font-medium">{t('header.reviewRequests')}</span>
								<span className="text-xs font-bold bg-orange-500 text-black px-1.5 py-0.5 rounded-full">{pendingCount}</span>
							</button>
						)}

						<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
							<label className="text-sm font-medium text-white">{t('header.allowSuggestions')}</label>
							<button
								onClick={(e) => {
									e.stopPropagation();
									onUpdateSettings({ suggestionsEnabled: !suggestionsEnabled });
								}}
								className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${suggestionsEnabled ? 'bg-orange-500' : 'bg-neutral-600'}`}
							>
								<span
									className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${suggestionsEnabled ? 'translate-x-6' : 'translate-x-1'}`}
								/>
							</button>
						</div>

						{suggestionsEnabled && (
							<>
								<div className="flex items-center justify-between p-3 pl-4 border-l-2 border-neutral-800 bg-neutral-900/30 hover:bg-neutral-800/50 rounded-r-lg transition-colors">
									<label className="text-sm font-medium text-neutral-300">{t('header.manualReview')}</label>
									<button
										onClick={(e) => {
											e.stopPropagation();
											onUpdateSettings({ suggestionMode: suggestionMode === 'manual' ? 'auto' : 'manual' });
										}}
										className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${suggestionMode === 'manual' ? 'bg-orange-500' : 'bg-neutral-600'}`}
									>
										<span
											className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${suggestionMode === 'manual' ? 'translate-x-6' : 'translate-x-1'}`}
										/>
									</button>
								</div>

								<div className="flex items-center justify-between p-3 pl-4 border-l-2 border-neutral-800 bg-neutral-900/30 hover:bg-neutral-800/50 rounded-r-lg transition-colors">
									<div className="flex items-center gap-2">
										<label className="text-sm font-medium text-neutral-300">{t('header.approveKnown')}</label>
										<div className="group relative flex items-center">
											<HelpCircle size={14} className="text-neutral-500 hover:text-neutral-300 cursor-help" />
											<div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 p-3 bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-center pointer-events-none">
												{t('header.approveKnownTooltip')}
											</div>
										</div>
									</div>
									<button
										onClick={(e) => {
											e.stopPropagation();
											onUpdateSettings({ autoApproveKnown: !autoApproveKnown });
										}}
										className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${autoApproveKnown ? 'bg-orange-500' : 'bg-neutral-600'}`}
									>
										<span
											className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoApproveKnown ? 'translate-x-6' : 'translate-x-1'}`}
										/>
									</button>
								</div>
							</>
						)}
					</div>

					{/* Column 2: Queue & Playback */}
					<div className="space-y-4">
						<h4 className="text-xs font-semibold text-neutral-500 uppercase">{t('header.queuePlayback')}</h4>

						{!isAppleRoom && (
						<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
							<label className="text-sm font-medium text-white">{t('header.musicOnly')}</label>
							<button
								onClick={(e) => {
									e.stopPropagation();
									onUpdateSettings({ musicOnly: !musicOnly });
								}}
								className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${musicOnly ? 'bg-orange-500' : 'bg-neutral-600'}`}
							>
								<span
									className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${musicOnly ? 'translate-x-6' : 'translate-x-1'}`}
								/>
							</button>
						</div>
						)}

						<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
							<label className="text-sm font-medium text-white">{t('header.maxLength')}</label>
							<select
								value={maxDuration}
								onChange={(e) => onUpdateSettings({ maxDuration: Number(e.target.value) })}
								onClick={(e) => e.stopPropagation()}
								className="bg-neutral-900 text-white text-sm rounded-lg px-3 py-1.5 border border-neutral-700 focus:outline-none focus:border-orange-500 transition-colors"
							>
								<option value={0}>{t('header.noLimit')}</option>
								<option value={300}>5 {t('header.mins')}</option>
								<option value={600}>10 {t('header.mins')}</option>
								<option value={900}>15 {t('header.mins')}</option>
								<option value={1800}>30 {t('header.mins')}</option>
							</select>
						</div>

						<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
							<label className="text-sm font-medium text-white">{t('header.maxQueueSize')}</label>
							<select
								value={maxQueueSize}
								onChange={(e) => onUpdateSettings({ maxQueueSize: Number(e.target.value) })}
								onClick={(e) => e.stopPropagation()}
								className="bg-neutral-900 text-white text-sm rounded-lg px-3 py-1.5 border border-neutral-700 focus:outline-none focus:border-orange-500 transition-colors"
							>
								<option value={0}>{t('header.noLimit')}</option>
								<option value={10}>10 {t('header.videos')}</option>
								<option value={25}>25 {t('header.videos')}</option>
								<option value={50}>50 {t('header.videos')}</option>
								<option value={100}>100 {t('header.videos')}</option>
								<option value={250}>250 {t('header.videos')}</option>
								<option value={500}>500 {t('header.videos')}</option>
							</select>
						</div>

						<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
							<label className="text-sm font-medium text-white">{t('header.preventRepetition')}</label>
							<select
								value={duplicateCooldown ?? 10}
								onChange={(e) => onUpdateSettings({ duplicateCooldown: Number(e.target.value) })}
								onClick={(e) => e.stopPropagation()}
								className="bg-neutral-900 text-white text-sm rounded-lg px-3 py-1.5 border border-neutral-700 focus:outline-none focus:border-orange-500 transition-colors"
							>
								<option value={0}>{t('header.noLimit')}</option>
								<option value={5}>5 {t('header.videos')}</option>
								<option value={10}>10 {t('header.videos')}</option>
								<option value={20}>20 {t('header.videos')}</option>
								<option value={50}>50 {t('header.videos')}</option>
								<option value={100}>100 {t('header.videos')}</option>
							</select>
						</div>

						<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-white">{t('header.smartQueue')}</label>
								<div className="group relative flex items-center">
									<HelpCircle size={14} className="text-neutral-500 hover:text-neutral-300 cursor-help" />
									<div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 p-3 bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-center pointer-events-none">
										{t('header.smartQueueTooltip')}
									</div>
								</div>
							</div>
							<button
								onClick={(e) => {
									e.stopPropagation();
									onUpdateSettings({ smartQueue: !smartQueue });
								}}
								className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${smartQueue ? 'bg-orange-500' : 'bg-neutral-600'}`}
							>
								<span
									className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${smartQueue ? 'translate-x-6' : 'translate-x-1'}`}
								/>
							</button>
						</div>

						<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-white">{t('header.autoRefill')}</label>
								<div className="group relative flex items-center">
									<HelpCircle size={14} className="text-neutral-500 hover:text-neutral-300 cursor-help" />
									<div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 p-3 bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-center pointer-events-none">
										{t('header.autoRefillTooltip')}
									</div>
								</div>
							</div>
							<button
								onClick={(e) => {
									e.stopPropagation();
									onUpdateSettings({ autoRefill: !autoRefill });
								}}
								className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${autoRefill ? 'bg-orange-500' : 'bg-neutral-600'}`}
							>
								<span
									className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoRefill ? 'translate-x-6' : 'translate-x-1'}`}
								/>
							</button>
						</div>

					</div>

					{/* Column 3: Advanced & Features */}
					<div className="space-y-4">
						<h4 className="text-xs font-semibold text-neutral-500 uppercase">{t('header.features')}</h4>

						<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-white">{t('header.requireLogin')}</label>
								<div className="group relative flex items-center">
									<HelpCircle size={14} className="text-neutral-500 hover:text-neutral-300 cursor-help" />
									<div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 p-3 bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-center pointer-events-none">
										{t('header.requireLoginTooltip')}
									</div>
								</div>
							</div>
							<button
								onClick={(e) => {
									e.stopPropagation();
									onUpdateSettings({ requireLogin: !requireLogin });
								}}
								className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${requireLogin ? 'bg-orange-500' : 'bg-neutral-600'}`}
							>
								<span
									className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${requireLogin ? 'translate-x-6' : 'translate-x-1'}`}
								/>
							</button>
						</div>

						{!isAppleRoom && (
						<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-white">{t('header.venueMode')}</label>
								<div className="group relative flex items-center">
									<HelpCircle size={14} className="text-neutral-500 hover:text-neutral-300 cursor-help" />
									<div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 p-3 bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-center pointer-events-none">
										{t('header.venueModeTooltip')}
									</div>
								</div>
							</div>
							<button
								onClick={(e) => {
									e.stopPropagation();
									onUpdateSettings({ playlistViewMode: !playlistViewMode });
								}}
								className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${playlistViewMode ? 'bg-orange-500' : 'bg-neutral-600'}`}
							>
								<span
									className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${playlistViewMode ? 'translate-x-6' : 'translate-x-1'}`}
								/>
							</button>
						</div>
						)}

						<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
							<label className="text-sm font-medium text-white">{t('header.allowPrelisten')}</label>
							<button
								onClick={(e) => {
									e.stopPropagation();
									onUpdateSettings({ allowPrelisten: !allowPrelisten });
								}}
								className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${allowPrelisten ? 'bg-orange-500' : 'bg-neutral-600'}`}
							>
								<span
									className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${allowPrelisten ? 'translate-x-6' : 'translate-x-1'}`}
								/>
							</button>
						</div>

						{!isAppleRoom && (
						<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-white">{t('lobby.startWithCaptions')}</label>
								<div className="group relative flex items-center">
									<HelpCircle size={14} className="text-neutral-500 hover:text-neutral-300 cursor-help" />
									<div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 p-3 bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-center pointer-events-none">
										{t('header.captionsTooltip')}
									</div>
								</div>
							</div>
							<button
								onClick={(e) => {
									e.stopPropagation();
									onUpdateSettings({ captionsEnabled: !captionsEnabled });
								}}
								className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${captionsEnabled ? 'bg-orange-500' : 'bg-neutral-600'} z-50`}
								style={{ pointerEvents: 'auto' }}
							>
								<span
									className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${captionsEnabled ? 'translate-x-6' : 'translate-x-1'}`}
								/>
							</button>
						</div>
						)}

						<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
							<label className="text-sm font-medium text-white">{t('header.allowVoting')}</label>
							<button
								onClick={(e) => {
									e.stopPropagation();
									onUpdateSettings({ votesEnabled: !votesEnabled });
								}}
								className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${votesEnabled ? 'bg-orange-500' : 'bg-neutral-600'}`}
							>
								<span
									className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${votesEnabled ? 'translate-x-6' : 'translate-x-1'}`}
								/>
							</button>
						</div>

						<div className="pt-3 border-t border-neutral-800 mt-4">
							<h5 className="text-xs font-semibold text-neutral-500 uppercase mb-2">{t('header.ownerTools')}</h5>

							<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
								<div className="flex items-center gap-2">
									<label className="text-sm font-medium text-white">{t('header.ownerBypassRules')}</label>
									<div className="group relative flex items-center">
										<HelpCircle size={14} className="text-neutral-500 hover:text-neutral-300 cursor-help" />
										<div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 p-3 bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-center pointer-events-none">
											{t('header.ownerBypassRulesTooltip')}
										</div>
									</div>
								</div>
								<button
									onClick={(e) => {
										e.stopPropagation();
										onUpdateSettings({ ownerBypass: !ownerBypass });
									}}
									className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${ownerBypass ? 'bg-orange-500' : 'bg-neutral-600'}`}
								>
									<span
										className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ownerBypass ? 'translate-x-6' : 'translate-x-1'}`}
									/>
								</button>
							</div>

							<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
								<div className="flex items-center gap-2">
									<label className="text-sm font-medium text-white">{t('header.ownerBypassQueue')}</label>
									<div className="group relative flex items-center">
										<HelpCircle size={14} className="text-neutral-500 hover:text-neutral-300 cursor-help" />
										<div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 p-3 bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-center pointer-events-none">
											{t('header.ownerBypassQueueTooltip')}
										</div>
									</div>
								</div>
								<button
									onClick={(e) => {
										e.stopPropagation();
										onUpdateSettings({ ownerQueueBypass: !ownerQueueBypass });
									}}
									className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${ownerQueueBypass ? 'bg-orange-500' : 'bg-neutral-600'}`}
								>
									<span
										className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ownerQueueBypass ? 'translate-x-6' : 'translate-x-1'}`}
									/>
								</button>
							</div>

							<div className="flex items-center justify-between p-3 bg-neutral-900/50 hover:bg-neutral-800/50 rounded-lg transition-colors border border-neutral-800/50">
								<label className="text-sm font-medium text-neutral-300">{t('header.popups')}</label>
								<button
									onClick={(e) => {
										e.stopPropagation();
										onUpdateSettings({ ownerPopups: !ownerPopups });
									}}
									className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${ownerPopups ? 'bg-orange-500' : 'bg-neutral-600'}`}
								>
									<span
										className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ownerPopups ? 'translate-x-6' : 'translate-x-1'}`}
									/>
								</button>
							</div>

							<div className="mt-4 pt-4 border-t border-neutral-800">
								<button
									onClick={(e) => {
										e.stopPropagation();
										// setShowSettings(false); // Handled by onClose if needed, or we just show modal
										setDeleteChannelText("");
										setShowDeleteChannelConfirm(true);
									}}
									className="w-full py-2 bg-red-900/10 text-red-500 border border-red-900/30 rounded-lg text-sm font-bold hover:bg-red-900/20 transition-colors flex items-center justify-center gap-2"
								>
									{t('header.deleteChannel')}
								</button>
							</div>

						</div>
					</div>
				</div>
			</div>

			{/* Delete Channel Confirmation Modal - Rendered locally within SettingsView is fine, or Portal */}
			{
				showDeleteChannelConfirm && (
					<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
						<div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
							<h3 className="text-xl font-bold text-white mb-2 text-center text-red-500">{t('header.deleteChannelTitle')}</h3>
							<p className="text-neutral-400 mb-6 text-center text-sm">
								{t('header.deleteChannelWarning')} <br />
								<span className="font-mono text-white bg-neutral-950 px-2 py-1 rounded select-all border border-neutral-800 mt-2 inline-block">{t('header.deleteChannelConfirmPhrase')}</span>
							</p>

							<input
								autoFocus
								type="text"
								value={deleteChannelText}
								onChange={(e) => setDeleteChannelText(e.target.value)}
								placeholder={t('header.deleteChannelType')}
								className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white placeholder-neutral-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 transition-all mb-6 text-sm font-mono text-center"
							/>

							<div className="flex gap-3">
								<button
									onClick={() => setShowDeleteChannelConfirm(false)}
									className="flex-1 px-4 py-3 rounded-xl border border-neutral-700 text-neutral-300 font-medium hover:bg-neutral-800 transition-all"
								>
									{t('lobby.cancel')}
								</button>
								<button
									disabled={deleteChannelText !== t('header.deleteChannelConfirmPhrase')}
									onClick={() => {
										if (deleteChannelText === t('header.deleteChannelConfirmPhrase')) {
											onDeleteChannel();
											setShowDeleteChannelConfirm(false);
											if (onClose) onClose();
										}
									}}
									className={`flex-1 px-4 py-3 rounded-xl font-bold transition-all ${deleteChannelText === t('header.deleteChannelConfirmPhrase')
										? "bg-red-600 text-white hover:bg-red-500 shadow-lg shadow-red-900/20"
										: "bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700"
										}`}
								>
									{t('lobby.delete')}
								</button>
							</div>
						</div>
					</div>
				)
			}
		</div>
	);
}

SettingsView.propTypes = {
	onClose: PropTypes.func.isRequired,
	pendingCount: PropTypes.number,
	suggestionMode: PropTypes.string,
	onManageRequests: PropTypes.func,
	onUpdateSettings: PropTypes.func,
	suggestionsEnabled: PropTypes.bool,
	autoApproveKnown: PropTypes.bool,
	musicOnly: PropTypes.bool,
	maxDuration: PropTypes.number,
	maxQueueSize: PropTypes.number,
	duplicateCooldown: PropTypes.number,
	smartQueue: PropTypes.bool,
	autoRefill: PropTypes.bool,
	requireLogin: PropTypes.bool,
	playlistViewMode: PropTypes.bool,
	allowPrelisten: PropTypes.bool,
	votesEnabled: PropTypes.bool,
	ownerBypass: PropTypes.bool,
	ownerQueueBypass: PropTypes.bool,
	ownerPopups: PropTypes.bool,
	onDeleteChannel: PropTypes.func,
	captionsEnabled: PropTypes.bool,
	isAppleRoom: PropTypes.bool,
	isConnected: PropTypes.bool,
	onFullscreenOverlay: PropTypes.func,
};
