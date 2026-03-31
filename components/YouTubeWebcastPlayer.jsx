'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { getYouTubeVideoIdFromWebcast } from '../lib/webcast';

let youtubeIframeApiPromise = null;

function mapPlayerState(code) {
  if (code === 1) return 'playing';
  if (code === 2) return 'paused';
  if (code === 0) return 'ended';
  if (code === 3) return 'buffering';
  if (code === 5) return 'cued';
  return 'unstarted';
}

function formatWebcastTime(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function ensureYouTubeIframeApi() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube player is only available in the browser.'));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeIframeApiPromise) {
    return youtubeIframeApiPromise;
  }

  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-tbsb-youtube-api="true"]');
    const timeoutId = window.setTimeout(() => {
      reject(new Error('Timed out loading the YouTube IFrame API.'));
    }, 10000);

    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      window.clearTimeout(timeoutId);
      resolve(window.YT);
    };

    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.setAttribute('data-tbsb-youtube-api', 'true');
      script.onerror = () => {
        window.clearTimeout(timeoutId);
        reject(new Error('Failed to load the YouTube IFrame API.'));
      };
      document.head.appendChild(script);
    }
  });

  return youtubeIframeApiPromise;
}

export default function YouTubeWebcastPlayer({
  webcast,
  eventKey = '',
  eventName = '',
  variant = 'inline',
  initialTimeSeconds = 0,
  shouldAutoplay = false,
  onSnapshotChange,
  onPlayIntent,
  onClose,
  onReturnToNow,
}) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const progressTimerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(Math.max(0, Number(initialTimeSeconds) || 0));
  const [playerState, setPlayerState] = useState('unstarted');
  const [errorText, setErrorText] = useState('');
  const videoId = useMemo(() => getYouTubeVideoIdFromWebcast(webcast), [webcast]);
  const displayLabel = eventName || 'Event webcast';
  const playerUrl = webcast?.url ?? webcast?.embedUrl ?? null;

  const emitSnapshot = useCallback(
    (overrides = {}) => {
      onSnapshotChange?.({
        videoId,
        ready: overrides.ready ?? ready,
        playbackState: overrides.playbackState ?? playerState,
        currentTime:
          overrides.currentTime ?? (Number.isFinite(Number(currentTime)) ? Number(currentTime) : 0),
        errorText: overrides.errorText ?? errorText,
      });
    },
    [currentTime, errorText, onSnapshotChange, playerState, ready, videoId],
  );

  const syncFromPlayer = useCallback(() => {
    const player = playerRef.current;
    if (!player?.getCurrentTime) return;
    const nextTime = Number(player.getCurrentTime() ?? 0);
    if (!Number.isFinite(nextTime)) return;
    setCurrentTime(nextTime);
  }, []);

  const clearProgressTimer = useCallback(() => {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!videoId || !hostRef.current) {
      return undefined;
    }

    let cancelled = false;
    const startingTime = Math.max(0, Number(initialTimeSeconds) || 0);

    ensureYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;

        playerRef.current = new YT.Player(hostRef.current, {
          videoId,
          playerVars: {
            autoplay: shouldAutoplay ? 1 : 0,
            controls: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              setReady(true);
              emitSnapshot({ ready: true, currentTime: startingTime, errorText: '' });

              if (startingTime > 0) {
                if (!shouldAutoplay && event.target?.cueVideoById) {
                  event.target.cueVideoById({
                    videoId,
                    startSeconds: startingTime,
                  });
                } else if (event.target?.seekTo) {
                  event.target.seekTo(startingTime, true);
                }
              }

              if (shouldAutoplay && event.target?.playVideo) {
                event.target.playVideo();
              }

              clearProgressTimer();
              progressTimerRef.current = window.setInterval(() => {
                syncFromPlayer();
              }, 500);
            },
            onStateChange: (event) => {
              if (cancelled) return;
              const nextState = mapPlayerState(event.data);
              setPlayerState(nextState);
              if (nextState === 'ended') {
                clearProgressTimer();
              }
              syncFromPlayer();
              emitSnapshot({
                playbackState: nextState,
                ready: true,
              });
            },
            onError: (event) => {
              if (cancelled) return;
              const nextError = `YouTube player error ${event?.data ?? 'unknown'}.`;
              setErrorText(nextError);
              emitSnapshot({
                errorText: nextError,
                playbackState: 'error',
              });
            },
          },
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const nextError = error instanceof Error ? error.message : 'Failed to load webcast.';
        setErrorText(nextError);
        emitSnapshot({
          errorText: nextError,
          playbackState: 'error',
        });
      });

    return () => {
      cancelled = true;
      clearProgressTimer();
      const currentPlayer = playerRef.current;
      if (currentPlayer?.getCurrentTime) {
        const nextTime = Number(currentPlayer.getCurrentTime() ?? 0);
        emitSnapshot({
          currentTime: Number.isFinite(nextTime) ? nextTime : currentTime,
          playbackState: mapPlayerState(currentPlayer.getPlayerState?.()),
        });
      }
      currentPlayer?.destroy?.();
      playerRef.current = null;
    };
  }, [
    clearProgressTimer,
    currentTime,
    emitSnapshot,
    initialTimeSeconds,
    shouldAutoplay,
    syncFromPlayer,
    videoId,
  ]);

  const playVideo = useCallback(() => {
    onPlayIntent?.();
    playerRef.current?.playVideo?.();
  }, [onPlayIntent]);

  const pauseVideo = useCallback(() => {
    playerRef.current?.pauseVideo?.();
  }, []);

  const restartVideo = useCallback(() => {
    if (!playerRef.current?.seekTo) return;
    onPlayIntent?.();
    playerRef.current.seekTo(0, true);
    playerRef.current.playVideo?.();
  }, [onPlayIntent]);

  const closeFloatingPlayer = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('tbsb_webcast_closed_event', String(eventKey || ''));
    }
    const currentPlayer = playerRef.current;
    const nextTime = Number(currentPlayer?.getCurrentTime?.() ?? currentTime);
    currentPlayer?.pauseVideo?.();
    emitSnapshot({
      currentTime: Number.isFinite(nextTime) ? nextTime : currentTime,
      playbackState: 'paused',
      ready,
    });
    if (onClose) {
      flushSync(() => {
        onClose();
      });
    }
  }, [currentTime, emitSnapshot, eventKey, onClose, ready]);

  if (!videoId) {
    return null;
  }

  return (
    <div
      className={`webcast-player-shell webcast-player-shell-${variant}`}
      aria-label={variant === 'floating' ? 'Floating Webcast Player' : 'Embedded Webcast Player'}
    >
      <div className="webcast-player-header">
        <div>
          <div className="muted" style={{ fontSize: 12 }}>
            {variant === 'floating' ? 'Floating webcast' : 'Preferred webcast'}
          </div>
          <div style={{ fontWeight: 900, marginTop: 4 }}>{displayLabel}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span className={`badge ${playerState === 'playing' ? 'badge-green' : ''}`}>
            {playerState === 'playing'
              ? 'Playing'
              : playerState === 'paused'
                ? 'Paused'
                : playerState === 'ended'
                  ? 'Ended'
                  : ready
                    ? 'Ready'
                    : 'Loading'}
          </span>
          <span className="badge">{formatWebcastTime(currentTime)}</span>
        </div>
      </div>

      <div className="webcast-player-frame">
        <div ref={hostRef} className="webcast-player-host" />
      </div>

      {errorText ? (
        <div className="muted" style={{ fontSize: 12 }}>
          {errorText}
        </div>
      ) : null}

      <div className="webcast-player-actions">
        <button className="button button-primary" type="button" onClick={playVideo}>
          Play Webcast
        </button>
        <button className="button" type="button" onClick={pauseVideo}>
          Pause Webcast
        </button>
        <button className="button" type="button" onClick={restartVideo}>
          Restart
        </button>
        {playerUrl ? (
          <a className="button" href={playerUrl} target="_blank" rel="noreferrer">
            Open Webcast
          </a>
        ) : null}
        {variant === 'floating' && onReturnToNow ? (
          <button className="button" type="button" onClick={onReturnToNow}>
            Return to NOW
          </button>
        ) : null}
        {variant === 'floating' && onClose ? (
          <button className="button button-danger" type="button" onClick={closeFloatingPlayer}>
            Close Mini-Player
          </button>
        ) : null}
      </div>
    </div>
  );
}
