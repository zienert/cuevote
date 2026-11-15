// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// Design proposal B ("Neu"), DEV previews only: the small parts every page
// of the draft is made of.
import React, { useState } from 'react';
import PropTypes from 'prop-types';
import clsx from 'clsx';
import { cva } from 'class-variance-authority';
import { Dialog } from '@base-ui/react/dialog';
import { Tabs } from '@base-ui/react/tabs';
import { Drawer } from 'vaul';
import { Toaster } from 'sonner';
import { Music2, X } from 'lucide-react';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Language } from '../contexts/LanguageContext';
import { GoogleAuthButton } from '../components/GoogleAuthButton';
import { GoogleGIcon } from '../components/GoogleGIcon';
import { Avatar } from '../components/Avatar';
import { displayName, isSignedIn } from '../utils/participation';
import { useCopy } from './copy';

// One shape for every button: a pill that gives way a little when pressed.
// primary: the one action of a view (the draft's only gradient). accent and
// ink: a choice that is on. quiet: everything else.
const button = cva(
	'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background-color,color,opacity,transform] duration-150 ease-cv active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
	{
		variants: {
			kind: {
				primary: 'b-glow',
				accent: 'bg-accent text-accent-ink',
				ink: 'bg-ink text-page',
				quiet: 'bg-card text-ink hover:bg-raised',
				ghost: 'text-ink-2 hover:bg-card hover:text-ink',
				danger: 'bg-card text-[#b42318] hover:bg-raised',
			},
			size: {
				sm: 'cv-hit h-9 px-4 text-[0.9375rem]',
				md: 'h-11 px-5 text-[1.0625rem]',
				lg: 'h-14 px-7 text-[1.1875rem]',
			},
			wide: { true: 'w-full' },
		},
		defaultVariants: { kind: 'quiet', size: 'md' },
	},
);

export function Button({ kind, size, wide, className, type = 'button', ...rest }) {
	return <button type={type} {...rest} className={clsx(button({ kind, size, wide }), className)} />;
}

Button.propTypes = {
	kind: PropTypes.oneOf(['primary', 'accent', 'ink', 'quiet', 'ghost', 'danger']),
	size: PropTypes.oneOf(['sm', 'md', 'lg']),
	wide: PropTypes.bool,
	className: PropTypes.string,
	type: PropTypes.string,
};

/** A round button that is only an icon: 44 px, and it says what it does. */
export function IconButton({ label, className, children, ...rest }) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			{...rest}
			className={clsx('flex h-11 w-11 flex-none items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-150 ease-cv hover:bg-card active:scale-90', className)}
		>
			{children}
		</button>
	);
}

IconButton.propTypes = { label: PropTypes.string.isRequired, className: PropTypes.string, children: PropTypes.node };

/**
 * Cover art. A note stands in when there is none, when it may not be loaded
 * (no consent for the service it comes from) or when it fails to load.
 */
export function Cover({ src, allowed = true, size = 'h-12 w-12', radius = 'rounded-xl', className }) {
	const [failed, setFailed] = useState(null);
	if (src && allowed && failed !== src) {
		return (
			<img
				src={src}
				alt=""
				draggable="false"
				loading="lazy"
				referrerPolicy="no-referrer"
				onError={() => setFailed(src)}
				className={clsx(size, radius, 'flex-none bg-card object-cover', className)}
			/>
		);
	}
	return (
		<span aria-hidden="true" className={clsx(size, radius, 'flex flex-none items-center justify-center bg-card text-ink-3', className)}>
			<Music2 size="42%" />
		</span>
	);
}

Cover.propTypes = { src: PropTypes.string, allowed: PropTypes.bool, size: PropTypes.string, radius: PropTypes.string, className: PropTypes.string };

export function Wordmark({ className }) {
	return <span className={clsx('b-display text-accent', className)}>CueVote</span>;
}

Wordmark.propTypes = { className: PropTypes.string };

/**
 * Something that opens over the page: on a phone a sheet from the bottom edge
 * that can be dragged away by its grabber, on a larger screen a dialog in the
 * middle. One at a time; Escape, the backdrop and the close button leave it.
 */
export function Sheet({ open, onOpenChange, title, description, children }) {
	const c = useCopy();
	const roomy = useMediaQuery('(min-width: 640px)');

	if (roomy) {
		return (
			<Dialog.Root open={open} onOpenChange={onOpenChange}>
				<Dialog.Portal>
					<Dialog.Backdrop className="fixed inset-0 z-[200] bg-ink/40 transition-opacity duration-200 ease-cv data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
					<Dialog.Popup className="b-root fixed left-1/2 top-1/2 z-[201] max-h-[calc(100dvh-4rem)] w-[min(28rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-[1.75rem] bg-page p-7 shadow-[0_24px_60px_-12px_rgba(21,21,26,0.35)] outline-none transition-[opacity,transform] duration-200 ease-cv data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
						<Dialog.Title className="b-display pr-10 text-[2rem] text-ink">{title}</Dialog.Title>
						{description ? <Dialog.Description className="mt-2 text-ink-2">{description}</Dialog.Description> : null}
						<div className="mt-5">{children}</div>
						<Dialog.Close
							aria-label={c('close')}
							className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-[background-color,color,transform] duration-150 ease-cv hover:bg-card hover:text-ink active:scale-90"
						>
							<X size={22} />
						</Dialog.Close>
					</Dialog.Popup>
				</Dialog.Portal>
			</Dialog.Root>
		);
	}

	return (
		<Drawer.Root open={open} onOpenChange={onOpenChange}>
			<Drawer.Portal>
				<Drawer.Overlay className="fixed inset-0 z-[200] bg-ink/40" />
				<Drawer.Content className="b-root fixed inset-x-0 bottom-0 z-[201] flex max-h-[92dvh] flex-col rounded-t-[1.75rem] bg-page outline-none">
					<Drawer.Handle className="mt-3 flex-none" />
					<div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
						<Drawer.Title className="b-display text-[2rem] text-ink">{title}</Drawer.Title>
						{description ? <Drawer.Description className="mt-2 text-ink-2">{description}</Drawer.Description> : null}
						<div className="mt-4">{children}</div>
					</div>
				</Drawer.Content>
			</Drawer.Portal>
		</Drawer.Root>
	);
}

Sheet.propTypes = {
	open: PropTypes.bool.isRequired,
	onOpenChange: PropTypes.func.isRequired,
	title: PropTypes.node.isRequired,
	description: PropTypes.node,
	children: PropTypes.node,
};

/**
 * One choice out of a few as a single control: the thumb slides to the
 * choice, the content it switches changes at once.
 */
export function Segmented({ label, value, onChange, options, className }) {
	return (
		<Tabs.Root value={value} onValueChange={onChange} className={className}>
			<Tabs.List aria-label={label} className="relative z-0 grid auto-cols-fr grid-flow-col rounded-full bg-card p-1">
				{options.map((option) => (
					<Tabs.Tab
						key={option.value}
						value={option.value}
						className="cv-hit relative z-10 flex h-9 min-w-0 items-center justify-center whitespace-nowrap rounded-full px-2 text-[0.9375rem] sm:px-4 font-semibold text-ink-2 outline-none transition-colors duration-150 hover:text-ink data-[active]:text-ink"
					>
						<span className="truncate">{option.label}</span>
						{option.count === undefined ? null : <span className="ml-1.5 font-medium tabular-nums text-ink-3">{option.count}</span>}
					</Tabs.Tab>
				))}
				<Tabs.Indicator className="absolute left-0 top-1 z-0 h-9 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] rounded-full bg-page shadow-[0_1px_3px_rgba(21,21,26,0.14)] transition-[transform,width] duration-[250ms] ease-cv-drawer motion-reduce:transition-none" />
			</Tabs.List>
		</Tabs.Root>
	);
}

Segmented.propTypes = {
	label: PropTypes.string.isRequired,
	value: PropTypes.string.isRequired,
	onChange: PropTypes.func.isRequired,
	// `count`: a quiet number after the label (how many titles are waiting).
	options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string.isRequired, label: PropTypes.string.isRequired, count: PropTypes.number })).isRequired,
	className: PropTypes.string,
};

/**
 * The place for short confirmations ("Added", "Link copied"). `lift`: how far
 * above the bottom edge on a phone, so a message clears the room's bar.
 */
export function Toasts({ lift = 16 }) {
	return (
		<Toaster
			position="bottom-center"
			theme="light"
			offset={24}
			mobileOffset={{ bottom: lift, left: 16, right: 16 }}
			toastOptions={{ style: { borderRadius: '1.125rem', fontSize: '1rem', fontFamily: 'var(--b-text)', color: 'rgb(21 21 26)' } }}
		/>
	);
}

Toasts.propTypes = { lift: PropTypes.number };

/** Who is using this device: their picture, or the way to sign in. */
export function Account({ user, onLoginSuccess, onOpen, withLabel = false }) {
	const { t } = Language.useLanguage();
	if (isSignedIn(user)) {
		return (
			<button
				type="button"
				onClick={onOpen}
				aria-label={t('header.profileSettings')}
				title={t('header.profileSettings')}
				className="flex h-11 w-11 flex-none items-center justify-center rounded-full transition-transform duration-150 ease-cv active:scale-90"
			>
				<Avatar picture={user.picture} name={displayName(user, t)} className="h-9 w-9" textClassName="text-[0.9375rem]" />
			</button>
		);
	}
	return (
		<GoogleAuthButton
			onLoginSuccess={onLoginSuccess}
			render={(performLogin, disabled) => (
				<button
					type="button"
					onClick={() => performLogin()}
					title={disabled ? t('header.acceptCookies') : t('header.signIn')}
					aria-label={t('header.signIn')}
					className={clsx(
						'flex h-11 flex-none items-center justify-center gap-2 rounded-full bg-card font-semibold text-ink transition-[background-color,transform] duration-150 ease-cv hover:bg-raised active:scale-95',
						withLabel ? 'px-4 text-[0.9375rem]' : 'w-11',
					)}
				>
					<GoogleGIcon className="h-[1.125rem] w-[1.125rem]" />
					{withLabel ? <span>{t('header.signIn')}</span> : null}
				</button>
			)}
		/>
	);
}

Account.propTypes = { user: PropTypes.object, onLoginSuccess: PropTypes.func, onOpen: PropTypes.func, withLabel: PropTypes.bool };
