// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY (route /__redesign, gated by import.meta.env.DEV in main.jsx, not
// bundled in production). The way into the two design proposals of November
// 2026: A, the revised lobby and room (this branch's own components). B, the
// new draft, is being set up again. Everything runs on the previews' mock data.
import React, { useEffect } from 'react';
import { Consent } from '../contexts/ConsentContext';

const VIEWS = [
	{
		title: 'A Überarbeitet',
		note: 'Aufbau und Abläufe wie heute, aufgeräumt.',
		links: [
			['Lobby', '/__lobby-preview'],
			['Lobby, erster Besuch', '/__lobby-preview?signedOut'],
			['Kanal erstellen', '/__lobby-preview?create'],
			['Raum am Computer, Gast', '/__room-preview?device=desktop&lang=de'],
			['Raum am Computer, Host', '/__room-preview?device=desktop&lang=de&role=owner'],
			['Raum am Handy, Gast', '/__room-preview?device=phone&lang=de'],
			['Raum am Handy, Apple Music', '/__room-preview?device=phone&lang=de&provider=apple'],
		],
	},
];

export default function Redesign() {
	// The cookie banner belongs to the real page: keep it closed here, as the
	// previews do. Nothing is accepted.
	const consent = Consent.useConsent();
	useEffect(() => {
		if (consent.showBanner) consent.setShowBanner(false);
	}, [consent]);

	return (
		<div className="min-h-screen bg-white px-6 py-10 text-neutral-900" style={{ colorScheme: 'light' }}>
			<div className="mx-auto max-w-3xl">
				<h1 className="text-3xl font-semibold tracking-tight">Zwei Vorschläge für cuevote.com</h1>
				<p className="mt-2 text-base text-neutral-700">
					Beide laufen mit Beispieldaten, ohne Server. Für die Handy-Ansicht das Fenster schmal ziehen (unter 768 px).
					Der Stand von heute liegt auf dem Branch main.
				</p>
				<div className="mt-8 grid gap-6 sm:grid-cols-2">
					{VIEWS.map((group) => (
						<section key={group.title} className="rounded-2xl border border-neutral-200 p-5">
							<h2 className="text-xl font-semibold">{group.title}</h2>
							<p className="mt-1 text-sm text-neutral-700">{group.note}</p>
							<ul className="mt-4 space-y-1">
								{group.links.map(([label, href]) => (
									<li key={href}>
										<a href={href} className="flex h-10 items-center justify-between rounded-lg px-3 text-[15px] font-medium text-neutral-900 hover:bg-neutral-100">
											{label}
											<span className="text-neutral-500" aria-hidden="true">›</span>
										</a>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
			</div>
		</div>
	);
}
