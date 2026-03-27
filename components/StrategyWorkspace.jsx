'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJsonOrThrow } from '../lib/httpCache';
import { formatMatchLabel, safeNumber, sortMatches, teamNumberFromKey } from '../lib/logic';
import { PERSISTENCE_TABLES } from '../lib/persistence-surfaces';
import { makeStrategyRecordId } from '../lib/strategy-storage';
import {
  getStrategyRecordByIdShared,
  getStrategyRecordShared,
  listStrategyRecordsShared,
  saveStrategyRecordShared,
} from '../lib/shared-workspace-browser';
import { createSupabaseBrowserClient } from '../lib/supabase-browser';
import { isSupabaseConfigured } from '../lib/supabase';
import { getEventWorkspaceKey } from '../lib/workspace-key';
import StrategyBoard from './StrategyBoard';
import DisclosureSection from './ui/DisclosureSection';
const RED_MARKER_Y = [120, 250, 380];
const BLUE_MARKER_Y = [120, 250, 380];
function cloneValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
function fmt(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}
function extractSbTeamNumber(item) {
  const raw =
    item?.team_number ??
    item?.team_num ??
    item?.team ??
    item?.teamNumber ??
    item?.team_key ??
    item?.team?.team_number ??
    item?.team?.team ??
    item?.team?.key ??
    null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const normalized = raw.startsWith('frc') ? raw.slice(3) : raw;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}
function getSbOverallEpa(teamEvent) {
  const value = teamEvent?.epa?.total_points?.mean ?? teamEvent?.norm_epa?.current;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function getSbAutoEpa(teamEvent) {
  const value = teamEvent?.epa?.breakdown?.auto_points;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function getSbTeleopEpa(teamEvent) {
  const value = teamEvent?.epa?.breakdown?.teleop_points;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function getSbEndgameEpa(teamEvent) {
  const value = teamEvent?.epa?.breakdown?.endgame_points;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function createMarkers(match) {
  const red = (match?.alliances?.red?.team_keys ?? []).slice(0, 3);
  const blue = (match?.alliances?.blue?.team_keys ?? []).slice(0, 3);
  return [
    ...red.map((teamKey, index) => ({
      id: `marker_${teamKey}`,
      teamKey,
      teamNumber: teamNumberFromKey(teamKey) ?? safeNumber(teamKey.replace(/\D/g, ''), 0),
      alliance: 'red',
      x: 140,
      y: RED_MARKER_Y[index] ?? 250,
    })),
    ...blue.map((teamKey, index) => ({
      id: `marker_${teamKey}`,
      teamKey,
      teamNumber: teamNumberFromKey(teamKey) ?? safeNumber(teamKey.replace(/\D/g, ''), 0),
      alliance: 'blue',
      x: 860,
      y: BLUE_MARKER_Y[index] ?? 250,
    })),
  ];
}
function createBlankBoard(match) {
  return {
    background: 'field',
    shapes: [],
    markers: createMarkers(match),
  };
}
function coerceBoard(board, match) {
  return {
    background: board?.background === 'grid' ? 'grid' : 'field',
    shapes: Array.isArray(board?.shapes) ? cloneValue(board.shapes) : [],
    markers: createMarkers(match),
  };
}
function createBlankRecord(eventKey, eventName, match) {
  const id = makeStrategyRecordId(eventKey, match.key);
  const now = Date.now();
  return {
    id,
    eventKey,
    matchKey: match.key,
    matchLabel: formatMatchLabel(match),
    eventName,
    compLevel: match?.comp_level ?? '',
    allianceTeams: {
      red: [...(match?.alliances?.red?.team_keys ?? [])],
      blue: [...(match?.alliances?.blue?.team_keys ?? [])],
    },
    status: 'draft',
    notes: '',
    autoBoard: createBlankBoard(match),
    teleopBoard: createBlankBoard(match),
    createdAtMs: now,
    updatedAtMs: now,
    copiedFrom: null,
  };
}
function buildCurrentContext(currentSnapshot, currentEventKey) {
  if (!currentSnapshot || !currentEventKey) return null;
  return {
    generatedAtMs: currentSnapshot.generatedAtMs,
    inputs: { eventKey: currentEventKey },
    tba: currentSnapshot.tba,
    sb: currentSnapshot.sb,
  };
}
function teamName(teamInfo, teamNumber, teamKey) {
  return teamInfo?.nickname ?? teamInfo?.name ?? `${teamNumber || teamKey}`;
}
export default function StrategyWorkspace({
  target,
  currentEventKey,
  currentSnapshot,
  onTargetChange,
  onOpenTeamProfile,
  onAddToCompare,
}) {
  const [eventContext, setEventContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState('');
  const [strategyMeta, setStrategyMeta] = useState(null);
  const [status, setStatus] = useState('draft');
  const [notes, setNotes] = useState('');
  const [autoBoard, setAutoBoard] = useState({
    background: 'field',
    shapes: [],
    markers: [],
  });
  const [teleopBoard, setTeleopBoard] = useState({
    background: 'field',
    shapes: [],
    markers: [],
  });
  const [activeTool, setActiveTool] = useState('pen');
  const [strokeColor, setStrokeColor] = useState('#f3be3b');
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [teamCardMode, setTeamCardMode] = useState('compact');
  const [savedStrategies, setSavedStrategies] = useState([]);
  const [copySourceId, setCopySourceId] = useState('');
  const [copyScope, setCopyScope] = useState('full');
  const [actionError, setActionError] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState('Idle');
  const [liveTeamStats, setLiveTeamStats] = useState({});
  const [liveStatsLoading, setLiveStatsLoading] = useState(false);
  const [liveStatsError, setLiveStatsError] = useState('');
  const [recordLoaded, setRecordLoaded] = useState(false);
  const [lastRemoteSyncAtMs, setLastRemoteSyncAtMs] = useState(null);
  const [autoPast, setAutoPast] = useState([]);
  const [autoFuture, setAutoFuture] = useState([]);
  const [teleopPast, setTeleopPast] = useState([]);
  const [teleopFuture, setTeleopFuture] = useState([]);
  const importInputRef = useRef(null);
  const autosaveTimerRef = useRef(null);
  const loadSequenceRef = useRef(0);
  const lastSavedJsonRef = useRef('');
  const targetEventKey = target?.eventKey ?? null;
  const targetMatchKey = target?.matchKey ?? null;
  const strategyWorkspaceKey = useMemo(
    () => getEventWorkspaceKey(targetEventKey ?? currentEventKey),
    [currentEventKey, targetEventKey],
  );
  const currentContext = useMemo(
    () => buildCurrentContext(currentSnapshot ?? null, currentEventKey),
    [currentSnapshot, currentEventKey],
  );
  useEffect(() => {
    if (!strategyWorkspaceKey) {
      setSavedStrategies([]);
      return;
    }

    async function refreshSavedStrategies() {
      try {
        const rows = await listStrategyRecordsShared(strategyWorkspaceKey);
        setSavedStrategies(rows);
      } catch {
        setSavedStrategies([]);
      }
    }
    refreshSavedStrategies();
  }, [strategyWorkspaceKey]);
  useEffect(() => {
    if (!targetEventKey) {
      setEventContext(null);
      setContextError('');
      setContextLoading(false);
      return;
    }
    if (targetEventKey === currentEventKey && currentContext) {
      setEventContext(currentContext);
      setContextLoading(false);
      setContextError('');
      return;
    }
    let cancelled = false;
    async function loadEventContext() {
      setContextLoading(true);
      setContextError('');
      try {
        const json = await fetchJsonOrThrow(
          `/api/event-context?eventKey=${encodeURIComponent(targetEventKey)}`,
          { cache: 'no-store' },
          'Event context failed',
        );
        if (!cancelled) setEventContext(json);
      } catch (error) {
        if (!cancelled) {
          setContextError(error?.message ?? 'Unknown event-context error');
          setEventContext(null);
        }
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    }
    loadEventContext();
    return () => {
      cancelled = true;
    };
  }, [currentContext, currentEventKey, targetEventKey]);
  const sortedMatches = useMemo(
    () => sortMatches(eventContext?.tba?.matches ?? []),
    [eventContext],
  );
  useEffect(() => {
    if (!targetEventKey || !sortedMatches.length) return;
    if (sortedMatches.some((match) => match.key === targetMatchKey)) return;
    onTargetChange({
      eventKey: targetEventKey,
      matchKey: sortedMatches[0].key,
    });
  }, [onTargetChange, sortedMatches, targetEventKey, targetMatchKey]);
  const selectedMatch = useMemo(() => {
    if (!targetEventKey) return null;
    return sortedMatches.find((match) => match.key === targetMatchKey) ?? sortedMatches[0] ?? null;
  }, [sortedMatches, targetEventKey, targetMatchKey]);
  const rankingsRows = useMemo(
    () =>
      Array.isArray(eventContext?.tba?.rankings?.rankings)
        ? eventContext.tba.rankings.rankings
        : [],
    [eventContext],
  );
  const rankingMap = useMemo(() => {
    const map = new Map();
    for (const row of rankingsRows) map.set(String(row.team_key), row);
    return map;
  }, [rankingsRows]);
  const teamInfoMap = useMemo(() => {
    const map = new Map();
    for (const team of eventContext?.tba?.teams ?? []) {
      const teamKey = `frc${safeNumber(team?.team_number, 0)}`;
      map.set(teamKey, team);
    }
    return map;
  }, [eventContext]);
  const sbTeamEventMap = useMemo(() => {
    const map = new Map();
    for (const item of eventContext?.sb?.teamEvents ?? []) {
      const teamNumber = extractSbTeamNumber(item);
      if (teamNumber != null && !map.has(teamNumber)) map.set(teamNumber, item);
    }
    return map;
  }, [eventContext]);
  const rpIndex = useMemo(() => {
    const sortInfo = Array.isArray(eventContext?.tba?.rankings?.sort_order_info)
      ? eventContext.tba.rankings.sort_order_info
      : [];
    for (let index = 0; index < sortInfo.length; index += 1) {
      const name = String(sortInfo[index]?.name ?? '').toLowerCase();
      if (name.includes('ranking point') || name === 'rp' || name.includes('ranking score')) {
        return index;
      }
    }
    return 0;
  }, [eventContext]);
  const teamEventRow = useCallback(
    (teamKey) => {
      const teamNumber = teamNumberFromKey(teamKey) ?? 0;
      const ranking = rankingMap.get(teamKey) ?? null;
      const teamInfo = teamInfoMap.get(teamKey) ?? null;
      const teamEvent = sbTeamEventMap.get(teamNumber) ?? null;
      const sortOrders = Array.isArray(ranking?.sort_orders) ? ranking.sort_orders : [];
      const rpAverage = Number.isFinite(Number(sortOrders[rpIndex]))
        ? Number(sortOrders[rpIndex])
        : null;
      const matchesPlayed = safeNumber(ranking?.matches_played, 0);
      const record = ranking?.record
        ? `${ranking.record.wins ?? 0}-${ranking.record.losses ?? 0}-${ranking.record.ties ?? 0}`
        : '-';
      return {
        teamKey,
        teamNumber,
        nickname: teamName(teamInfo, teamNumber, teamKey),
        rank: ranking?.rank ?? null,
        matchesPlayed,
        rpAverage,
        totalRp: rpAverage != null && matchesPlayed > 0 ? rpAverage * matchesPlayed : null,
        record,
        overallEpa: getSbOverallEpa(teamEvent),
        autoEpa: getSbAutoEpa(teamEvent),
        teleopEpa: getSbTeleopEpa(teamEvent),
        endgameEpa: getSbEndgameEpa(teamEvent),
        opr: Number.isFinite(Number(eventContext?.tba?.oprs?.oprs?.[teamKey]))
          ? Number(eventContext.tba.oprs.oprs[teamKey])
          : null,
        dpr: Number.isFinite(Number(eventContext?.tba?.oprs?.dprs?.[teamKey]))
          ? Number(eventContext.tba.oprs.dprs[teamKey])
          : null,
        ccwm: Number.isFinite(Number(eventContext?.tba?.oprs?.ccwms?.[teamKey]))
          ? Number(eventContext.tba.oprs.ccwms[teamKey])
          : null,
      };
    },
    [eventContext, rankingMap, rpIndex, sbTeamEventMap, teamInfoMap],
  );
  const selectedMatchRows = useMemo(() => {
    if (!selectedMatch) return [];
    const redRows = (selectedMatch?.alliances?.red?.team_keys ?? []).map((teamKey) => ({
      ...teamEventRow(teamKey),
      alliance: 'red',
    }));
    const blueRows = (selectedMatch?.alliances?.blue?.team_keys ?? []).map((teamKey) => ({
      ...teamEventRow(teamKey),
      alliance: 'blue',
    }));
    return [...redRows, ...blueRows];
  }, [selectedMatch, teamEventRow]);
  const setLoadedRecord = useCallback(
    (record, markLoaded = true) => {
      setStrategyMeta({
        id: record.id,
        eventKey: record.eventKey,
        matchKey: record.matchKey,
        matchLabel: record.matchLabel,
        eventName: record.eventName,
        compLevel: record.compLevel,
        allianceTeams: cloneValue(record.allianceTeams),
        createdAtMs: record.createdAtMs,
        updatedAtMs: record.updatedAtMs,
        copiedFrom: record.copiedFrom ?? null,
      });
      setStatus(record.status ?? 'draft');
      setNotes(record.notes ?? '');
      const nextAuto = coerceBoard(record.autoBoard, selectedMatch);
      const nextTeleop = coerceBoard(record.teleopBoard, selectedMatch);
      setAutoBoard(nextAuto);
      setTeleopBoard(nextTeleop);
      setAutoPast([cloneValue(nextAuto)]);
      setAutoFuture([]);
      setTeleopPast([cloneValue(nextTeleop)]);
      setTeleopFuture([]);
      lastSavedJsonRef.current = markLoaded
        ? JSON.stringify({
            ...record,
            autoBoard: nextAuto,
            teleopBoard: nextTeleop,
          })
        : '';
      setRecordLoaded(markLoaded);
    },
    [selectedMatch],
  );
  useEffect(() => {
    if (!strategyWorkspaceKey || !isSupabaseConfigured()) return;

    let cancelled = false;
    const client = createSupabaseBrowserClient();

    const refreshSavedStrategies = async () => {
      try {
        const rows = await listStrategyRecordsShared(strategyWorkspaceKey);
        if (!cancelled) setSavedStrategies(rows);
      } catch {}
    };

    const channel = client
      .channel(`strategy-live:${strategyWorkspaceKey}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: PERSISTENCE_TABLES.strategyRecords },
        async (payload) => {
          const workspaceKey =
            payload?.new?.workspace_key ??
            payload?.old?.workspace_key ??
            payload?.record?.workspace_key ??
            null;
          if (workspaceKey && String(workspaceKey) !== String(strategyWorkspaceKey)) return;

          setLastRemoteSyncAtMs(Date.now());
          await refreshSavedStrategies();

          const changedId = payload?.new?.id ?? payload?.old?.id ?? null;
          if (!changedId || !strategyMeta?.id || String(changedId) !== String(strategyMeta.id))
            return;

          try {
            const latest = await getStrategyRecordByIdShared(strategyWorkspaceKey, changedId);
            if (cancelled || !latest) return;

            const latestJson = JSON.stringify(latest);
            if (latestJson === lastSavedJsonRef.current) return;

            setLoadedRecord(latest, true);
            setAutosaveStatus('Live update received');
          } catch {}
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [setLoadedRecord, strategyMeta?.id, strategyWorkspaceKey]);
  useEffect(() => {
    if (!targetEventKey || !selectedMatch || !eventContext) {
      setRecordLoaded(false);
      return;
    }
    const blankRecord = createBlankRecord(
      targetEventKey,
      eventContext?.tba?.event?.name ?? targetEventKey,
      selectedMatch,
    );
    setLoadedRecord(blankRecord, false);
    setAutosaveStatus('Blank strategy ready');
    setActionError('');
    const sequence = ++loadSequenceRef.current;
    async function loadStoredRecord() {
      try {
        const stored = await getStrategyRecordShared(targetEventKey, selectedMatch.key);
        if (sequence !== loadSequenceRef.current) return;
        setLoadedRecord(stored ?? blankRecord, true);
        setAutosaveStatus(stored ? 'Saved strategy loaded' : 'Blank strategy ready');
      } catch (error) {
        if (sequence !== loadSequenceRef.current) return;
        setLoadedRecord(blankRecord, true);
        setActionError(error?.message ?? 'Strategy storage read failed');
      }
    }
    loadStoredRecord();
  }, [eventContext, selectedMatch, setLoadedRecord, targetEventKey]);
  const currentRecord = useMemo(() => {
    if (!strategyMeta) return null;
    return {
      ...strategyMeta,
      notes,
      status,
      autoBoard,
      teleopBoard,
    };
  }, [strategyMeta, notes, status, autoBoard, teleopBoard]);
  useEffect(() => {
    if (!recordLoaded || !currentRecord) return;
    const nextJson = JSON.stringify(currentRecord);
    if (nextJson === lastSavedJsonRef.current) return;
    if (autosaveTimerRef.current != null) window.clearTimeout(autosaveTimerRef.current);
    setAutosaveStatus('Saving draft...');
    autosaveTimerRef.current = window.setTimeout(async () => {
      try {
        await saveStrategyRecordShared(currentRecord);
        lastSavedJsonRef.current = nextJson;
        setAutosaveStatus(
          `${currentRecord.status === 'final' ? 'Final' : 'Draft'} saved ${new Date().toLocaleTimeString()}`,
        );
        const rows = strategyWorkspaceKey
          ? await listStrategyRecordsShared(strategyWorkspaceKey)
          : [];
        setSavedStrategies(rows);
      } catch (error) {
        setAutosaveStatus('Autosave failed');
        setActionError(error?.message ?? 'Failed to save strategy');
      }
    }, 700);
    return () => {
      if (autosaveTimerRef.current != null) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [currentRecord, recordLoaded, strategyWorkspaceKey]);
  function touchMeta(extra = {}) {
    setStrategyMeta((prev) =>
      prev
        ? {
            ...prev,
            ...extra,
            updatedAtMs: Date.now(),
          }
        : prev,
    );
  }
  function pushBoardHistory(setter, historySetter, futureSetter, nextBoard) {
    const cloned = cloneValue(nextBoard);
    setter(cloned);
    historySetter((prev) => {
      const nextHistory = [...prev, cloneValue(cloned)];
      return nextHistory.length > 60 ? nextHistory.slice(nextHistory.length - 60) : nextHistory;
    });
    futureSetter([]);
    touchMeta();
  }
  function commitAutoBoard(nextBoard) {
    pushBoardHistory(setAutoBoard, setAutoPast, setAutoFuture, nextBoard);
  }
  function commitTeleopBoard(nextBoard) {
    pushBoardHistory(setTeleopBoard, setTeleopPast, setTeleopFuture, nextBoard);
  }
  function undoAutoBoard() {
    setAutoPast((prev) => {
      if (prev.length <= 1) return prev;
      const current = cloneValue(prev[prev.length - 1]);
      const nextHistory = prev.slice(0, -1);
      setAutoFuture((future) => [current, ...future]);
      setAutoBoard(cloneValue(nextHistory[nextHistory.length - 1]));
      touchMeta();
      return nextHistory;
    });
  }
  function redoAutoBoard() {
    setAutoFuture((prev) => {
      if (!prev.length) return prev;
      const [nextBoard, ...rest] = prev;
      setAutoPast((history) => [...history, cloneValue(nextBoard)]);
      setAutoBoard(cloneValue(nextBoard));
      touchMeta();
      return rest;
    });
  }
  function undoTeleopBoard() {
    setTeleopPast((prev) => {
      if (prev.length <= 1) return prev;
      const current = cloneValue(prev[prev.length - 1]);
      const nextHistory = prev.slice(0, -1);
      setTeleopFuture((future) => [current, ...future]);
      setTeleopBoard(cloneValue(nextHistory[nextHistory.length - 1]));
      touchMeta();
      return nextHistory;
    });
  }
  function redoTeleopBoard() {
    setTeleopFuture((prev) => {
      if (!prev.length) return prev;
      const [nextBoard, ...rest] = prev;
      setTeleopPast((history) => [...history, cloneValue(nextBoard)]);
      setTeleopBoard(cloneValue(nextBoard));
      touchMeta();
      return rest;
    });
  }
  function clearAutoBoard() {
    commitAutoBoard({
      ...autoBoard,
      shapes: [],
    });
  }
  function clearTeleopBoard() {
    commitTeleopBoard({
      ...teleopBoard,
      shapes: [],
    });
  }
  async function handleCopyFromSaved() {
    if (!copySourceId || !selectedMatch) return;
    setActionError('');
    try {
      const source = await getStrategyRecordByIdShared(strategyWorkspaceKey, copySourceId);
      if (!source) throw new Error('Saved strategy not found.');
      if (copyScope === 'full' || copyScope === 'auto') {
        const nextAuto = coerceBoard(source.autoBoard, selectedMatch);
        setAutoBoard(nextAuto);
        setAutoPast([cloneValue(nextAuto)]);
        setAutoFuture([]);
      }
      if (copyScope === 'full' || copyScope === 'teleop') {
        const nextTeleop = coerceBoard(source.teleopBoard, selectedMatch);
        setTeleopBoard(nextTeleop);
        setTeleopPast([cloneValue(nextTeleop)]);
        setTeleopFuture([]);
      }
      if (copyScope === 'full' || copyScope === 'notes') {
        setNotes(String(source.notes ?? ''));
      }
      if (copyScope === 'full') {
        setStatus(source.status === 'final' ? 'final' : 'draft');
      }
      touchMeta({
        copiedFrom: {
          eventKey: source.eventKey,
          matchKey: source.matchKey,
          scope: copyScope,
        },
      });
      setAutosaveStatus(`Copied ${copyScope} from ${source.matchLabel}`);
    } catch (error) {
      setActionError(error?.message ?? 'Copy failed');
    }
  }
  function exportCurrentRecord() {
    if (!currentRecord) return;
    const blob = new Blob([JSON.stringify(currentRecord, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentRecord.eventKey}_${currentRecord.matchLabel}_strategy.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  function applyImportedRecord(source) {
    if (!selectedMatch) return;
    const importedAuto = coerceBoard(source?.autoBoard, selectedMatch);
    const importedTeleop = coerceBoard(source?.teleopBoard, selectedMatch);
    setAutoBoard(importedAuto);
    setAutoPast([cloneValue(importedAuto)]);
    setAutoFuture([]);
    setTeleopBoard(importedTeleop);
    setTeleopPast([cloneValue(importedTeleop)]);
    setTeleopFuture([]);
    setNotes(String(source?.notes ?? ''));
    setStatus(source?.status === 'final' ? 'final' : 'draft');
    touchMeta({
      copiedFrom: {
        eventKey: String(source?.eventKey ?? 'import'),
        matchKey: String(source?.matchKey ?? 'import'),
        scope: 'full',
      },
    });
    setAutosaveStatus('Imported strategy JSON');
  }
  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setActionError('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      applyImportedRecord(parsed);
    } catch (error) {
      setActionError(error?.message ?? 'JSON import failed');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }
  async function loadLiveStats() {
    const teamNumbers = selectedMatchRows
      .map((row) => row.teamNumber)
      .filter((teamNumber) => Number.isFinite(teamNumber) && teamNumber > 0);
    if (!teamNumbers.length) return;
    setLiveStatsLoading(true);
    setLiveStatsError('');
    try {
      const responses = await Promise.all(
        teamNumbers.map(async (teamNumber) => {
          if (liveTeamStats[teamNumber]) return [teamNumber, liveTeamStats[teamNumber]];
          const json = await fetchJsonOrThrow(
            `/api/team-profile?team=${encodeURIComponent(String(teamNumber))}&summaryOnly=1`,
            { cache: 'no-store' },
            `Failed to load live stats for ${teamNumber}`,
          );
          return [teamNumber, json];
        }),
      );
      setLiveTeamStats((prev) => ({
        ...prev,
        ...Object.fromEntries(responses),
      }));
    } catch (error) {
      setLiveStatsError(error?.message ?? 'Live 2026 stat pull failed');
    } finally {
      setLiveStatsLoading(false);
    }
  }
  const copyOptions = useMemo(
    () => savedStrategies.filter((row) => row.id !== strategyMeta?.id),
    [savedStrategies, strategyMeta?.id],
  );
  const selectedRedRows = useMemo(
    () => selectedMatchRows.filter((row) => row.alliance === 'red'),
    [selectedMatchRows],
  );
  const selectedBlueRows = useMemo(
    () => selectedMatchRows.filter((row) => row.alliance === 'blue'),
    [selectedMatchRows],
  );
  function renderTeamCard(row) {
    const liveProfile = liveTeamStats[row.teamNumber] ?? null;
    const liveSeasonSummary = liveProfile?.seasonSummary ?? null;
    const liveSummary = liveProfile?.summary ?? null;
    const liveCurrentEpa = liveSeasonSummary?.epa?.norm ?? liveSummary?.norm_epa?.current ?? null;
    const liveRecentEpa =
      liveSummary?.norm_epa?.recent ?? liveSeasonSummary?.epa?.stats?.pre_champs ?? null;
    const liveMeanTotal =
      liveSeasonSummary?.epa?.total_points?.mean ??
      liveSeasonSummary?.epa?.breakdown?.total_points ??
      null;
    const liveRecord = liveSeasonSummary?.record ?? liveSummary?.record ?? null;
    return (
      <div
        key={row.teamKey}
        className="panel-2"
        style={{
          padding: 12,
          borderColor: row.alliance === 'red' ? '#7a2323' : '#214d84',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <div style={{ fontWeight: 900 }}>
            {row.teamNumber} {row.nickname}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="badge">{row.alliance.toUpperCase()}</span>
            <button className="button" onClick={() => onOpenTeamProfile?.(row.teamNumber)}>
              TEAM_PROFILE
            </button>
            <button className="button" onClick={() => onAddToCompare?.(row.teamNumber)}>
              COMPARE
            </button>
          </div>
        </div>
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Event Rank {row.rank ?? '-'} | Record {row.record} | Event RP Avg {fmt(row.rpAverage, 2)}{' '}
          | Total RP {fmt(row.totalRp, 1)}
        </div>
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Event EPA {fmt(row.overallEpa, 1)} | Auto {fmt(row.autoEpa, 1)} | Teleop{' '}
          {fmt(row.teleopEpa, 1)} | Endgame {fmt(row.endgameEpa, 1)}
        </div>
        {teamCardMode === 'expanded' ? (
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            OPR {fmt(row.opr, 1)} | DPR {fmt(row.dpr, 1)} | CCWM {fmt(row.ccwm, 1)} | Matches Played{' '}
            {row.matchesPlayed ?? 0}
          </div>
        ) : null}
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <strong>Live 2026:</strong>{' '}
          {liveProfile ? (
            <>
              Current EPA {fmt(liveCurrentEpa, 1)} | Recent {fmt(liveRecentEpa, 1)} | Mean Total{' '}
              {fmt(liveMeanTotal, 1)} | Record {liveRecord?.wins ?? 0}-{liveRecord?.losses ?? 0}-
              {liveRecord?.ties ?? 0}
            </>
          ) : (
            <span className="muted">Not pulled yet. Use &quot;Pull Live 2026 Stats&quot;.</span>
          )}
        </div>
      </div>
    );
  }
  if (!target) {
    return (
      <div className="panel" style={{ padding: 16, marginTop: 12 }}>
        <div className="muted">
          Open a match from MATCH, SCHEDULE, or TEAM_PROFILE history to start a strategy record.
        </div>
      </div>
    );
  }
  return (
    <div className="stack-12" style={{ marginTop: 12 }}>
      <div className="panel strategy-screen-only" style={{ padding: 16 }}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <select
            className="input"
            value={selectedMatch?.key ?? ''}
            onChange={(event) =>
              onTargetChange({
                eventKey: targetEventKey,
                matchKey: event.target.value,
              })
            }
            disabled={!sortedMatches.length}
          >
            {sortedMatches.map((match) => (
              <option key={match.key} value={match.key}>
                {formatMatchLabel(match)}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={activeTool}
            onChange={(event) => setActiveTool(event.target.value)}
          >
            <option value="pen">Pen</option>
            <option value="line">Line</option>
            <option value="arrow">Arrow</option>
            <option value="rectangle">Rectangle</option>
            <option value="circle">Circle</option>
            <option value="text">Text</option>
            <option value="eraser">Eraser</option>
          </select>
          <input
            className="input"
            type="color"
            value={strokeColor}
            onChange={(event) => setStrokeColor(event.target.value)}
            style={{ width: 60, padding: 6 }}
          />
          <select
            className="input"
            value={strokeWidth}
            onChange={(event) => setStrokeWidth(Number(event.target.value))}
          >
            <option value={2}>2px</option>
            <option value={4}>4px</option>
            <option value={6}>6px</option>
            <option value={8}>8px</option>
            <option value={10}>10px</option>
          </select>
          <button
            className="button"
            onClick={() => {
              setStatus('draft');
              touchMeta();
            }}
          >
            Mark Draft
          </button>
          <button
            className="button"
            onClick={() => {
              setStatus('final');
              touchMeta();
            }}
          >
            Mark Final
          </button>
          <button className="button" onClick={loadLiveStats}>
            Pull Live 2026 Stats
          </button>
          <button className="button" onClick={exportCurrentRecord}>
            Export JSON
          </button>
          <button className="button" onClick={() => importInputRef.current?.click()}>
            Import JSON
          </button>
          <button className="button" onClick={() => window.print()}>
            Print Strategy
          </button>
          <button
            className="button"
            onClick={() => setTeamCardMode((prev) => (prev === 'compact' ? 'expanded' : 'compact'))}
          >
            {teamCardMode === 'compact' ? 'Expanded Cards' : 'Compact Cards'}
          </button>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>

      <div className="panel strategy-print-header" style={{ padding: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'flex-start',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>
              {selectedMatch ? formatMatchLabel(selectedMatch) : 'STRATEGY'}
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              {eventContext?.tba?.event?.name ?? target.eventKey} | {targetEventKey}
            </div>
            <div className="mono muted" style={{ marginTop: 4 }}>
              Match Key: {selectedMatch?.key ?? targetMatchKey}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="badge">Status: {status.toUpperCase()}</div>
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              {autosaveStatus}
            </div>
            {lastRemoteSyncAtMs ? (
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                Shared sync {new Date(lastRemoteSyncAtMs).toLocaleTimeString()}
              </div>
            ) : null}
            {strategyMeta?.copiedFrom ? (
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                Copied From: {strategyMeta.copiedFrom.eventKey} / {strategyMeta.copiedFrom.matchKey}{' '}
                ({strategyMeta.copiedFrom.scope})
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid-2" style={{ marginTop: 16 }}>
          <div className="panel-2" style={{ padding: 12, borderColor: '#7a2323' }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Red Alliance</div>
            <div className="mono">{selectedMatch?.alliances?.red?.team_keys?.join(' ') ?? '-'}</div>
          </div>
          <div className="panel-2" style={{ padding: 12, borderColor: '#214d84' }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Blue Alliance</div>
            <div className="mono">
              {selectedMatch?.alliances?.blue?.team_keys?.join(' ') ?? '-'}
            </div>
          </div>
        </div>
        {contextLoading ? (
          <div className="muted" style={{ marginTop: 10 }}>
            Loading event context...
          </div>
        ) : null}
        {contextError ? (
          <div className="muted" style={{ marginTop: 10, color: '#ff9c9c' }}>
            {contextError}
          </div>
        ) : null}
        {actionError ? (
          <div className="muted" style={{ marginTop: 10, color: '#ff9c9c' }}>
            {actionError}
          </div>
        ) : null}
        {liveStatsError ? (
          <div className="muted" style={{ marginTop: 10, color: '#ff9c9c' }}>
            {liveStatsError}
          </div>
        ) : null}
        {liveStatsLoading ? (
          <div className="muted" style={{ marginTop: 10 }}>
            Pulling live 2026 stats...
          </div>
        ) : null}
      </div>

      <DisclosureSection
        storageKey="ui.strategy.saved_transfer"
        title="Saved Strategy Transfer"
        description="Copy AUTO, TELEOP, notes, or full plans from a saved strategy into the current match."
      >
        <div className="panel strategy-screen-only" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <select
              className="input"
              value={copySourceId}
              onChange={(event) => setCopySourceId(event.target.value)}
              style={{ minWidth: 320 }}
            >
              <option value="">Copy from saved strategy...</option>
              {copyOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.eventName} | {row.matchLabel} | {row.status} |{' '}
                  {new Date(row.updatedAtMs).toLocaleString()}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={copyScope}
              onChange={(event) => setCopyScope(event.target.value)}
            >
              <option value="full">Full Strategy</option>
              <option value="auto">AUTO Only</option>
              <option value="teleop">TELEOP Only</option>
              <option value="notes">Notes Only</option>
            </select>
            <button className="button" onClick={handleCopyFromSaved} disabled={!copySourceId}>
              Copy Into Current Match
            </button>
          </div>
        </div>
      </DisclosureSection>

      <DisclosureSection
        storageKey="ui.strategy.alliance_cards"
        title="Alliance Scout Cards"
        description="Live match cards for both alliances with quick access to team profiles and compare actions."
        defaultOpen
      >
        <div className="strategy-team-grid">
          <div className="stack-12">
            <div
              className="panel-2 strategy-screen-only"
              style={{ padding: 12, borderColor: '#7a2323' }}
            >
              <div style={{ fontWeight: 900 }}>Red Alliance</div>
              <div className="mono muted" style={{ marginTop: 4 }}>
                {(selectedMatch?.alliances?.red?.team_keys ?? []).join(' ') || '-'}
              </div>
            </div>
            <div className="stack-12">{selectedRedRows.map(renderTeamCard)}</div>
          </div>
          <div className="stack-12">
            <div
              className="panel-2 strategy-screen-only"
              style={{ padding: 12, borderColor: '#214d84' }}
            >
              <div style={{ fontWeight: 900 }}>Blue Alliance</div>
              <div className="mono muted" style={{ marginTop: 4 }}>
                {(selectedMatch?.alliances?.blue?.team_keys ?? []).join(' ') || '-'}
              </div>
            </div>
            <div className="stack-12">{selectedBlueRows.map(renderTeamCard)}</div>
          </div>
        </div>
      </DisclosureSection>

      <div className="strategy-board-grid">
        <StrategyBoard
          title="AUTO"
          board={autoBoard}
          activeTool={activeTool}
          strokeColor={strokeColor}
          strokeWidth={strokeWidth}
          onCommit={commitAutoBoard}
          onUndo={undoAutoBoard}
          onRedo={redoAutoBoard}
          onClear={clearAutoBoard}
          canUndo={autoPast.length > 1}
          canRedo={autoFuture.length > 0}
        />
        <StrategyBoard
          title="TELEOP"
          board={teleopBoard}
          activeTool={activeTool}
          strokeColor={strokeColor}
          strokeWidth={strokeWidth}
          onCommit={commitTeleopBoard}
          onUndo={undoTeleopBoard}
          onRedo={redoTeleopBoard}
          onClear={clearTeleopBoard}
          canUndo={teleopPast.length > 1}
          canRedo={teleopFuture.length > 0}
        />
      </div>

      <DisclosureSection
        storageKey="ui.strategy.shared_notes"
        title="Shared Notes"
        description="Match plan, tendencies, autonomy sequencing, defender notes, stage plans, and backups."
        defaultOpen
      >
        <div className="panel strategy-notes-block" style={{ padding: 16 }}>
          <textarea
            className="input strategy-notes-input"
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              touchMeta();
            }}
            placeholder="Match plan, tendencies, auton sequencing, defender notes, stage plans, backup ideas..."
          />
        </div>
      </DisclosureSection>
    </div>
  );
}
