// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState } from "react";
import PropTypes from "prop-types";

/**
 * The app's one sign for "waiting": an orange arc on a dark ring.
 *
 * Every ring turns in step with the page's clock. One that takes the place of
 * another (the first paint, then the page loading, then connecting) carries
 * on where the last one was instead of starting over.
 */
export function Spinner({ className = "h-7 w-7" }) {
	const [delay] = useState(() => -(performance.now() % 1000));
	return (
		<span
			aria-hidden="true"
			className={`block shrink-0 animate-spin rounded-full border-2 border-white/15 border-t-orange-500 ${className}`}
			style={{ animationDelay: `${delay}ms` }}
		/>
	);
}

Spinner.propTypes = {
	className: PropTypes.string,
};

/**
 * A whole screen that waits, with the ring in its middle. No words: it also
 * stands in before any translation has loaded.
 */
export function SpinnerScreen() {
	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#050505]" role="status" aria-label="Loading">
			<Spinner className="h-10 w-10" />
		</div>
	);
}
