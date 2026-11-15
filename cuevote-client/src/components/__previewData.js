// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY: the data of the two previews (/__lobby-preview, /__room-preview)
// for a stress test. The demo data is kind: names that fit, small counts,
// every field filled in. ?data=... swaps it at the mock socket, where the
// demo data comes from too:
//
//   ?data=worst   the realistic worst case for every value at once: the
//                 longest name the server accepts, a word that cannot break,
//                 one-letter names, other scripts, emoji, missing fields,
//                 text that looks like markup, big and negative counts
//   ?data=empty   nothing there
//   ?data=one     a single entry, every count at 1
//   ?data=many    the realistic upper bound (300 titles, 200 channels)
//
// With ?data in the address a plain switch shows at the bottom of the page
// (__PreviewDataToggle.jsx).
const PARAMS = new URLSearchParams(window.location.search);
export const STATES = ['demo', 'worst', 'empty', 'one', 'many'];
// The switch shows only when the address asks for a dataset.
export const SHOW_SWITCH = PARAMS.has('data');
export const DATA = STATES.includes(PARAMS.get('data')) ? PARAMS.get('data') : 'demo';

// The longest channel name the server takes is 100 characters (schemas.js).
export const WORST_CHANNEL_NAME = 'Geburtstagsüberraschungsparty für Aleksandra & Konstantin – Dachterrasse, 3. Stock (bitte leise) 🎉';

// [title, artist]. YouTube titles end at 100 characters, Apple Music's
// classical titles run longer. null: the field is missing, as after the
// 28-day cleanup of YouTube metadata.
export const WORST_SONGS = [
	['Symphony No. 9 in D Minor, Op. 125 "Choral": IV. Finale. Presto – Allegro assai – Rezitativo (Ode to Joy)', 'Berliner Philharmoniker, Herbert von Karajan, Wiener Singverein, Gundula Janowitz & Walter Berry'],
	['Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz', 'K'],
	['X', 'Nicky Jam & J Balvin'],
	['Đừng Làm Trái Tim Anh Đau', 'Sơn Tùng M-TP'],
	['残酷な天使のテーゼ', '高橋洋子'],
	['تملي معاك', 'عمرو دياب'],
	['<b>Bold</b> &amp; Beautiful **live** <script>alert(1)</script>', 'Tom & Jerry <i>feat.</i> "Quotes"'],
	['🔥🔥🔥 SUMMER HITS 2026 MEGA MIX 🔥🔥🔥 Best Of Deep House | Tropical | Chill Out (Official Video) [4K]', 'MusicChannelOfficialVEVO_TopHitsWorldwide2026'],
	['Untitled', null],
	[null, null],
	['Intro', 'The xx'],
	['Intro', 'The xx'],
	['  Leading   and   trailing   spaces  ', 'dana'],
];

// Who suggested it: a long name, a short one, a guest, emoji first, a name
// with a suffix, right-to-left, nobody.
export const WORST_SUGGESTERS = [
	{ suggestedByUsername: 'Aleksandra Wiśniewska-Kowalczyk' },
	{ suggestedByUsername: 'Jo' },
	{ suggestedByIsGuest: true, suggestedByGuestTag: 'K7QF' },
	{ suggestedByUsername: '👩🏽‍💻 Priya' },
	{ suggestedByUsername: 'Christopher Alexander Montgomery III' },
	{ suggestedByUsername: 'نور الهدى عبد الرحمن' },
	{},
];

// A count that needs a separator, one that is about to gain a digit (vote it
// up), one, zero, and below zero.
export const WORST_SCORES = [1284, 99, 12, 1, 0, 0, -1, -12, 3, 2, 1, 0, 0];

// A picture that fails to load: the fallback has to show.
const BROKEN_PICTURE = 'data:image/png;base64,AAAA';
export const WORST_USER = { name: 'Christopher Alexander Montgomery III', picture: BROKEN_PICTURE };

// [name, options] for the lobby's channel(): see __LobbyPreview.jsx.
export const WORST_CHANNELS = [
	[WORST_CHANNEL_NAME, { listeners: 1284, thumb: 0, flag: 'de', mine: true, track: WORST_SONGS[0] }],
	['Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz', { provider: 'apple', listeners: 1, flag: 'de', mine: true }],
	['Jo', { active: false, flag: 'zz' }],
	['週末カラオケパーティー！みんなで歌おう', { listeners: 12, thumb: 1, flag: 'jp', track: WORST_SONGS[4] }],
	['سهرة الخميس مع الأصدقاء', { listeners: 3, thumb: 2, flag: 'sa', track: WORST_SONGS[5] }],
	['<b>Bold</b> &amp; **Beautiful** <script>alert(1)</script>', { listeners: 2, thumb: 3, track: WORST_SONGS[6] }],
	['🦊🔥🎉', { provider: 'apple', listeners: 7 }],
	['Party', { listeners: 5, thumb: 4, flag: 'gb', track: WORST_SONGS[2] }],
	['Party', { listeners: 5, thumb: 4, flag: 'gb', track: WORST_SONGS[2] }],
	['Đêm Nhạc Trẻ Sài Gòn', { listeners: 12345, thumb: 5, flag: 'vn', isPublic: false, password: true, mine: true }],
	['  Sam   Lee ', { provider: 'apple', isPublic: false, password: true, flag: 'us' }],
];
