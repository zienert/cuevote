// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useEffect, useId, useState } from "react";
import PropTypes from "prop-types";
import { HelpCircle, ChevronLeft } from "lucide-react";
import { Language } from '../contexts/LanguageContext';

// One setting: its name, an optional explanation that opens under the name
// when the question mark is tapped (a hover bubble cannot be reached on a
// phone), and its control on the right.
function Row({ label, help, indent = false, children }) {
	const id = useId();
	const [helpOpen, setHelpOpen] = useState(false);
	return (
		<div className={`rounded-xl bg-card px-3 py-2.5 ${indent ? "ml-4" : ""}`}>
			<div className="flex min-h-7 items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-1.5">
					<span id={id} className="min-w-0 text-sm font-medium text-ink">{label}</span>
					{help && (
						<button
							type="button"
							aria-expanded={helpOpen}
							aria-controls={`${id}-help`}
							aria-label={help}
							onClick={(event) => {
								event.stopPropagation();
								setHelpOpen((open) => !open);
							}}
							className={`cv-hit flex h-6 w-6 flex-none items-center justify-center rounded-full transition-colors duration-150 hover:text-ink ${helpOpen ? "text-ink" : "text-ink-3"}`}
						>
							<HelpCircle size={15} aria-hidden="true" />
						</button>
					)}
				</div>
				{children(id)}
			</div>
			{help && (
				<div
					id={`${id}-help`}
					className={`grid transition-[grid-template-rows] duration-200 ease-cv motion-reduce:transition-none ${helpOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
				>
					<div className="min-h-0 overflow-hidden" inert={!helpOpen}>
						<p className="pt-1.5 text-[13px] leading-relaxed text-ink-2">{help}</p>
					</div>
				</div>
			)}
		</div>
	);
}

Row.propTypes = {
	label: PropTypes.string.isRequired,
	help: PropTypes.string,
	indent: PropTypes.bool,
	children: PropTypes.func.isRequired,
};

// A switch: orange when on. Named by its row for screen readers.
function Toggle({ on, onChange, labelledBy }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-labelledby={labelledBy}
			onClick={(event) => {
				event.stopPropagation();
				onChange(!on);
			}}
			className={`cv-hit relative inline-flex h-6 w-11 flex-none cursor-pointer items-center rounded-full transition-colors duration-150 ${on ? "bg-accent" : "bg-ink/20"}`}
		>
			<span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform duration-150 ease-cv ${on ? "translate-x-6" : "translate-x-1"}`} />
		</button>
	);
}

Toggle.propTypes = {
	on: PropTypes.bool,
	onChange: PropTypes.func.isRequired,
	labelledBy: PropTypes.string,
};

// A choice out of a few values, as the device's own picker.
function Choice({ value, onChange, labelledBy, children }) {
	return (
		<select
			value={value}
			aria-labelledby={labelledBy}
			onChange={(event) => onChange(Number(event.target.value))}
			onClick={(event) => event.stopPropagation()}
			className="h-9 flex-none rounded-lg border border-line bg-raised px-2.5 text-sm text-ink transition-[border-color,box-shadow] duration-150 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent/70"
		>
			{children}
		</select>
	);
}

Choice.propTypes = {
	value: PropTypes.number,
	onChange: PropTypes.func.isRequired,
	labelledBy: PropTypes.string,
	children: PropTypes.node,
};

function Section({ title, children }) {
	return (
		<section className="space-y-1">
			<h3 className="px-3 pb-1 text-[13px] font-medium text-ink-2">{title}</h3>
			{children}
		</section>
	);
}

Section.propTypes = {
	title: PropTypes.string.isRequired,
	children: PropTypes.node,
};

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
	const [deleteChannelText, setDeleteChannelText] = useState("");
	const [showDeleteChannelConfirm, setShowDeleteChannelConfirm] = useState(false);

	useEffect(() => {
		onFullscreenOverlay?.(showDeleteChannelConfirm);
	}, [showDeleteChannelConfirm, onFullscreenOverlay]);

	const set = (key) => (value) => onUpdateSettings({ [key]: value });

	return (
		<div className="custom-scrollbar h-full w-full overflow-y-auto bg-page px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] text-ink sm:px-6 md:px-8">
			<div className="mx-auto max-w-6xl">
				<div className="mb-6 flex items-center gap-3 border-b border-line pb-3">
					<button
						onClick={onClose}
						className="cv-hit -ml-1 flex h-10 items-center gap-1 rounded-lg pl-1 pr-3 text-sm font-medium text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink"
					>
						<ChevronLeft size={18} aria-hidden="true" />
						{t('header.back')}
					</button>
					<div className="h-5 w-px bg-line" aria-hidden="true" />
					<h2 className="text-base font-semibold text-ink">{t('header.settings')}</h2>
				</div>

				<div className={`grid grid-cols-1 gap-6 transition-opacity duration-200 lg:grid-cols-3 ${!isConnected ? "pointer-events-none opacity-50 grayscale" : ""}`}>
					{/* Column 1: Requests & Suggestions */}
					<Section title={t('header.suggestions')}>
						{(pendingCount > 0 || suggestionMode === 'manual') && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									// No onClose() here: the handler in RoomBody opens the
									// requests page and closes this panel itself.
									onManageRequests();
								}}
								className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5 text-left text-sm font-medium text-accent transition-colors duration-150 hover:bg-accent/15 active:scale-[0.99]"
							>
								<span>{t('header.reviewRequests')}</span>
								<span className="min-w-6 rounded-full bg-accent px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums text-accent-ink">{pendingCount}</span>
							</button>
						)}

						<Row label={t('header.allowSuggestions')}>
							{(id) => <Toggle on={suggestionsEnabled} onChange={set('suggestionsEnabled')} labelledBy={id} />}
						</Row>

						{suggestionsEnabled && (
							<>
								<Row label={t('header.manualReview')} indent>
									{(id) => <Toggle on={suggestionMode === 'manual'} onChange={(manual) => onUpdateSettings({ suggestionMode: manual ? 'manual' : 'auto' })} labelledBy={id} />}
								</Row>
								<Row label={t('header.approveKnown')} help={t('header.approveKnownTooltip')} indent>
									{(id) => <Toggle on={autoApproveKnown} onChange={set('autoApproveKnown')} labelledBy={id} />}
								</Row>
							</>
						)}
					</Section>

					{/* Column 2: Queue & Playback */}
					<Section title={t('header.queuePlayback')}>
						{!isAppleRoom && (
							<Row label={t('header.musicOnly')}>
								{(id) => <Toggle on={musicOnly} onChange={set('musicOnly')} labelledBy={id} />}
							</Row>
						)}

						<Row label={t('header.maxLength')}>
							{(id) => (
								<Choice value={maxDuration} onChange={set('maxDuration')} labelledBy={id}>
									<option value={0}>{t('header.noLimit')}</option>
									<option value={300}>5 {t('header.mins')}</option>
									<option value={600}>10 {t('header.mins')}</option>
									<option value={900}>15 {t('header.mins')}</option>
									<option value={1800}>30 {t('header.mins')}</option>
								</Choice>
							)}
						</Row>

						<Row label={t('header.maxQueueSize')}>
							{(id) => (
								<Choice value={maxQueueSize} onChange={set('maxQueueSize')} labelledBy={id}>
									<option value={0}>{t('header.noLimit')}</option>
									<option value={10}>10 {t('header.videos')}</option>
									<option value={25}>25 {t('header.videos')}</option>
									<option value={50}>50 {t('header.videos')}</option>
									<option value={100}>100 {t('header.videos')}</option>
									<option value={250}>250 {t('header.videos')}</option>
									<option value={500}>500 {t('header.videos')}</option>
								</Choice>
							)}
						</Row>

						<Row label={t('header.preventRepetition')}>
							{(id) => (
								<Choice value={duplicateCooldown ?? 10} onChange={set('duplicateCooldown')} labelledBy={id}>
									<option value={0}>{t('header.noLimit')}</option>
									<option value={5}>5 {t('header.videos')}</option>
									<option value={10}>10 {t('header.videos')}</option>
									<option value={20}>20 {t('header.videos')}</option>
									<option value={50}>50 {t('header.videos')}</option>
									<option value={100}>100 {t('header.videos')}</option>
								</Choice>
							)}
						</Row>

						<Row label={t('header.smartQueue')} help={t('header.smartQueueTooltip')}>
							{(id) => <Toggle on={smartQueue} onChange={set('smartQueue')} labelledBy={id} />}
						</Row>

						<Row label={t('header.autoRefill')} help={t('header.autoRefillTooltip')}>
							{(id) => <Toggle on={autoRefill} onChange={set('autoRefill')} labelledBy={id} />}
						</Row>
					</Section>

					{/* Column 3: Advanced & Features */}
					<div className="space-y-6">
						<Section title={t('header.features')}>
							<Row label={t('header.requireLogin')} help={t('header.requireLoginTooltip')}>
								{(id) => <Toggle on={requireLogin} onChange={set('requireLogin')} labelledBy={id} />}
							</Row>

							{!isAppleRoom && (
								<Row label={t('header.venueMode')} help={t('header.venueModeTooltip')}>
									{(id) => <Toggle on={playlistViewMode} onChange={set('playlistViewMode')} labelledBy={id} />}
								</Row>
							)}

							<Row label={t('header.allowPrelisten')}>
								{(id) => <Toggle on={allowPrelisten} onChange={set('allowPrelisten')} labelledBy={id} />}
							</Row>

							{!isAppleRoom && (
								<Row label={t('lobby.startWithCaptions')} help={t('header.captionsTooltip')}>
									{(id) => <Toggle on={captionsEnabled} onChange={set('captionsEnabled')} labelledBy={id} />}
								</Row>
							)}

							<Row label={t('header.allowVoting')}>
								{(id) => <Toggle on={votesEnabled} onChange={set('votesEnabled')} labelledBy={id} />}
							</Row>
						</Section>

						<Section title={t('header.ownerTools')}>
							<Row label={t('header.ownerBypassRules')} help={t('header.ownerBypassRulesTooltip')}>
								{(id) => <Toggle on={ownerBypass} onChange={set('ownerBypass')} labelledBy={id} />}
							</Row>

							<Row label={t('header.ownerBypassQueue')} help={t('header.ownerBypassQueueTooltip')}>
								{(id) => <Toggle on={ownerQueueBypass} onChange={set('ownerQueueBypass')} labelledBy={id} />}
							</Row>

							<Row label={t('header.popups')}>
								{(id) => <Toggle on={ownerPopups} onChange={set('ownerPopups')} labelledBy={id} />}
							</Row>
						</Section>

						<button
							onClick={(e) => {
								e.stopPropagation();
								setDeleteChannelText("");
								setShowDeleteChannelConfirm(true);
							}}
							className="cv-btn h-11 w-full border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20"
						>
							{t('header.deleteChannel')}
						</button>
					</div>
				</div>
			</div>

			{/* Delete Channel Confirmation Modal - Rendered locally within SettingsView is fine, or Portal */}
			{
				showDeleteChannelConfirm && (
					<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
						<div className="w-full max-w-sm rounded-2xl border border-line bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
							<h3 className="mb-2 text-center text-xl font-semibold text-red-400">{t('header.deleteChannelTitle')}</h3>
							<p className="mb-6 text-center text-sm leading-relaxed text-ink-2">
								{t('header.deleteChannelWarning')} <br />
								<span className="mt-2 inline-block select-all rounded-md border border-line bg-page px-2 py-1 font-mono text-ink">{t('header.deleteChannelConfirmPhrase')}</span>
							</p>

							<input
								autoFocus
								type="text"
								value={deleteChannelText}
								onChange={(e) => setDeleteChannelText(e.target.value)}
								placeholder={t('header.deleteChannelType')}
								className="mb-6 w-full rounded-xl border border-line bg-page px-4 py-3 text-center font-mono text-sm text-ink placeholder:text-ink-3 transition-colors duration-150 focus:border-red-500/60 focus:outline-none"
							/>

							<div className="flex gap-3">
								<button
									onClick={() => setShowDeleteChannelConfirm(false)}
									className="cv-btn cv-btn-quiet h-11 flex-1"
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
									className="cv-btn h-11 flex-1 bg-red-600 font-semibold text-white hover:bg-red-500 disabled:bg-raised disabled:text-ink-3 disabled:opacity-100"
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
