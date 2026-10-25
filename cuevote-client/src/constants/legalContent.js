// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert

import { legalProfile } from './legalProfile';

// Helper takes en reference as argument so we never close over LEGAL_CONTENT (avoids "Cannot access before initialization" with bundlers).
const withEnglishContent = (enRef, overrides) => ({
	...enRef,
	...overrides,
	terms: enRef.terms,
	privacy: enRef.privacy,
	imprint: enRef.imprint
});

// English content defined first so LEGAL_CONTENT is built in one assignment (no mutation = no TDZ).
const enContent = {
	title: "Transparency & Trust",
		subtitle: "We believe in open communication. Here's everything you need to know about how we operate, protect your data, and respect your rights.",
		back: "Back",
		center: "Legal Center",
		lastUpdated: "Last updated",
		tabs: {
			terms: { label: 'Terms of Service', desc: "Agreements & Usage" },
			privacy: { label: 'Privacy Policy', desc: "GDPR & Data" },
			imprint: { label: 'Colophon', desc: "Company Info" },
			attributions: { label: 'Attributions', desc: "Third-Party Software" },
		},
		// Removed "Note on Language:" prefix to avoid duplication if we want to include it in the string,
		// or we will just use this string as the full alert content.
		disclaimer: "Note on Language: Those terms are legally binding in their English version. Any translations provided are for convenience only. In the event of a discrepancy, the English original prevails.",
		terms: {
			intro: "Welcome to CueVote. These terms govern your use of our platform. By accessing CueVote, you agree to these terms and the YouTube Terms of Service.",
			sections: [
				{
					title: "1. Service & Usage",
					content: `CueVote is a social interface for consuming content via third-party APIs (primarily YouTube). We do not host, store, or distribute media files. The underlying source code is licensed under the <a href="https://polyformproject.org/licenses/noncommercial/1.0.0" target="_blank" rel="noopener noreferrer">PolyForm Noncommercial License</a>.<br /><br />The standard service at <a href="https://cuevote.com" target="_blank" rel="noopener noreferrer">cuevote.com</a> is designed for personal, private use. Please note that third-party content providers have their own strict rules regarding how their media can be consumed. We do not authorize, endorse, or grant any licenses for public performance or commercial use of third-party content.`
				},
				{
					title: "2. Integration with Third-Party Platforms (YouTube)",
					content: `By using CueVote, you explicitly agree to the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>. Please be aware that YouTube's Terms of Service generally prohibit the use of their service for public performance or commercial use without proper licensing.<br /><br />It is your sole responsibility to ensure that your specific use case complies with YouTube's TOS. CueVote merely provides the interface and assumes no liability for copyright claims, API restrictions, or legal actions resulting from how you choose to use the platform.`
				},
				{
					title: "3. User Responsibilities",
					list: [
						"You must be at least 16 years of age.",
						"You are responsible for the security of your session and account.",
						"You agree not to abuse the platform, harass users, or attempt to reverse-engineer our code."
					]
				},
				{
					title: "4. Disclaimer & Liability",
					content: `The service is provided "as is". CueVote disclaims all warranties. To the fullest extent permitted by Dutch law, we shall not be liable for any indirect damages arising from your use of the service.`
				},
				{
					title: "5. Google Privacy Policy",
					content: `Since we utilize YouTube API Services, you acknowledge that by using those services, your data may be processed in accordance with the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.`,
				},
				{
					title: "6. Governing Law",
					content: `These terms are governed by the laws of <strong>The Netherlands</strong>. Any disputes shall be subject to the exclusive jurisdiction of the courts in Amsterdam, unless mandatory consumer protection laws dictate otherwise.`
				}
			]
		},
		privacy: {
			summary: {
				title: "GDPR & Google Data Summary",
				text: "We collect minimal data to make the app work and use YouTube's API for content. We don't sell your data. We respect your privacy rights under European Law (AVG/GDPR)."
			},
			sections: [
				{
					title: "1. Who We Are",
					content: `Data Controller:<br />
                            <strong>${legalProfile.entityName}</strong><br />
                            ${legalProfile.addressLines.join('<br />')}<br />
                            The Netherlands<br />
                            Contact: <a href="mailto:${legalProfile.controllerEmail}">${legalProfile.controllerEmail}</a>`
				},
				{
					title: "2. Data Collection & Purpose",
					intro: "We process data for specific, legitimate purposes:",
					list: [
						{ title: "Google Account Information", text: "When you login via Google, we verify your identity and store your email, name, and avatar URL to display your profile in rooms. Retention: data is kept until you delete your account; we do not perform automated deletion based on inactivity. Legal basis: Contract (Art. 6.1.b GDPR)." },
						{ title: "Guest Participation", text: "You can vote and suggest songs without an account. Your browser then gets a random guest ID from our server and keeps it in local storage, so each vote counts once and stays yours after a reconnect. Others in the channel see your suggestions as “Guest” plus a four-character code derived from this ID. The ID is not linked to your name, email or Google account. If you sign in later, your guest votes and suggestions move to your account. To prevent abuse, the server counts in memory how many new guest IDs an IP address requests within 10 minutes. Retention: the ID stays in your browser until you clear the site data; on our server it is stored only with a channel's queue until the track has played or been removed, and in backups for up to 14 days. Legal basis: Contract (Art. 6.1.b GDPR); abuse prevention: Legitimate Interest (Art. 6.1.f GDPR)." },
						{ title: "Usage Statistics", text: "We log a history of which videos were played in which rooms to improve recommendations. Votes are saved with the channel's queue so that a server restart does not lose them, and are deleted once the track has played or been removed. This data is internal to CueVote. Retention: room history is retained for the lifetime of the associated room; empty rooms are deleted automatically after 7 days. Legal basis: Legitimate Interest (Art. 6.1.f GDPR)." },
						{ title: "YouTube API Data", text: "When you search or play songs, we send requests to YouTube's API. YouTube may collect data on your viewing behavior via their embedded player. Retention: cached video metadata (titles, thumbnails, durations) is cleared after 28 days; search and related-video caches are deleted after 28 days. Video IDs may be retained as part of room history. Legal basis: Contract/Consent (via your use of YouTube)." },
						{ title: "Server Logs & Security", text: "To ensure the stability and security of our service (e.g., defense against DDoS attacks), we process technical connection data (IP address and timestamp). This connection data is initially processed by our CDN provider (Cloudflare) at the network edge for security and routing purposes before reaching our servers. Retention: server access logs (nginx) are rotated daily by standard Debian logrotate and retained for approximately 14 days. Legal basis: Legitimate Interest (Art. 6.1.f GDPR)." },
						{ title: "Database Backups", text: "We perform automated daily snapshots of our database to protect against data loss. Backups are stored on the same EU server as the application, and once a week an encrypted copy of the server is stored with our hosting provider in a separate EU data center (France). Backups contain all data described above (including your Google account information and room history). Retention: daily snapshots are automatically pruned after 7 days; the weekly copy is replaced every week, so data deleted on the server is gone from all backups within 14 days. Legal basis: Legitimate Interest (Art. 6.1.f GDPR)." }
					]
				},
				{
					title: "3. Third-Party Processors",
					content: `We engage trusted third parties to operate our infrastructure. We ensure they are GDPR compliant.`,
					listSimple: [
						`<strong>Google/YouTube</strong> (Auth & Content API; Gmail inbox for emails to our domain) - USA. <br /><span class="text-sm">Emails sent to addresses on our domain are ultimately delivered to a Google (Gmail) inbox, where we read and reply to them. See <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.</span>`,
						`<strong>Cloudflare, Inc.</strong> (CDN, Reverse Proxy, DDoS Protection, Web Analytics, Email Routing) - USA. <br /><span class="text-sm">All traffic to cuevote.com is routed through Cloudflare's global network for security, performance, and privacy-friendly analytics. Additionally, email sent to addresses on our domain (e.g. privacy@cuevote.com) is received and forwarded by Cloudflare Email Routing to our email provider (see below); email content is processed solely for delivery purposes and not permanently stored by Cloudflare. Cloudflare is certified under the EU-US Data Privacy Framework. See <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare Privacy Policy</a>.</span>`,
						`<strong>mailbox.org (Heinlein Hosting GmbH)</strong> (Email Provider) - Germany (EU). <br /><span class="text-sm">Email forwarded by Cloudflare Email Routing is received by our mailbox.org account, which in turn forwards it to the Google (Gmail) inbox noted above. mailbox.org processes the email content solely to receive, store, and forward your message. See <a href="https://mailbox.org/en/data-protection/" target="_blank" rel="noopener noreferrer">mailbox.org Data Protection Notice</a>.</span>`,
						`<strong>Hosting Provider</strong> (Server Infrastructure & self-hosted SQLite database on the same server, encrypted weekly backup copy in a separate data center) - EU.`
					]
				},
				{
					title: "4. Your Rights",
					content: `Under the GDPR, you have the following rights regarding your personal data:
                    <br /><br />
                    <strong>Right of access (Art. 15)</strong> – obtain confirmation and a copy of your personal data.<br />
                    <strong>Right to rectification (Art. 16)</strong> – correct inaccurate or incomplete data.<br />
                    <strong>Right to erasure / "Right to be Forgotten" (Art. 17)</strong> – request deletion of your data.<br />
                    <strong>Right to restriction of processing (Art. 18)</strong> – limit how we process your data.<br />
                    <strong>Right to data portability (Art. 20)</strong> – request a copy of your data in a structured, machine-readable format (handled manually upon written request to our contact email).<br />
                    <strong>Right to object (Art. 21)</strong> – object at any time to processing based on legitimate interest (e.g. usage statistics, server logs).<br />
                    <strong>Right to withdraw consent (Art. 7.3)</strong> – withdraw any consent you have given, without affecting the lawfulness of processing prior to withdrawal.
                    <br /><br />
                    To exercise these rights, contact us at the email provided above. You can also revoke our access to your Google Data via the <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">Google Security Settings</a> page.
                    <br /><br />
                    <strong>Right to lodge a complaint (Art. 77):</strong> You have the right to lodge a complaint with a supervisory authority. The competent authority for CueVote is the Dutch Data Protection Authority – <a href="https://autoriteitpersoonsgegevens.nl" target="_blank" rel="noopener noreferrer">Autoriteit Persoonsgegevens</a>.`
				},
				{
					title: "5. Cookies",
					content: `We use only essential local storage to maintain your session (e.g. your login token, or your guest ID if you take part without an account). Our CDN provider Cloudflare may set the essential <code>__cf_bm</code> cookie (30 minute lifetime) for bot mitigation purposes; this cookie does not store personal data and is classified as strictly necessary. We do not use third-party tracking cookies for advertising (marketing cookies) on our own domain, though third-party embeds (YouTube) may set their own cookies.`
				},
				{
					title: "6. Security Measures",
					content: `In accordance with Art. 32 GDPR, we implement appropriate technical and organizational measures to protect your personal data:
                    <br /><br />
                    <strong>Encryption in transit:</strong> All traffic is served over HTTPS (TLS) and terminated by Cloudflare.<br />
                    <strong>Authentication:</strong> Authentication is handled exclusively via Google OAuth 2.0; we do not store user passwords.<br />
                    <strong>Session tokens:</strong> Sessions are protected by cryptographically random 32-byte tokens.<br />
                    <strong>Room passwords:</strong> Optional room passwords are hashed using bcrypt before storage.<br />
                    <strong>Database access:</strong> The database file is stored on a dedicated EU server with restricted file-system permissions.<br />
                    <strong>Logging:</strong> Structured server logs redact sensitive fields (tokens, emails, passwords) at the logger level.<br />
                    <strong>Backups:</strong> Daily database backups stay on the same server and are pruned after 7 days; an encrypted weekly copy is kept in a separate EU data center and replaced every week.`
				},
				{
					title: "7. Data Breach Notification",
					content: `In the event of a personal data breach that is likely to result in a risk to your rights and freedoms, we will notify the competent supervisory authority (Autoriteit Persoonsgegevens) within 72 hours of becoming aware of the breach, as required by Art. 33 GDPR. Where the breach is likely to result in a <strong>high risk</strong> to your rights and freedoms, we will also inform affected users directly without undue delay (Art. 34 GDPR).`
				}
			]
		},
		imprint: {
			operatorHeading: "Operator",
			registeredOfficeHeading: "Registered Office",
			managedBy: "Managed by",
			abuse: "Report Abuse",
			country: "The Netherlands",
			contact: "Contact",
			liability: {
				title: "Liability for Content:",
				text: "While we strive for accuracy, we cannot guarantee the completeness or correctness of the information on this website. We are not liable for the content of external links."
			},
			odr: {
				title: "Online Dispute Resolution:",
				text: `The European Commission provides a platform for ODR at <a href="https://ec.europa.eu/consumers/odr" class="text-neutral-400 underline hover:text-white">ec.europa.eu/consumers/odr</a>. We are not obliged to participate in dispute settlement proceedings.`
			}
		},
		attributions: {
			intro: "CueVote runs on components from the wider open-source ecosystem. Every component is used under a permissive license (MIT, ISC, BSD-2-Clause, BSD-3-Clause, or Apache-2.0). The complete, machine-generated list — with versions, license texts, copyright holders, and upstream sources — is maintained in the NOTICES file in our repository.",
			noticesLinkLabel: "View full third-party notices",
			noticesUrl: "https://github.com/zienert/cuevote/blob/main/NOTICES.md",
			highlights: {
				title: "Notable components",
				frontend: {
					title: "Frontend",
					items: [
						"React & React DOM (MIT) — Meta Platforms, Inc.",
						"react-router-dom (MIT) — Remix Software",
						"@react-oauth/google (MIT) — Mo'men Sherif",
						"lucide-react (ISC) — Eric Fennis et al.",
						"qrcode.react (ISC) — Paul O'Shannessy",
						"jwt-decode (MIT) — Auth0"
					]
				},
				backend: {
					title: "Backend",
					items: [
						"pino (MIT) — Matteo Collina",
						"ws (MIT) — Einar Otto Stangvik",
						"better-sqlite3 (MIT) — Joshua Wise",
						"bcryptjs (BSD-3-Clause) — Daniel Wirtz",
						"zod (MIT) — Colin McDonnell",
						"transliteration (MIT)",
						"dotenv (BSD-2-Clause) — motdotla"
					]
				},
				services: {
					title: "External services",
					items: [
						`YouTube Data API + IFrame Player — Google LLC (subject to the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>)`,
						`Google OAuth 2.0 — Google LLC (subject to the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>)`,
						`Cloudflare CDN, Email Routing & Bot Mitigation — Cloudflare, Inc. (subject to the <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare Privacy Policy</a>)`
					]
				}
			},
			ownLicense: `CueVote's own source code is licensed under the <a href="https://polyformproject.org/licenses/noncommercial/1.0.0" target="_blank" rel="noopener noreferrer">PolyForm Noncommercial License 1.0.0</a>.`
		}
};

const nlContent = {
	title: "Transparantie & Vertrouwen",
		subtitle: "Wij geloven in open communicatie. Hier is alles wat u moet weten over hoe wij werken, uw gegevens beschermen en uw rechten respecteren.",
		back: "Terug",
		center: "Juridisch Centrum",
		lastUpdated: "Laatst bijgewerkt",
		tabs: {
			terms: { label: 'Algemene Voorwaarden', desc: "Overeenkomsten & Gebruik" },
			privacy: { label: 'Privacybeleid', desc: "AVG & Gegevens" },
			imprint: { label: 'Colofon', desc: "Bedrijfsinformatie" },
			attributions: { label: 'Attributies', desc: "Software van Derden" },
		},
		disclaimer: "Taalclausule: Deze voorwaarden zijn juridisch bindend in hun Engelse versie. Eventuele vertalingen zijn uitsluitend voor het gemak. In geval van een discrepantie is het Engelse origineel leidend.",
		terms: {
			intro: "Welkom bij CueVote. Deze voorwaarden regelen uw gebruik van ons platform. Door toegang te krijgen tot CueVote, gaat u akkoord met deze voorwaarden en de Servicevoorwaarden van YouTube.",
			sections: [
				{
					title: "1. Dienst & Gebruik",
					content: `CueVote is een sociale interface voor het consumeren van inhoud via API's van derden (voornamelijk YouTube). Wij hosten, bewaren of distribueren geen mediabestanden. De onderliggende broncode is gelicentieerd onder de <a href="https://polyformproject.org/licenses/noncommercial/1.0.0" target="_blank" rel="noopener noreferrer">PolyForm Noncommercial License</a>.<br /><br />De standaarddienst op <a href="https://cuevote.com" target="_blank" rel="noopener noreferrer">cuevote.com</a> is ontworpen voor persoonlijk, privégebruik. Houd er rekening mee dat externe contentproviders hun eigen strikte regels hebben over hoe hun media geconsumeerd mag worden. Wij autoriseren, onderschrijven of verlenen geen licenties voor openbare uitvoering of commercieel gebruik van content van derden.`
				},
				{
					title: "2. Integratie met Platforms van Derden (YouTube)",
					content: `Door CueVote te gebruiken, gaat u uitdrukkelijk akkoord met de <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Servicevoorwaarden</a>. Houd er rekening mee dat de Servicevoorwaarden van YouTube over het algemeen het gebruik van hun dienst voor openbare uitvoering of commercieel gebruik zonder de juiste licenties verbieden.<br /><br />Het is uitsluitend uw verantwoordelijkheid om ervoor te zorgen dat uw specifieke gebruik voldoet aan de YouTube TOS. CueVote biedt slechts de interface en aanvaardt geen aansprakelijkheid voor auteursrechtclaims, API-beperkingen of juridische acties die voortvloeien uit de manier waarop u het platform gebruikt.`
				},
				{
					title: "3. Verantwoordelijkheden van de Gebruiker",
					list: [
						"U moet ten minste 16 jaar oud zijn.",
						"U bent verantwoordelijk voor de veiligheid van uw sessie en account.",
						"U gaat ermee akkoord het platform niet te misbruiken, gebruikers lastig te vallen of te proberen onze code te reverse-engineeren."
					]
				},
				{
					title: "4. Disclaimer & Aansprakelijkheid",
					content: `De dienst wordt geleverd "zoals deze is". CueVote wijst alle garanties af. Voor zover toegestaan door de Nederlandse wet, zijn wij niet aansprakelijk voor enige indirecte schade die voortvloeit uit uw gebruik van de dienst.`
				},
				{
					title: "5. Google Privacybeleid",
					content: `Aangezien wij gebruikmaken van YouTube API Services, erkent u dat door het gebruik van die diensten uw gegevens kunnen worden verwerkt in overeenstemming met het <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacybeleid</a>.`
				},
				{
					title: "6. Toepasselijk Recht",
					content: `Deze voorwaarden worden beheerst door de wetten van <strong>Nederland</strong>. Eventuele geschillen vallen onder de exclusieve bevoegdheid van de rechtbanken in Amsterdam, tenzij dwingende consumentenbeschermingswetten anders voorschrijven.`
				}
			]
		},
		privacy: {
			summary: {
				title: "AVG & Google Gegevens Samenvatting",
				text: "Wij verzamelen minimale gegevens om de app te laten werken en gebruiken de API van YouTube voor inhoud. Wij verkopen uw gegevens niet. Wij respecteren uw privacyrechten onder de Europese wetgeving (AVG/GDPR)."
			},
			sections: [
				{
					title: "1. Wie Wij Zijn",
					content: `Verwerkingsverantwoordelijke:<br />
                            <strong>${legalProfile.entityName}</strong><br />
                            ${legalProfile.addressLines.join('<br />')}<br />
                            Nederland<br />
                            Contact: <a href="mailto:${legalProfile.controllerEmail}">${legalProfile.controllerEmail}</a>`
				},
				{
					title: "2. Gegevensverzameling & Doel",
					intro: "Wij verwerken gegevens voor specifieke, legitieme doeleinden:",
					list: [
						{ title: "Google Accountinformatie", text: "Wanneer u inlogt via Google, verifiëren wij uw identiteit en slaan uw e-mail, naam en avatar-URL op om uw profiel in kamers weer te geven. Bewaartermijn: gegevens worden bewaard totdat u uw account verwijdert; wij voeren geen geautomatiseerde verwijdering uit op basis van inactiviteit. Rechtsgrond: Overeenkomst (Art. 6.1.b AVG)." },
						{ title: "Deelnemen als gast", text: "U kunt zonder account stemmen en nummers voorstellen. Uw browser krijgt dan van onze server een willekeurige gast-ID en bewaart die in de lokale opslag, zodat elke stem één keer telt en na een nieuwe verbinding van u blijft. Anderen in het kanaal zien uw voorstellen als “Gast” met een code van vier tekens die van deze ID is afgeleid. De ID is niet gekoppeld aan uw naam, e-mailadres of Google-account. Als u later inlogt, gaan uw stemmen en voorstellen als gast over naar uw account. Om misbruik te voorkomen telt de server in het werkgeheugen hoeveel nieuwe gast-ID's een IP-adres binnen 10 minuten aanvraagt. Bewaartermijn: de ID blijft in uw browser tot u de sitegegevens wist; op onze server wordt hij alleen samen met de wachtrij van een kanaal opgeslagen tot het nummer is afgespeeld of verwijderd, en in back-ups tot 14 dagen. Rechtsgrond: Overeenkomst (Art. 6.1.b AVG); misbruikpreventie: Gerechtvaardigd Belang (Art. 6.1.f AVG)." },
						{ title: "Gebruiksstatistieken", text: "Wij loggen een geschiedenis van welke video's in welke kamers zijn afgespeeld om aanbevelingen te verbeteren. Stemmen worden samen met de wachtrij van het kanaal opgeslagen, zodat een herstart van de server ze niet verliest, en worden verwijderd zodra het nummer is afgespeeld of verwijderd. Deze gegevens zijn intern voor CueVote. Bewaartermijn: kamergeschiedenis wordt bewaard zolang de bijbehorende kamer bestaat; lege kamers worden automatisch na 7 dagen verwijderd. Rechtsgrond: Gerechtvaardigd Belang (Art. 6.1.f AVG)." },
						{ title: "YouTube API Gegevens", text: "Wanneer u zoekt of nummers afspeelt, sturen wij verzoeken naar de API van YouTube. YouTube kan gegevens verzamelen over uw kijkgedrag via hun embedded speler. Bewaartermijn: gecachte videometadata (titels, thumbnails, duur) wordt na 28 dagen gewist; zoek- en gerelateerde-video-caches worden na 28 dagen verwijderd. Video-ID's kunnen worden bewaard als onderdeel van de kamergeschiedenis. Rechtsgrond: Overeenkomst/Toestemming (via uw gebruik van YouTube)." },
						{ title: "Serverlogs & Beveiliging", text: "Om de stabiliteit en veiligheid van onze dienst te garanderen (bijv. verdediging tegen DDoS-aanvallen), verwerken wij technische verbindingsgegevens (IP-adres en tijdstempel). Deze verbindingsgegevens worden eerst door onze CDN-provider (Cloudflare) verwerkt aan de rand van het netwerk voor beveiligings- en routeringsdoeleinden voordat ze onze servers bereiken. Bewaartermijn: server-toegangslogs (nginx) worden dagelijks geroteerd via standaard Debian logrotate en ongeveer 14 dagen bewaard. Rechtsgrond: Gerechtvaardigd Belang (Art. 6.1.f AVG)." },
						{ title: "Database Back-ups", text: "Wij maken dagelijks geautomatiseerde snapshots van onze database ter bescherming tegen gegevensverlies. Back-ups worden opgeslagen op dezelfde EU-server als de applicatie, en eenmaal per week wordt een versleutelde kopie van de server bij onze hostingprovider opgeslagen in een apart EU-datacenter (Frankrijk). Back-ups bevatten alle hierboven beschreven gegevens (inclusief uw Google-accountinformatie en kamergeschiedenis). Bewaartermijn: dagelijkse snapshots worden automatisch na 7 dagen verwijderd; de wekelijkse kopie wordt elke week vervangen, zodat gegevens die op de server zijn verwijderd binnen 14 dagen uit alle back-ups verdwenen zijn. Rechtsgrond: Gerechtvaardigd Belang (Art. 6.1.f AVG)." }
					]
				},
				{
					title: "3. Derde Verwerkers",
					content: `Wij schakelen vertrouwde derden in om onze infrastructuur te beheren. Wij zorgen ervoor dat zij AVG-compliant zijn.`,
					listSimple: [
						`<strong>Google/YouTube</strong> (Auth & Content API; Gmail-postvak voor e-mail aan ons domein) - VS. <br /><span class="text-sm">E-mail die naar adressen op ons domein wordt verzonden, wordt uiteindelijk bezorgd in een Google (Gmail) postvak, waar wij deze lezen en beantwoorden. Zie <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacybeleid</a>.</span>`,
						`<strong>Cloudflare, Inc.</strong> (CDN, Reverse Proxy, DDoS-bescherming, Web Analytics, Email Routing) - VS. <br /><span class="text-sm">Al het verkeer naar cuevote.com wordt via het wereldwijde netwerk van Cloudflare geleid voor beveiliging, prestaties en privacyvriendelijke analyses. Daarnaast wordt e-mail die naar adressen op ons domein wordt verzonden (bijv. privacy@cuevote.com) ontvangen en door Cloudflare Email Routing doorgestuurd naar onze e-mailprovider (zie hieronder); e-mailinhoud wordt uitsluitend voor bezorgingsdoeleinden verwerkt en niet permanent door Cloudflare opgeslagen. Cloudflare is gecertificeerd onder het EU-US Data Privacy Framework. Zie <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare Privacybeleid</a>.</span>`,
						`<strong>mailbox.org (Heinlein Hosting GmbH)</strong> (E-mailprovider) - Duitsland (EU). <br /><span class="text-sm">E-mail die door Cloudflare Email Routing wordt doorgestuurd, wordt ontvangen door ons mailbox.org-account, dat deze op zijn beurt doorstuurt naar het hierboven genoemde Google (Gmail) postvak. mailbox.org verwerkt de e-mailinhoud uitsluitend om uw bericht te ontvangen, op te slaan en door te sturen. Zie <a href="https://mailbox.org/en/data-protection/" target="_blank" rel="noopener noreferrer">mailbox.org Gegevensbeschermingsverklaring</a>.</span>`,
						`<strong>Hosting Provider</strong> (Server Infrastructuur & zelf-gehoste SQLite-database op dezelfde server, versleutelde wekelijkse back-upkopie in een apart datacenter) - EU.`
					]
				},
				{
					title: "4. Uw Rechten",
					content: `Onder de AVG heeft u de volgende rechten met betrekking tot uw persoonlijke gegevens:
                    <br /><br />
                    <strong>Recht op inzage (Art. 15)</strong> – bevestiging verkrijgen en een kopie van uw persoonlijke gegevens.<br />
                    <strong>Recht op rectificatie (Art. 16)</strong> – onjuiste of onvolledige gegevens corrigeren.<br />
                    <strong>Recht op gegevenswissing / "Recht om vergeten te worden" (Art. 17)</strong> – verzoek tot verwijdering van uw gegevens.<br />
                    <strong>Recht op beperking van de verwerking (Art. 18)</strong> – beperken hoe wij uw gegevens verwerken.<br />
                    <strong>Recht op gegevensoverdraagbaarheid (Art. 20)</strong> – vraag een kopie op van uw gegevens in een gestructureerd, machineleesbaar formaat (handmatig verwerkt op schriftelijk verzoek aan ons contact-e-mailadres).<br />
                    <strong>Recht van bezwaar (Art. 21)</strong> – te allen tijde bezwaar maken tegen verwerking op basis van gerechtvaardigd belang (bijv. gebruiksstatistieken, serverlogs).<br />
                    <strong>Recht om toestemming in te trekken (Art. 7.3)</strong> – elke gegeven toestemming intrekken, zonder afbreuk te doen aan de rechtmatigheid van de verwerking vóór de intrekking.
                    <br /><br />
                    Om deze rechten uit te oefenen, neem contact met ons op via het bovenstaande e-mailadres. U kunt ook onze toegang tot uw Google Gegevens intrekken via de <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">Google Beveiligingsinstellingen</a> pagina.
                    <br /><br />
                    <strong>Recht om een klacht in te dienen (Art. 77):</strong> U heeft het recht om een klacht in te dienen bij een toezichthoudende autoriteit. De bevoegde autoriteit voor CueVote is de Nederlandse toezichthoudende autoriteit – <a href="https://autoriteitpersoonsgegevens.nl" target="_blank" rel="noopener noreferrer">Autoriteit Persoonsgegevens</a>.`
				},
				{
					title: "5. Cookies",
					content: `Wij gebruiken alleen essentiële lokale opslag om uw sessie te onderhouden (bijv. uw login token, of uw gast-ID als u zonder account meedoet). Onze CDN-provider Cloudflare kan het essentiële <code>__cf_bm</code> cookie (30 minuten levensduur) plaatsen voor bot-mitigatiedoeleinden; dit cookie slaat geen persoonlijke gegevens op en wordt geclassificeerd als strikt noodzakelijk. Wij gebruiken geen tracking cookies van derden voor advertenties op ons eigen domein, hoewel embeds van derden (YouTube) hun eigen cookies kunnen plaatsen.`
				},
				{
					title: "6. Beveiligingsmaatregelen",
					content: `In overeenstemming met Art. 32 AVG implementeren wij passende technische en organisatorische maatregelen om uw persoonlijke gegevens te beschermen:
                    <br /><br />
                    <strong>Versleuteling tijdens overdracht:</strong> Al het verkeer wordt aangeboden via HTTPS (TLS) en beëindigd door Cloudflare.<br />
                    <strong>Authenticatie:</strong> Authenticatie wordt uitsluitend afgehandeld via Google OAuth 2.0; wij slaan geen gebruikerswachtwoorden op.<br />
                    <strong>Sessietokens:</strong> Sessies worden beschermd door cryptografisch willekeurige 32-byte tokens.<br />
                    <strong>Kamerwachtwoorden:</strong> Optionele kamerwachtwoorden worden gehasht met bcrypt voordat ze worden opgeslagen.<br />
                    <strong>Database-toegang:</strong> Het databasebestand wordt opgeslagen op een toegewijde EU-server met beperkte bestandssysteemrechten.<br />
                    <strong>Logging:</strong> Gestructureerde serverlogs maskeren gevoelige velden (tokens, e-mails, wachtwoorden) op loggerniveau.<br />
                    <strong>Back-ups:</strong> Dagelijkse database-back-ups blijven op dezelfde server en worden na 7 dagen verwijderd; een versleutelde wekelijkse kopie wordt in een apart EU-datacenter bewaard en elke week vervangen.`
				},
				{
					title: "7. Melding van Datalekken",
					content: `In het geval van een inbreuk in verband met persoonsgegevens die waarschijnlijk een risico inhoudt voor uw rechten en vrijheden, zullen wij de bevoegde toezichthoudende autoriteit (Autoriteit Persoonsgegevens) binnen 72 uur na kennisname van de inbreuk op de hoogte stellen, zoals vereist door Art. 33 AVG. Wanneer de inbreuk waarschijnlijk een <strong>hoog risico</strong> inhoudt voor uw rechten en vrijheden, zullen wij ook getroffen gebruikers zonder onnodige vertraging rechtstreeks informeren (Art. 34 AVG).`
				}
			]
		},
		imprint: {
			operatorHeading: "Beheerder",
			registeredOfficeHeading: "Vestigingsadres",
			managedBy: "Beheerd door",
			abuse: "Misbruik melden",
			country: "Nederland",
			contact: "Contact",
			liability: {
				title: "Aansprakelijkheid voor Inhoud:",
				text: "Hoewel wij streven naar nauwkeurigheid, kunnen wij de volledigheid of juistheid van de informatie op deze website niet garanderen. Wij zijn niet aansprakelijk voor de inhoud van externe links."
			},
			odr: {
				title: "Online Geschillenbeslechting:",
				text: `De Europese Commissie biedt een platform voor ODR op <a href="https://ec.europa.eu/consumers/odr" class="text-neutral-400 underline hover:text-white">ec.europa.eu/consumers/odr</a>. Wij zijn niet verplicht deel te nemen aan geschillenbeslechtingsprocedures.`
			}
		},
		attributions: {
			intro: "CueVote draait op componenten uit het bredere open-source-ecosysteem. Elke component wordt gebruikt onder een permissieve licentie (MIT, ISC, BSD-2-Clause, BSD-3-Clause of Apache-2.0). De volledige, automatisch gegenereerde lijst — met versies, licentieteksten, auteursrechthouders en bron-URLs — wordt bijgehouden in het NOTICES-bestand in onze repository.",
			noticesLinkLabel: "Volledige attributies bekijken",
			noticesUrl: "https://github.com/zienert/cuevote/blob/main/NOTICES.md",
			highlights: {
				title: "Belangrijke componenten",
				frontend: {
					title: "Frontend",
					items: [
						"React & React DOM (MIT) — Meta Platforms, Inc.",
						"react-router-dom (MIT) — Remix Software",
						"@react-oauth/google (MIT) — Mo'men Sherif",
						"lucide-react (ISC) — Eric Fennis e.a.",
						"qrcode.react (ISC) — Paul O'Shannessy",
						"jwt-decode (MIT) — Auth0"
					]
				},
				backend: {
					title: "Backend",
					items: [
						"pino (MIT) — Matteo Collina",
						"ws (MIT) — Einar Otto Stangvik",
						"better-sqlite3 (MIT) — Joshua Wise",
						"bcryptjs (BSD-3-Clause) — Daniel Wirtz",
						"zod (MIT) — Colin McDonnell",
						"transliteration (MIT)",
						"dotenv (BSD-2-Clause) — motdotla"
					]
				},
				services: {
					title: "Externe diensten",
					items: [
						`YouTube Data API + IFrame Player — Google LLC (valt onder de <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Servicevoorwaarden</a>)`,
						`Google OAuth 2.0 — Google LLC (valt onder het <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacybeleid</a>)`,
						`Cloudflare CDN, Email Routing & Bot Mitigation — Cloudflare, Inc. (valt onder het <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare Privacybeleid</a>)`
					]
				}
			},
			ownLicense: `De broncode van CueVote zelf is gelicentieerd onder de <a href="https://polyformproject.org/licenses/noncommercial/1.0.0" target="_blank" rel="noopener noreferrer">PolyForm Noncommercial License 1.0.0</a>.`
		}
};

// --- Language Variants ---
// Coverage tiers:
//   - Fully localised legal text: en, nl
//   - UI chrome translated (title/back/center/lastUpdated/disclaimer); terms,
//     privacy and imprint remain in English by design — the English version is
//     the legally binding one (see `disclaimer` field):
//     de, fr, es, it, pt, zh-CN, zh-TW, ja, ko
//   - All other UI languages fall back to English here. LegalPage.jsx handles
//     this via `legalContent[language] ?? legalContent.en`. To upgrade a
//     language to tier-2, add it below with withEnglishContent({...}).
// Single export: no mutation of LEGAL_CONTENT, so no TDZ when bundler evaluates modules.

export const LEGAL_CONTENT = {
	en: enContent,
	nl: nlContent,
	de: withEnglishContent(enContent, {
		title: "Transparenz & Vertrauen",
		subtitle: "Wir glauben an offene Kommunikation. Hier finden Sie alles, was Sie darüber wissen müssen, wie wir arbeiten, Ihre Daten schützen und Ihre Rechte respektieren.",
		back: "Zurück",
		center: "Rechtszentrum",
		lastUpdated: "Zuletzt aktualisiert",
		disclaimer: "Hinweis: Diese Bedingungen sind nur in englischer Sprache verfügbar. Die englische Version ist allein rechtlich bindend."
	}),
	fr: withEnglishContent(enContent, {
		title: "Transparence & Confiance",
		subtitle: "Nous croyons en une communication ouverte. Voici tout ce que vous devez savoir sur notre fonctionnement, la protection de vos données et le respect de vos droits.",
		back: "Retour",
		center: "Centre Juridique",
		lastUpdated: "Dernière mise à jour",
		disclaimer: "Note : Ces conditions sont uniquement disponibles en anglais. La version anglaise est la seule juridiquement contraignante."
	}),
	es: withEnglishContent(enContent, {
		title: "Transparencia y Confianza",
		subtitle: "Creemos en la comunicación abierta. Aquí tienes todo lo que necesitas saber sobre cómo operamos, protegemos tus datos y respetamos tus derechos.",
		back: "Atrás",
		center: "Centro Legal",
		lastUpdated: "Última actualización",
		disclaimer: "Nota: Estos términos solo están disponibles en inglés. La versión en inglés es la única legalmente vinculante."
	}),
	it: withEnglishContent(enContent, {
		title: "Trasparenza e Fiducia",
		subtitle: "Crediamo nella comunicazione aperta. Ecco tutto ciò che devi sapere su come operiamo, proteggiamo i tuoi dati e rispettiamo i tuoi diritti.",
		back: "Indietro",
		center: "Centro Legale",
		lastUpdated: "Ultimo aggiornamento",
		disclaimer: "Nota: Questi termini sono disponibili solo in inglese. La versione inglese è l'unica giuridicamente vincolante."
	}),
	pt: withEnglishContent(enContent, {
		title: "Transparência e Confiança",
		subtitle: "Acreditamos na comunicação aberta. Aqui está tudo o que você precisa saber sobre como operamos, protegemos seus dados e respeitamos seus direitos.",
		back: "Voltar",
		center: "Centro Legal",
		lastUpdated: "Última atualização",
		disclaimer: "Nota: Estes termos estão disponíveis apenas em inglês. A versão em inglês é a única legalmente vinculativa."
	}),
	'zh-CN': withEnglishContent(enContent, {
		title: "透明度与信任",
		subtitle: "我们相信开放的沟通。这里有您需要了解的关于我们要如何运作、保护您的数据以及尊重您的权利的所有信息。",
		back: "返回",
		center: "法律中心",
		lastUpdated: "最后更新",
		disclaimer: "注意：这些条款仅提供英文版本。英文版本具有唯一法律约束力。"
	}),
	'zh-TW': withEnglishContent(enContent, {
		title: "透明度與信任",
		subtitle: "我們相信開放的溝通。這裡有您需要了解的關於我們要如何運作、保護您的數據以及尊重您的權利的所有信息。",
		back: "返回",
		center: "法律中心",
		lastUpdated: "最後更新",
		disclaimer: "注意：這些條款僅提供英文版本。英文版本具有唯一法律約束力。"
	}),
	ja: withEnglishContent(enContent, {
		title: "透明性と信頼",
		subtitle: "私たちはオープンなコミュニケーションを信じています。私たちがどのように運営し、データを保護し、権利を尊重しているかについて知っておくべきすべての情報がここにあります。",
		back: "戻る",
		center: "法務センター",
		lastUpdated: "最終更新",
		disclaimer: "注：これらの条件は英語でのみ利用可能です。英語版のみが法的拘束力を持ちます。"
	}),
	ko: withEnglishContent(enContent, {
		title: "투명성 및 신뢰",
		subtitle: "우리는 열린 소통을 믿습니다. 우리가 운영하는 방식, 데이터를 보호하는 방식, 그리고 귀하의 권리를 존중하는 방식에 대해 알아야 할 모든 것이 여기에 있습니다.",
		back: "뒤로",
		center: "법률 센터",
		lastUpdated: "마지막 업데이트",
		disclaimer: "참고: 이 약관은 영어로만 제공됩니다. 영어 버전만이 법적 구속력이 있습니다."
	})
};
