// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useId, useState } from "react";
import PropTypes from "prop-types";
import { BatteryMedium, Bell, ChevronDown, MonitorSmartphone, PlugZap, Smartphone } from "lucide-react";
import { Language } from "../contexts/LanguageContext";
import { STANDBY_CHOICES, setAppleStandby, useAppleStandby } from "../utils/appleStandby";
import { formatHours } from "../utils/numbers";

// The chosen option: an orange outline with a soft light, as on the main tile
// of a view. It lies over the option as a layer that only fades, so nothing
// is painted again on the way.
const CHOSEN = "relative after:pointer-events-none after:absolute after:-inset-px after:rounded-[inherit] after:border after:border-accent after:opacity-0 after:shadow-[0_0_14px_rgb(249_115_22/0.28)] after:transition-opacity after:duration-150 after:ease-cv after:content-[''] has-[:checked]:after:opacity-100";

// The mark of a single choice: a ring, drawn as a line. The chosen one is
// orange with a little light around it and a dot inside.
function RadioMark({ checked }) {
	return (
		<span aria-hidden="true" className="relative flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 border-ink-3">
			<span className={`absolute -inset-0.5 rounded-full border-2 border-accent shadow-[0_0_10px_rgb(249_115_22/0.45)] transition-opacity duration-150 ease-cv ${checked ? "opacity-100" : "opacity-0"}`} />
			<span className={`h-2 w-2 rounded-full bg-accent transition-[opacity,transform] duration-150 ease-cv motion-reduce:transition-none ${checked ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} />
		</span>
	);
}

RadioMark.propTypes = {
	checked: PropTypes.bool,
};

/**
 * How long this phone stays ready while the channel is paused: the Android
 * app keeps the channel going in the background for that long (see
 * utils/appleStandby). The first block of an Apple Music channel's settings,
 * set apart as this phone's own; everything below it belongs to the channel.
 * The row shows the choice and unfolds in place: what the setting does, the
 * three durations, and what the waiting costs.
 */
export function StandbySetting() {
	const { t, language } = Language.useLanguage();
	const id = useId();
	const choice = useAppleStandby();
	const [open, setOpen] = useState(false);

	const label = (value) => (value === "channel" ? t("header.standbyUntilLeave") : formatHours(Number(value) / 60, language));
	const costs = [
		{ icon: BatteryMedium, line: t("header.standbyAwake") },
		{ icon: Bell, line: t("header.standbyNotice") },
		{ icon: PlugZap, line: t("header.standbyCharger") },
	];

	return (
		<div className="mb-6">
			<section className="border-b border-line pb-6">
				<h3 className="flex items-center gap-2 px-3 pb-2 text-[13px] font-medium text-ink-2">
					<Smartphone size={16} className="flex-none text-accent" aria-hidden="true" />
					<span>{t("header.standbyThisPhone")}</span>
				</h3>

				{/* The row: the setting's name over the choice. A tap unfolds it. */}
				<button
					type="button"
					aria-expanded={open}
					aria-controls={`${id}-more`}
					onClick={() => setOpen((wasOpen) => !wasOpen)}
					className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl bg-card px-3 py-2 text-start transition-[background-color,transform] duration-150 ease-cv active:scale-[0.99]"
				>
					<span className="min-w-0">
						<span id={`${id}-name`} className="block text-sm font-medium text-ink">{t("header.standbyName")}</span>
						<span className="block text-[13px] leading-5 text-accent">{label(choice)}</span>
					</span>
					<ChevronDown
						size={18}
						aria-hidden="true"
						className={`flex-none text-ink-3 transition-transform duration-200 ease-cv motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
					/>
				</button>

				{/* Unfolded: what it does, the three durations, what it costs. */}
				<div
					id={`${id}-more`}
					className={`grid transition-[grid-template-rows] duration-200 ease-cv motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
				>
					<div className={`min-h-0 overflow-hidden transition-opacity duration-200 ease-cv motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`} inert={!open}>
						<div className="ms-4 space-y-2 pt-2">
							<p className="text-pretty px-3 text-[13px] leading-relaxed text-ink-2">{t("header.standbyLead")}</p>

							<div role="radiogroup" aria-labelledby={`${id}-name`} className="space-y-1">
								{STANDBY_CHOICES.map((value) => {
									const checked = choice === value;
									return (
										<label
											key={value}
											className={`flex min-h-12 cursor-pointer select-none items-center justify-between gap-3 rounded-xl border border-transparent bg-card px-3 py-2.5 transition-transform duration-150 ease-cv active:scale-[0.99] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/70 ${CHOSEN}`}
										>
											<input
												type="radio"
												name={`${id}-choice`}
												value={value}
												checked={checked}
												onChange={() => setAppleStandby(value)}
												className="sr-only"
											/>
											<span className="min-w-0 flex-1 text-sm font-medium text-ink">{label(value)}</span>
											<RadioMark checked={checked} />
										</label>
									);
								})}
							</div>

							{/* What the waiting costs, said plainly. */}
							<ul className="space-y-2 px-3 pt-1">
								{costs.map((cost) => {
									const Icon = cost.icon;
									return (
										<li key={cost.line} className="flex gap-2.5 text-pretty text-[13px] leading-snug text-ink-2">
											<Icon size={16} className="mt-px flex-none text-ink-3" aria-hidden="true" />
											<span>{cost.line}</span>
										</li>
									);
								})}
							</ul>
						</div>
					</div>
				</div>
			</section>

			{/* Everything below is the channel's: said once, where the two meet. */}
			<p className="flex items-center gap-2 px-3 pt-6 text-[13px] font-medium text-ink-2">
				<MonitorSmartphone size={16} className="flex-none text-ink-3" aria-hidden="true" />
				<span>{t("header.standbyChannelScope")}</span>
			</p>
		</div>
	);
}
