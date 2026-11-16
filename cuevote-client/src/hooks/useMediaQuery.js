// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import { useEffect, useState } from 'react';

/** Whether a CSS media query matches, following changes (rotation, resizing). */
export function useMediaQuery(query) {
	const [matches, setMatches] = useState(
		() => typeof window !== 'undefined' && window.matchMedia(query).matches
	);

	useEffect(() => {
		const list = window.matchMedia(query);
		const update = () => setMatches(list.matches);
		update();
		list.addEventListener('change', update);
		return () => list.removeEventListener('change', update);
	}, [query]);

	return matches;
}
