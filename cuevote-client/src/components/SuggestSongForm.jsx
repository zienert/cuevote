// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useCallback, useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { CheckCircle, Send, Clock } from "lucide-react";
import { Language } from '../contexts/LanguageContext';
import { useLatestRef } from '../hooks/useLatestRef';

// `docked`: the form as the room's bar at the bottom of a phone. It is always
// there, one row with a round send button, and under it it shows only the
// server's answer to its own entry: a refused vote is the room's notice, not
// this field's.
export function SuggestSongForm({ onSongSuggested, onShowSuggest, serverError, serverMessage, isOwner, suggestionsEnabled, isConnected = true, isAppleRoom = false, docked = false }) {
  const [songSuggestion, setSongSuggestion] = useState("");
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");
  const [answerError, setAnswerError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [isSubmittingSuggestion, setIsSubmittingSuggestion] = useState(false);
  const isSubmittingRef = useLatestRef(isSubmittingSuggestion);
  const { t } = Language.useLanguage();


  // Clear local error when user types
  const handleInputChange = (e) => {
    setSongSuggestion(e.target.value);
    if (suggestionError) setSuggestionError("");
    if (answerError) setAnswerError("");
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
      // What to enter depends on the channel's music source. An Apple Music
      // channel answers with the words the server uses for a wrong entry.
      setSuggestionError(isAppleRoom ? t('errors.appleMusicRoom') : t('suggest.error'));
      return;
    }

    setSuggestionError("");
    setAnswerError("");
    setInfoMessage("");
    setIsSubmittingSuggestion(true);

    // Delegate everything to server (Validation, Search, Metadata). The room
    // answers false when it did not send the entry (it says why itself): then
    // no answer will come.
    if (onSongSuggested(input) === false) {
      setIsSubmittingSuggestion(false);
    }

    // Optimistic Success REMOVED.
    // We now rely entirely on server messages ("success" or "info" or "error")
    // to drive the UI state. This ensures we don't auto-close on errors (duplicates etc).


  }, [songSuggestion, onSongSuggested, isConnected, isAppleRoom, t]);

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

    // Docked: an error that arrives while an entry is on its way answers it.
    if (serverMessage?.type === "error" && isSubmittingRef.current) {
      setAnswerError(serverError || serverMessage.message || "");
    }

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
  }, [serverError, serverMessage, onShowSuggest, isSubmittingRef]);

  // Docked, the bar never opens or closes. "Open" then means: an entry is on
  // its way or its answer is showing, and the room holds back its own notices
  // for that long, as it does while the desktop bar is open.
  useEffect(() => {
    if (docked) onShowSuggest(isSubmittingSuggestion || submissionSuccess);
  }, [docked, isSubmittingSuggestion, submissionSuccess, onShowSuggest]);

  const isDisabled = !suggestionsEnabled && !isOwner;
  const activeError = suggestionError || (docked ? answerError : serverError);
  const successColor = infoMessage ? "bg-blue-600 hover:bg-blue-500" : "bg-green-600 hover:bg-green-500";
  const submitColor = submissionSuccess ? successColor : "bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500";

  return (
    <div className={`keep-open w-full max-w-5xl mx-auto ${docked ? "" : "mt-3 animate-fadeIn space-y-2"}`}>
      <div className="keep-open flex items-center gap-2">
        <input
          type="text"
          value={songSuggestion}
          onChange={handleInputChange}
          onKeyDown={handleKeyPress}
          enterKeyHint={docked ? "send" : undefined}
          aria-label={docked ? t('header.suggest') : undefined}
          placeholder={isDisabled ? t('suggest.disabledPlaceholder') : t('suggest.placeholder')}
          disabled={isSubmittingSuggestion || isDisabled}
          className={`keep-open flex-1 min-w-0 px-5 rounded-full bg-[#121212] text-white border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-orange-500 text-base disabled:opacity-60 disabled:cursor-not-allowed ${docked ? "h-11" : "py-2"}`}
        />
        {docked ? (
          <button
            type="button"
            aria-label={t('suggest.submit')}
            onClick={(event) => {
              event.stopPropagation();
              handleSubmitSuggestion();
            }}
            disabled={isSubmittingSuggestion || isDisabled}
            className={`keep-open flex h-11 w-11 flex-none items-center justify-center rounded-full text-white shadow-lg transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${submitColor}`}
          >
            {isSubmittingSuggestion ? (
              <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
            ) : submissionSuccess ? (
              infoMessage ? <Clock size={18} /> : <CheckCircle size={18} />
            ) : (
              <Send size={18} />
            )}
          </button>
        ) : (
          <button
            onClick={(event) => {
              event.stopPropagation();
              handleSubmitSuggestion();
            }}
            disabled={isSubmittingSuggestion || isDisabled}
            className={`keep-open px-5 py-2 rounded-full text-white transition-all flex items-center gap-2 text-base disabled:cursor-not-allowed disabled:opacity-70 whitespace-nowrap ${submitColor}`}
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
        )}
      </div>
      {docked ? (
        // A plain "added" shows in the button alone: a line of text here would
        // push the whole bar up for a moment. Errors and "waits for approval"
        // say something the button cannot, so they keep their line.
        (activeError || infoMessage) ? (
          <p role="status" className={`keep-open px-3 pt-1.5 text-sm ${activeError ? "text-red-400" : "text-neutral-300"}`}>
            {activeError || infoMessage}
          </p>
        ) : submissionSuccess && (
          <span role="status" className="sr-only">{t('suggest.added')}</span>
        )
      ) : (
        activeError && (
          <p className="keep-open text-sm text-red-400">{activeError}</p>
        )
      )}

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
  isConnected: PropTypes.bool,
  isAppleRoom: PropTypes.bool,
  docked: PropTypes.bool,
};
