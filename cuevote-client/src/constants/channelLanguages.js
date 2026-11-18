// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
function countryCodeToEmoji(code) {
	return [...code.toUpperCase()].map(c =>
		String.fromCodePoint(0x1F1E5 + c.charCodeAt(0) - 64)
	).join('');
}

export const countryCodes = [
	'AF','AL','DZ','AS','AD','AO','AI','AQ','AG','AR','AM','AW','AU','AT','AZ',
	'BS','BH','BD','BB','BY','BE','BZ','BJ','BM','BT','BO','BA','BW','BR','IO',
	'VG','BN','BG','BF','BI','CV','KH','CM','CA','KY','CF','TD','CL','CN','CX',
	'CC','CO','KM','CG','CD','CK','CR','CI','HR','CU','CW','CY','CZ','DK','DJ',
	'DM','DO','EC','EG','SV','GQ','ER','EE','SZ','ET','FK','FO','FJ','FI','FR',
	'GF','PF','GA','GM','GE','DE','GH','GI','GR','GL','GD','GP','GU','GT','GG',
	'GN','GW','GY','HT','HN','HK','HU','IS','IN','ID','IR','IQ','IE','IM','IL',
	'IT','JM','JP','JE','JO','KZ','KE','KI','XK','KW','KG','LA','LV','LB','LS',
	'LR','LY','LI','LT','LU','MO','MG','MW','MY','MV','ML','MT','MH','MQ','MR',
	'MU','YT','MX','FM','MD','MC','MN','ME','MS','MA','MZ','MM','NA','NR','NP',
	'NL','NC','NZ','NI','NE','NG','NU','NF','KP','MK','MP','NO','OM','PK','PW',
	'PS','PA','PG','PY','PE','PH','PN','PL','PT','PR','QA','RE','RO','RU','RW',
	'BL','SH','KN','LC','MF','PM','VC','WS','SM','ST','SA','SN','RS','SC','SL',
	'SG','SX','SK','SI','SB','SO','ZA','GS','KR','SS','ES','LK','SD','SR','SJ',
	'SE','CH','SY','TW','TJ','TZ','TH','TL','TG','TK','TO','TT','TN','TR','TM',
	'TC','TV','UG','UA','AE','GB','US','VI','UY','UZ','VU','VA','VE','VN','WF',
	'EH','YE','ZM','ZW',
];

export const channelLanguages = [
	{ code: 'international', emoji: '🌐' },
	...countryCodes.map(code => ({ code, emoji: countryCodeToEmoji(code) }))
];

const legacyCodes = {
	en: 'GB', nl: 'NL', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pt: 'PT',
	'zh-CN': 'CN', 'zh-TW': 'TW', ja: 'JP', ko: 'KR', hi: 'IN', th: 'TH',
	vi: 'VN', id: 'ID', ms: 'MY', tl: 'PH', pl: 'PL', sv: 'SE', da: 'DK',
	no: 'NO', fi: 'FI', tr: 'TR', el: 'GR', ru: 'RU', uk: 'UA', cs: 'CZ',
	hu: 'HU', ro: 'RO', bg: 'BG', hr: 'HR', sr: 'RS', sk: 'SK', ar: 'SA',
	he: 'IL', dan: 'DK',
};

/** Whether a channel's country is one the lobby has a flag for. */
export function hasFlag(code) {
	if (!code || code === 'international') return false;
	const resolved = legacyCodes[code] || code;
	return countryCodes.includes(String(resolved).toUpperCase());
}

export function getFlagEmoji(code) {
	if (!code || code === 'international') return '🌐';
	const resolved = legacyCodes[code] || code;
	if (resolved.length === 2) return countryCodeToEmoji(resolved);
	return '🌐';
}
