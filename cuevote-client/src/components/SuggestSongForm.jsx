// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useCallback, useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { CheckCircle, Send, Clock } from "lucide-react";
import { Language } from '../contexts/LanguageContext';
export function SuggestSongForm({ onSongSuggested, onShowSuggest, serverError, serverMessage, isOwner, suggestionsEnabled, isConnected = true }) {
  const [songSuggestion, setSongSuggestion] = useState("");
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [isSubmittingSuggestion, setIsSubmittingSuggestion] = useState(false);
  const { t } = Language.useLanguage();


  // Clear local error when user types
  const handleInputChange = (e) => {
    setSongSuggestion(e.target.value);
    if (suggestionError) setSuggestionError("");
    if (infoMessage) setInfoMessage("");
  };

  // Reset state if connection drops
  useEffect(() => {
    if (!isConnected && isSubmittingSuggestion) {
      setIsSubmittingSuggestion(false);
      setSuggestionError(t('app.noInternet'));
    }
  }, [isConnected, isSubmittingSuggestion, t]);

  // Safety Timeout to prevent hanging. Longer than the server may take: Apple's
  // catalog gets up to 8 s per request, and a link from another country takes
  // two (apple-catalog.js); at 5 s the form gave up before the server's own,
  // translated answer arrived.
  useEffect(() => {
    let timeout;
    if (isSubmittingSuggestion) {
      timeout = setTimeout(() => {
        setIsSubmittingSuggestion(false);
        setSuggestionError(t('app.takingTooLong'));
      }, 20000);
    }
    return () => clearTimeout(timeout);
  }, [isSubmittingSuggestion, t]);

  const handleSubmitSuggestion = useCallback(async () => {
    if (!isConnected) {
      setSuggestionError(t('app.noInternet'));
      return;
    }

    const input = songSuggestion.trim();

    if (!input) {
      setSuggestionError(t('suggest.error'));
      return;
    }

    setSuggestionError("");
    setInfoMessage("");
    setIsSubmittingSuggestion(true);

    // Delegate everything to server (Validation, Search, Metadata)
    onSongSuggested(input);

    // Optimistic Success REMOVED.
    // We now rely entirely on server messages ("success" or "info" or "error")
    // to drive the UI state. This ensures we don't auto-close on errors (duplicates etc).


  }, [songSuggestion, onSongSuggested, isConnected, t]);

  const handleKeyPress = useCallback(
    (event) => {
      if (event.key === "Enter") {
        handleSubmitSuggestion();
      }
    },
    [handleSubmitSuggestion],
  );

  // Track processed messages to avoid reacting to stale state on remount
  const processedMessageRef = useRef(serverMessage);

  // Handle Server Messages (Error or Info)
  useEffect(() => {
    // Skip if we've already processed this exact message object (or it's the specific stale one from mount)
    if (serverMessage === processedMessageRef.current) {
      return;
    }
    // Mark as processed
    processedMessageRef.current = serverMessage;

    if (serverError) {
      setSubmissionSuccess(false);
      setIsSubmittingSuggestion(false); // Stop spinning/disabled
    }

    if (serverMessage && serverMessage.type === "info") {
      // It's a non-error message (e.g. "Suggestion submitted for review")
      setInfoMessage(serverMessage.message);
      setSubmissionSuccess(true); // Treat as success state strictly for UI green check
      setSongSuggestion(""); // Clear input if not already
      setIsSubmittingSuggestion(false);

      // Clear after delay
      setTimeout(() => {
        setSubmissionSuccess(false);
        setInfoMessage("");
        onShowSuggest(false); // Auto-minimize fast
      }, 1500);
    }

    if (serverMessage && serverMessage.type === "success") {
      // Direct success (e.g. Auto-Approved) - Show Green Check (no info message implies Green)
      setInfoMessage(""); // Ensure no info message triggers Blue state
      setSubmissionSuccess(true);
      setSongSuggestion("");
      setIsSubmittingSuggestion(false);

      setTimeout(() => {
        setSubmissionSuccess(false);
        onShowSuggest(false); // Auto-minimize fast
      }, 1500);
    }
  }, [serverError, serverMessage, onShowSuggest]);

  const activeError = suggestionError || serverError;

  return (
    <div className="keep-open w-full max-w-5xl mx-auto mt-3 animate-fadeIn space-y-2">
      <div className="keep-open flex items-center gap-2">
        <input
          type="text"
          value={songSuggestion}
          onChange={handleInputChange}
          onKeyDown={handleKeyPress}

          placeholder={!suggestionsEnabled && !isOwner ? t('suggest.disabledPlaceholder') : t('suggest.placeholder')}
          disabled={isSubmittingSuggestion || (!suggestionsEnabled && !isOwner)}
          className="keep-open flex-1 px-5 py-2 rounded-full bg-[#121212] text-white border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-orange-500 text-base disabled:opacity-60 disabled:cursor-not-allowed"
        />              <button
          onClick={(event) => {
            event.stopPropagation();
            handleSubmitSuggestion();
          }}
          disabled={isSubmittingSuggestion || (!suggestionsEnabled && !isOwner)}
          className={`keep-open px-5 py-2 rounded-full text-white transition-all flex items-center gap-2 text-base disabled:cursor-not-allowed disabled:opacity-70 whitespace-nowrap ${submissionSuccess
            ? (infoMessage ? "bg-blue-600 hover:bg-blue-500" : "bg-green-600 hover:bg-green-500")
            : "bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500"
            }`}
        >
          {submissionSuccess ? (
            <>
              {infoMessage ? <Clock size={18} /> : <CheckCircle size={18} />}
              {infoMessage || t('suggest.added')}
            </>
          ) : (
            <>
              <Send size={18} /> {isSubmittingSuggestion ? t('suggest.adding') : t('suggest.submit')}
            </>
          )}
        </button>
      </div>
      {
        activeError && (
          <p className="keep-open text-sm text-red-400">{activeError}</p>
        )
      }

    </div >
  );
}
SuggestSongForm.propTypes = {
  onSongSuggested: PropTypes.func.isRequired,
  onShowSuggest: PropTypes.func.isRequired,
  serverError: PropTypes.string,
  serverMessage: PropTypes.object,
  isOwner: PropTypes.bool,
  suggestionsEnabled: PropTypes.bool,
  suggestionMode: PropTypes.string,
  isConnected: PropTypes.bool
};
