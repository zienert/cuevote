// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// Design proposal B ("Neu"), DEV previews only. The words this draft adds to
// the ones the app already has. They are proposals, in German and English;
// every other language reads the English until the draft becomes the app and
// its strings move into the 35 locale files.
import { Language } from '../contexts/LanguageContext';

const COPY = {
	de: {
		heroTitle: 'Die Party stimmt ab, was als Nächstes läuft.',
		heroText: 'Das Musikvideo läuft auf dem Fernseher oder Laptop. Alle schlagen Titel vor und stimmen am Handy ab, ohne App.',
		heroSecondary: 'Offene Kanäle ansehen',
		heroNote: 'Mit Videos von YouTube oder Musik von Apple Music. Für private Partys.',
		demoHint: 'Probier es aus: Stimm für einen Titel.',
		demoLabel: 'Beispiel',
		step1Title: 'Kanal erstellen',
		step1Text: 'Am Laptop oder Fernseher. Dort läuft das Video.',
		step2Title: 'QR-Code zeigen',
		step2Text: 'Gäste scannen ihn und sind dabei, ohne App.',
		step3Title: 'Abstimmen',
		step3Text: 'Der Titel mit den meisten Stimmen läuft als Nächstes.',
		channelsTitle: 'Offene Kanäle',
		channelsPrivate: 'Private Kanäle',
		channelsMine: 'Meine Kanäle',
		channelsEmpty: 'Gerade ist kein Kanal offen. Erstelle den ersten.',
		nowIn: 'Läuft gerade',
		allCountries: 'Alle Länder',
		join: 'Beitreten',
		voteUp: 'Dafür stimmen',
		voteDown: 'Dagegen stimmen',
		suggestTitle: 'Titel vorschlagen',
		joinTitle: 'Mitmachen',
		joinText: 'Code scannen, abstimmen. Ohne App.',
		played: 'Schon gelaufen',
		suggestedBy: 'von',
		addAgain: 'Wieder vorschlagen',
		emptyQueue: 'Noch kein Titel in der Liste. Schlag den ersten vor.',
		copyLink: 'Link kopieren',
		copied: 'Kopiert',
		next: 'Als Nächstes dran',
	},
	en: {
		heroTitle: 'The party votes on what plays next.',
		heroText: 'The music video plays on the TV or laptop. Everyone suggests songs and votes from their phone, no app needed.',
		heroSecondary: 'See open channels',
		heroNote: 'With videos from YouTube or music from Apple Music. For private parties.',
		demoHint: 'Try it: vote for a song.',
		demoLabel: 'Example',
		step1Title: 'Create a channel',
		step1Text: 'On a laptop or TV. That is where the video plays.',
		step2Title: 'Show the QR code',
		step2Text: 'Guests scan it and are in, no app needed.',
		step3Title: 'Vote',
		step3Text: 'The song with the most votes plays next.',
		channelsTitle: 'Open channels',
		channelsPrivate: 'Private channels',
		channelsMine: 'My channels',
		channelsEmpty: 'No channel is open right now. Create the first one.',
		nowIn: 'Playing now',
		allCountries: 'All countries',
		join: 'Join',
		voteUp: 'Vote up',
		voteDown: 'Vote down',
		suggestTitle: 'Suggest a song',
		joinTitle: 'Join in',
		joinText: 'Scan the code and vote. No app needed.',
		played: 'Already played',
		suggestedBy: 'by',
		addAgain: 'Suggest again',
		emptyQueue: 'No song in the list yet. Suggest the first one.',
		copyLink: 'Copy link',
		copied: 'Copied',
		next: 'Up next',
	},
};

/** The draft's own words in the current language. */
export function useCopy() {
	const { language } = Language.useLanguage();
	const words = COPY[language] || COPY.en;
	return (key) => words[key] ?? COPY.en[key] ?? key;
}
