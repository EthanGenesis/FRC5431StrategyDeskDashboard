'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type {
  StrategyBoardBackground,
  StrategyBoardState,
  StrategyMarker,
  StrategyPoint,
  StrategyShape,
  StrategyTool,
} from '../lib/strategy-types';

const BOARD_WIDTH = 1000;
const BOARD_HEIGHT = 500;

type StrategyBoardProps = {
  title: string;
  board: StrategyBoardState;
  activeTool: StrategyTool;
  strokeColor: string;
  strokeWidth: number;
  onCommit: (board: StrategyBoardState) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

type StrategyInteraction =
  | {
      kind: 'marker';
      markerId: string;
    }
  | {
      kind: 'shape';
      tool: Exclude<StrategyTool, 'eraser' | 'text'>;
      start: StrategyPoint;
    };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function distance(a: StrategyPoint, b: StrategyPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointToString(point: StrategyPoint): string {
  return `${point.x},${point.y}`;
}

function normalizeRect(start: StrategyPoint, end: StrategyPoint) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function buildArrowHead(start: StrategyPoint, end: StrategyPoint): string {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = 18;
  const left = {
    x: end.x - headLength * Math.cos(angle - Math.PI / 7),
    y: end.y - headLength * Math.sin(angle - Math.PI / 7),
  };
  const right = {
    x: end.x - headLength * Math.cos(angle + Math.PI / 7),
    y: end.y - headLength * Math.sin(angle + Math.PI / 7),
  };
  return `${pointToString(end)} ${pointToString(left)} ${pointToString(right)}`;
}

function renderFieldBackground(): ReactElement {
  return (
    <g>
      <defs>
        <clipPath id="strategy-field-clip">
          <rect x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} rx={24} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} rx={24} fill="#ffffff" />
      <image
        href="/strategy-field-2026.png"
        x={0}
        y={0}
        width={BOARD_WIDTH}
        height={BOARD_HEIGHT}
        preserveAspectRatio="none"
        clipPath="url(#strategy-field-clip)"
      />
      <rect
        x={0}
        y={0}
        width={BOARD_WIDTH}
        height={BOARD_HEIGHT}
        rx={24}
        fill="none"
        stroke="rgba(15, 23, 42, 0.35)"
        strokeWidth={2}
      />
    </g>
  );
}

function renderGridBackground(): ReactElement {
  const lines: ReactElement[] = [];
  for (let x = 0; x <= BOARD_WIDTH; x += 50) {
    lines.push(
      <line
        key={`grid_x_${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={BOARD_HEIGHT}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={x % 100 === 0 ? 1.5 : 1}
      />,
    );
  }
  for (let y = 0; y <= BOARD_HEIGHT; y += 50) {
    lines.push(
      <line
        key={`grid_y_${y}`}
        x1={0}
        y1={y}
        x2={BOARD_WIDTH}
        y2={y}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={y % 100 === 0 ? 1.5 : 1}
      />,
    );
  }
  return (
    <g>
      <rect x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} rx={24} fill="#0d1320" />
      {lines}
      <text x={26} y={36} fill="rgba(255,255,255,0.42)" fontSize={16} fontWeight={700}>
        Blank Grid
      </text>
    </g>
  );
}

function renderShape(shape: StrategyShape): ReactElement {
  if (shape.kind === 'pen') {
    return (
      <g key={shape.id} data-shape-id={shape.id}>
        <polyline
          fill="none"
          stroke={shape.color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={shape.strokeWidth}
          points={shape.points.map(pointToString).join(' ')}
        />
      </g>
    );
  }
  if (shape.kind === 'text') {
    return (
      <g key={shape.id} data-shape-id={shape.id}>
        <text
          x={shape.position.x}
          y={shape.position.y}
          fill={shape.color}
          fontSize={shape.fontSize}
          fontWeight={700}
        >
          {shape.text}
        </text>
      </g>
    );
  }
  if (shape.kind === 'line') {
    return (
      <g key={shape.id} data-shape-id={shape.id}>
        <line
          x1={shape.start.x}
          y1={shape.start.y}
          x2={shape.end.x}
          y2={shape.end.y}
          stroke={shape.color}
          strokeLinecap="round"
          strokeWidth={shape.strokeWidth}
        />
      </g>
    );
  }
  if (shape.kind === 'arrow') {
    return (
      <g key={shape.id} data-shape-id={shape.id}>
        <line
          x1={shape.start.x}
          y1={shape.start.y}
          x2={shape.end.x}
          y2={shape.end.y}
          stroke={shape.color}
          strokeLinecap="round"
          strokeWidth={shape.strokeWidth}
        />
        <polygon points={buildArrowHead(shape.start, shape.end)} fill={shape.color} />
      </g>
    );
  }
  if (shape.kind === 'rectangle') {
    const rect = normalizeRect(shape.start, shape.end);
    return (
      <g key={shape.id} data-shape-id={shape.id}>
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill="none"
          stroke={shape.color}
          strokeWidth={shape.strokeWidth}
          rx={10}
        />
      </g>
    );
  }
  const radius = distance(shape.start, shape.end);
  return (
    <g key={shape.id} data-shape-id={shape.id}>
      <circle
        cx={shape.start.x}
        cy={shape.start.y}
        r={radius}
        fill="none"
        stroke={shape.color}
        strokeWidth={shape.strokeWidth}
      />
    </g>
  );
}
export default function StrategyBoard({
  title,
  board,
  activeTool,
  strokeColor,
  strokeWidth,
  onCommit,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
}: StrategyBoardProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const interactionRef = useRef<StrategyInteraction | null>(null);
  const [draftShape, setDraftShape] = useState<StrategyShape | null>(null);
  const [draftMarkers, setDraftMarkers] = useState<StrategyMarker[] | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const markers = draftMarkers ?? board.markers;
  const boardCursor = useMemo(() => {
    if (activeTool === 'pen') return 'crosshair';
    if (activeTool === 'eraser') return 'not-allowed';
    if (activeTool === 'text') return 'text';
    return 'crosshair';
  }, [activeTool]);
  useEffect(() => {
    function syncFullscreenState() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  function eventPoint(event: ReactPointerEvent<SVGSVGElement>): StrategyPoint {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * BOARD_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * BOARD_HEIGHT;
    return {
      x: clamp(x, 0, BOARD_WIDTH),
      y: clamp(y, 0, BOARD_HEIGHT),
    };
  }

  function pushShape(shape: StrategyShape) {
    onCommit({
      ...board,
      shapes: [...board.shapes, shape],
    });
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const target = event.target as Element | null;
    const markerNode = target?.closest?.('[data-marker-id]');
    if (markerNode) {
      const markerId = markerNode.getAttribute('data-marker-id');
      if (!markerId) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      interactionRef.current = { kind: 'marker', markerId };
      setDraftMarkers(board.markers.map((marker) => ({ ...marker })));
      return;
    }
    const shapeNode = target?.closest?.('[data-shape-id]');
    if (activeTool === 'eraser') {
      const shapeId = shapeNode?.getAttribute('data-shape-id');
      if (!shapeId) return;
      event.preventDefault();
      onCommit({
        ...board,
        shapes: board.shapes.filter((shape) => shape.id !== shapeId),
      });
      return;
    }
    const point = eventPoint(event);
    const shapeId = `${title.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (activeTool === 'text') {
      const text = window.prompt(`${title} text`, '');
      if (!text) return;
      pushShape({
        id: shapeId,
        kind: 'text',
        color: strokeColor,
        fontSize: 22,
        position: point,
        text,
      });
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (activeTool === 'pen') {
      interactionRef.current = {
        kind: 'shape',
        tool: activeTool,
        start: point,
      };
      setDraftShape({
        id: shapeId,
        kind: 'pen',
        color: strokeColor,
        strokeWidth,
        points: [point],
      });
      return;
    }
    interactionRef.current = {
      kind: 'shape',
      tool: activeTool,
      start: point,
    };
    setDraftShape({
      id: shapeId,
      kind: activeTool,
      color: strokeColor,
      strokeWidth,
      start: point,
      end: point,
    });
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const interaction = interactionRef.current;
    if (!interaction) return;
    const point = eventPoint(event);
    if (interaction.kind === 'marker') {
      setDraftMarkers((prev) =>
        (prev ?? board.markers).map((marker) =>
          marker.id === interaction.markerId ? { ...marker, x: point.x, y: point.y } : marker,
        ),
      );
      return;
    }
    if (interaction.tool === 'pen') {
      setDraftShape((prev) => {
        if (prev?.kind !== 'pen') return prev;
        return {
          ...prev,
          points: [...prev.points, point],
        };
      });
      return;
    }
    setDraftShape((prev) => {
      if (!prev || prev.kind === 'pen' || prev.kind === 'text') return prev;
      return {
        ...prev,
        end: point,
      };
    });
  }

  function handlePointerUp() {
    const interaction = interactionRef.current;
    interactionRef.current = null;
    if (!interaction) return;
    if (interaction.kind === 'marker') {
      if (draftMarkers) {
        onCommit({
          ...board,
          markers: draftMarkers,
        });
      }
      setDraftMarkers(null);
      return;
    }
    if (draftShape?.kind === 'pen') {
      if (draftShape.points.length >= 2) pushShape(draftShape);
      setDraftShape(null);
      return;
    }
    if (draftShape?.kind && draftShape.kind !== 'text') {
      if (distance(draftShape.start, draftShape.end) >= 4) pushShape(draftShape);
      setDraftShape(null);
    }
  }

  function commitBackground(background: StrategyBoardBackground) {
    if (board.background === background) return;
    onCommit({
      ...board,
      background,
    });
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === containerRef.current) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenElement) await document.exitFullscreen();
      await containerRef.current?.requestFullscreen?.();
    } catch {
      // Ignore fullscreen API failures and leave board usable in normal mode.
    }
  }
  return (
    <div ref={containerRef} className="panel strategy-board-panel" style={{ padding: 16 }}>
      <div
        className="strategy-screen-only"
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 18 }}>{title}</div>
        <span className="badge">Tool: {activeTool}</span>
        <button
          className="button"
          onClick={() => commitBackground('field')}
          style={{
            background: board.background === 'field' ? '#182336' : undefined,
          }}
        >
          Field
        </button>
        <button
          className="button"
          onClick={() => commitBackground('grid')}
          style={{
            background: board.background === 'grid' ? '#182336' : undefined,
          }}
        >
          Blank Grid
        </button>
        <button className="button" onClick={onUndo} disabled={!canUndo}>
          Undo
        </button>
        <button className="button" onClick={onRedo} disabled={!canRedo}>
          Redo
        </button>
        <button className="button" onClick={onClear}>
          Clear
        </button>
        <button className="button" onClick={toggleFullscreen}>
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      </div>

      <div className="strategy-board-shell">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
          className="strategy-board-svg"
          style={{ cursor: boardCursor }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {board.background === 'field' ? renderFieldBackground() : renderGridBackground()}
          {board.shapes.map(renderShape)}
          {draftShape ? renderShape(draftShape) : null}
          {markers.map((marker) => (
            <g
              key={marker.id}
              data-marker-id={marker.id}
              transform={`translate(${marker.x}, ${marker.y})`}
              style={{ cursor: 'grab' }}
            >
              <circle
                r={30}
                fill={marker.alliance === 'red' ? 'rgba(217,76,76,0.92)' : 'rgba(63,121,255,0.92)'}
                stroke="#ffffff"
                strokeWidth={3}
              />
              <text
                y={5}
                textAnchor="middle"
                fill="#ffffff"
                fontSize={16}
                fontWeight={900}
                pointerEvents="none"
              >
                {marker.teamNumber}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
