// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from "react";
import PropTypes from "prop-types";

/**
 * Skeleton — a neutral placeholder bar with the light of everything that is
 * still loading (`.skeleton` in index.css).
 *
 * Used while a value (e.g. a track title that was cleared after YouTube's
 * 28-day metadata retention limit) is being re-fetched fresh on join.
 * Language-neutral by design: it signals "loading" without any text, so it
 * never renders a stale value or the literal string "null".
 */
export function Skeleton({ className = "" }) {
  // Only apply the default tint when the caller hasn't supplied a bg-* class,
  // so an override (e.g. a green tint on the preview bar) wins reliably
  // regardless of Tailwind's class-ordering in the compiled stylesheet.
  const hasBg = /(^|\s)bg-/.test(className);
  return (
    <div
      className={`skeleton rounded ${hasBg ? "" : "bg-neutral-700/50"} ${className}`}
      aria-hidden="true"
    />
  );
}

Skeleton.propTypes = {
  className: PropTypes.string,
};
