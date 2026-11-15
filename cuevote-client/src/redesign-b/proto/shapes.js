// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY prototype (/__prototype): the shape of the example room.
import PropTypes from 'prop-types';

export const trackShape = PropTypes.shape({
	id: PropTypes.string.isRequired,
	title: PropTypes.string.isRequired,
	artist: PropTypes.string,
	score: PropTypes.number.isRequired,
	mine: PropTypes.string,
	cover: PropTypes.string,
	by: PropTypes.string,
});

export const roomShape = PropTypes.shape({
	tracks: PropTypes.arrayOf(trackShape).isRequired,
	vote: PropTypes.func.isRequired,
	add: PropTypes.func.isRequired,
});
