// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import PropTypes from 'prop-types';

// Movement on screen: inside the 300 ms budget, with the curve for things that
// change place (--ease-in-out in index.css).
const DURATION_MS = 280;
const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
const NAME = 'cv-reorder';

// Where every row is on screen right now, a move in flight included.
function screenTops(list) {
	const tops = new Map();
	for (const row of list.querySelectorAll('[data-reorder-id]')) {
		tops.set(row.dataset.reorderId, row.getBoundingClientRect().top);
	}
	return tops;
}

/**
 * A list whose rows glide to their new places when the order changes: when
 * votes move a title, its row travels there instead of jumping, and the rows
 * it passes make room at the same time. Rows close the gap the same way when
 * one leaves.
 *
 * Every child marked `data-reorder-id` takes part; it has to be positioned
 * (`relative`). `order` is the ids in their current order, joined into a
 * string. A row that is still on its way when the order changes again starts
 * from where it is on screen. With reduced motion the rows change places at
 * once and the moved ones fade in briefly.
 *
 * A class, because only getSnapshotBeforeUpdate sees the page right before
 * React changes it: positions kept from the last render go stale as soon as
 * the list is scrolled or a row opens.
 */
export class ReorderList extends React.Component {
	list = React.createRef();

	getSnapshotBeforeUpdate(previous) {
		const list = this.list.current;
		if (!list || previous.order === this.props.order) return null;
		return screenTops(list);
	}

	componentDidUpdate(_previous, _state, before) {
		const list = this.list.current;
		if (!before || !list) return;
		const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const screen = window.innerHeight;

		for (const row of list.querySelectorAll('[data-reorder-id]')) {
			const was = before.get(row.dataset.reorderId);
			if (was === undefined || !row.animate) continue;

			row.getAnimations().forEach((animation) => { if (animation.id === NAME) animation.cancel(); });
			row.style.zIndex = '';
			const now = row.getBoundingClientRect();
			const from = was - now.top;
			if (Math.abs(from) < 1) continue;
			// Nothing to see: above or below the screen before and after.
			if ((was + now.height < 0 && now.bottom < 0) || (was > screen && now.top > screen)) continue;

			let move;
			if (still) {
				move = row.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
			} else {
				// The row that climbs passes above the ones it overtakes.
				row.style.zIndex = from > 0 ? '2' : '1';
				move = row.animate(
					[{ transform: `translateY(${from}px)` }, { transform: 'translateY(0)' }],
					{ duration: DURATION_MS, easing: EASE_IN_OUT },
				);
				move.onfinish = () => { row.style.zIndex = ''; };
			}
			move.id = NAME;
		}
	}

	render() {
		// The browser may not hold on to one of these rows while it scrolls
		// (scroll anchoring): it would scroll the list along with a row that
		// changes place, and the rows would glide from the wrong spot.
		return (
			<div ref={this.list} className={`[overflow-anchor:none] ${this.props.className || ''}`}>
				{this.props.children}
			</div>
		);
	}
}

ReorderList.propTypes = {
	order: PropTypes.string.isRequired,
	className: PropTypes.string,
	children: PropTypes.node,
};
