'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
    const fail = (message) => {
      window.clearTimeout(timeoutId);
      youtubeIframeApiPromise = null;
      reject(new Error(message));
    };
    const timeoutId = window.setTimeout(() => {
      fail('Timed out loading the YouTube IFrame API.');
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
        fail('Failed to load the YouTube IFrame API.');
      };
      document.head.appendChild(script);
    }
  });

  return youtubeIframeApiPromise;
}

export default function YouTubeWebcastPlayer({
  webcast,
  variant = 'inline',
  initialTimeSeconds = 0,
  shouldAutoplay = false,
  onSnapshotChange,
}) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const progressTimerRef = useRef(null);
  const onSnapshotChangeRef = useRef(onSnapshotChange);
  const [errorText, setErrorText] = useState('');
  const videoId = useMemo(() => getYouTubeVideoIdFromWebcast(webcast), [webcast]);
  const readyRef = useRef(false);
  const currentTimeRef = useRef(Math.max(0, Number(initialTimeSeconds) || 0));
  const playerStateRef = useRef('unstarted');
  const errorTextRef = useRef('');
  const mountConfigRef = useRef({
    videoId,
    startingTime: Math.max(0, Number(initialTimeSeconds) || 0),
    shouldAutoplay: Boolean(shouldAutoplay),
  });

  useEffect(() => {
    onSnapshotChangeRef.current = onSnapshotChange;
  }, [onSnapshotChange]);

  useEffect(() => {
    mountConfigRef.current = {
      videoId,
      startingTime: Math.max(0, Number(initialTimeSeconds) || 0),
      shouldAutoplay: Boolean(shouldAutoplay),
    };
  }, [initialTimeSeconds, shouldAutoplay, videoId]);

  const emitSnapshot = useCallback(
    (overrides = {}) => {
      onSnapshotChangeRef.current?.({
        videoId,
        ready: overrides.ready ?? readyRef.current,
        playbackState: overrides.playbackState ?? playerStateRef.current,
        currentTime:
          overrides.currentTime ??
          (Number.isFinite(Number(currentTimeRef.current)) ? Number(currentTimeRef.current) : 0),
        errorText: overrides.errorText ?? errorTextRef.current,
      });
    },
    [videoId],
  );

  const setTrackedReady = useCallback((value) => {
    readyRef.current = value;
  }, []);

  const setTrackedCurrentTime = useCallback((value) => {
    currentTimeRef.current = value;
  }, []);

  const setTrackedPlayerState = useCallback((value) => {
    playerStateRef.current = value;
  }, []);

  const setTrackedErrorText = useCallback((value) => {
    errorTextRef.current = value;
    setErrorText(value);
  }, []);

  const syncFromPlayer = useCallback(() => {
    const player = playerRef.current;
    if (!player?.getCurrentTime) return;
    const nextTime = Number(player.getCurrentTime() ?? 0);
    if (!Number.isFinite(nextTime)) return;
    setTrackedCurrentTime(nextTime);
  }, [setTrackedCurrentTime]);

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
    const { startingTime, shouldAutoplay: autoplayOnMount } = mountConfigRef.current;

    ensureYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;

        playerRef.current = new YT.Player(hostRef.current, {
          videoId,
          playerVars: {
            autoplay: autoplayOnMount ? 1 : 0,
            controls: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              setTrackedReady(true);
              setTrackedErrorText('');
              emitSnapshot({ ready: true, currentTime: startingTime, errorText: '' });

              if (startingTime > 0) {
                if (!autoplayOnMount && event.target?.cueVideoById) {
                  event.target.cueVideoById({
                    videoId,
                    startSeconds: startingTime,
                  });
                } else if (event.target?.seekTo) {
                  event.target.seekTo(startingTime, true);
                }
              }

              if (
                autoplayOnMount &&
                playerStateRef.current === 'unstarted' &&
                event.target?.playVideo
              ) {
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
              setTrackedPlayerState(nextState);
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
              setTrackedErrorText(nextError);
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
        setTrackedErrorText(nextError);
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
          currentTime: Number.isFinite(nextTime) ? nextTime : currentTimeRef.current,
          playbackState: playerStateRef.current,
        });
      }
      currentPlayer?.destroy?.();
      playerRef.current = null;
    };
  }, [
    clearProgressTimer,
    emitSnapshot,
    setTrackedErrorText,
    setTrackedPlayerState,
    setTrackedReady,
    syncFromPlayer,
    videoId,
  ]);

  if (!videoId) {
    return null;
  }

  return (
    <div
      className={`webcast-player-shell webcast-player-shell-${variant}`}
      aria-label={variant === 'floating' ? 'Floating Webcast Player' : 'Embedded Webcast Player'}
    >
      <div className="webcast-player-frame">
        <div ref={hostRef} className="webcast-player-host" />
      </div>

      {errorText ? (
        <div className="muted" style={{ fontSize: 12 }}>
          {errorText}
        </div>
      ) : null}
    </div>
  );
}
