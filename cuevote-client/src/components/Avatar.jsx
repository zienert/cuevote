// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { initialOf } from '../utils/participation';

/**
 * A person's picture in a circle. Without a picture, or when it fails to
 * load, the first letter of the name stands in. The name itself is said by
 * whatever the avatar sits in (a button's label, the line next to it), so the
 * picture has no alternative text of its own.
 */
export function Avatar({ picture, name, className = '', textClassName = 'text-xs' }) {
	const [failed, setFailed] = useState(null);

	if (picture && failed !== picture) {
		return (
			<img
				src={picture}
				alt=""
				referrerPolicy="no-referrer"
				onError={() => setFailed(picture)}
				className={`flex-none rounded-full border border-line object-cover ${className}`}
			/>
		);
	}
	return (
		<div aria-hidden="true" className={`flex flex-none items-center justify-center rounded-full border border-line bg-raised font-semibold text-ink-2 ${textClassName} ${className}`}>
			{initialOf(name)}
		</div>
	);
}

Avatar.propTypes = {
	picture: PropTypes.string,
	name: PropTypes.string,
	className: PropTypes.string,
	textClassName: PropTypes.string,
};
