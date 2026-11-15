// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import PropTypes from "prop-types";

// One observer for every cover that waits for its picture. A long playlist
// loads its pictures as they come near the screen; the light runs only for
// the placeholders that are on it, not for a hundred rows further down.
const onScreenCallbacks = new WeakMap();
let onScreenObserver = null;
function watchOnScreen(element, callback) {
	if (typeof IntersectionObserver === "undefined") {
		callback(true);
		return () => {};
	}
	if (!onScreenObserver) {
		onScreenObserver = new IntersectionObserver((entries) => {
			for (const entry of entries) onScreenCallbacks.get(entry.target)?.(entry.isIntersecting);
		});
	}
	onScreenCallbacks.set(element, callback);
	onScreenObserver.observe(element);
	return () => {
		onScreenCallbacks.delete(element);
		onScreenObserver.unobserve(element);
	};
}

/**
 * A cover or thumbnail, which takes a moment longer than the text next to it.
 * Until the picture is there its place shows the light of the loading
 * placeholders (`.skeleton` in index.css), then the picture fades in. A
 * picture the browser already has shows at once. One that cannot be loaded
 * leaves a plain, still box: nothing keeps lighting up for a picture that
 * will not come.
 *
 * `className` sizes and shapes the box, `imgClassName` goes to the picture.
 * `fallbackSrc` is tried once when `src` fails.
 */
export function CoverImage({ src, fallbackSrc, alt = "", className = "", imgClassName = "", loading }) {
	// What happened, and for which picture: a row can be handed another one.
	const [seen, setSeen] = useState({ src, url: src, phase: "loading" });
	const now = seen.src === src ? seen : { src, url: src, phase: "loading" };
	const image = useRef(null);
	const box = useRef(null);
	const [onScreen, setOnScreen] = useState(false);

	// Already there (from the cache): no placeholder and no fade.
	useLayoutEffect(() => {
		const element = image.current;
		if (now.phase === "loading" && element && element.complete && element.naturalWidth > 0) {
			setSeen({ src, url: now.url, phase: "instant" });
		}
	}, [src, now.url, now.phase]);

	const onLoad = () => {
		if (now.phase === "loading") setSeen({ ...now, phase: "loaded" });
	};
	const onError = () => {
		if (fallbackSrc && now.url !== fallbackSrc) setSeen({ src, url: fallbackSrc, phase: "loading" });
		else setSeen({ ...now, phase: "failed" });
	};

	const waiting = now.phase === "loading";
	const failed = now.phase === "failed";

	useEffect(() => {
		if (!waiting || !box.current) return undefined;
		return watchOnScreen(box.current, setOnScreen);
	}, [waiting]);

	return (
		<div
			ref={box}
			className={`relative overflow-hidden ${waiting || failed ? "bg-neutral-800" : ""} ${waiting && onScreen ? "skeleton" : ""} ${className}`}
		>
			{!failed && (
				<img
					ref={image}
					src={now.url}
					alt={alt}
					loading={loading}
					onLoad={onLoad}
					onError={onError}
					className={`block h-full w-full object-cover ${waiting ? "opacity-0" : ""} ${now.phase === "loaded" ? "cover-in" : ""} ${imgClassName}`}
				/>
			)}
		</div>
	);
}

CoverImage.propTypes = {
	src: PropTypes.string.isRequired,
	fallbackSrc: PropTypes.string,
	alt: PropTypes.string,
	className: PropTypes.string,
	imgClassName: PropTypes.string,
	loading: PropTypes.oneOf(["lazy", "eager"]),
};
