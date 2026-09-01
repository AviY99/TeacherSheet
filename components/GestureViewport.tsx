"use client";

import { PointerEvent as ReactPointerEvent, ReactNode, useRef, useState } from "react";

interface TransformState {
  scale: number;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

interface SingleGesture {
  kind: "single";
  point: Point;
  transform: TransformState;
  startedAt: number;
}

interface PinchGesture {
  kind: "pinch";
  distance: number;
  midpoint: Point;
  transform: TransformState;
}

type GestureStart = SingleGesture | PinchGesture | null;

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const SWIPE_DISTANCE = 52;
const SWIPE_VELOCITY = 0.42;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function GestureViewport({
  children,
  label,
  className = "",
  onSwipePrevious,
  onSwipeNext
}: {
  children: ReactNode;
  label: string;
  className?: string;
  onSwipePrevious?: () => void;
  onSwipeNext?: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const start = useRef<GestureStart>(null);
  const transformRef = useRef<TransformState>({ scale: 1, x: 0, y: 0 });
  const [transform, setTransformState] = useState<TransformState>(transformRef.current);

  function setTransform(next: TransformState) {
    transformRef.current = next;
    setTransformState(next);
  }

  function bounded(next: TransformState): TransformState {
    const viewport = viewportRef.current;
    const scale = clamp(next.scale, MIN_SCALE, MAX_SCALE);
    if (!viewport || scale <= 1.001) return { scale: 1, x: 0, y: 0 };

    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);
    const minX = width - width * scale;
    const minY = height - height * scale;
    return {
      scale,
      x: clamp(next.x, minX, 0),
      y: clamp(next.y, minY, 0)
    };
  }

  function localPoint(event: ReactPointerEvent<HTMLDivElement>): Point {
    const rect = viewportRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left || 0),
      y: event.clientY - (rect?.top || 0)
    };
  }

  function beginPinch() {
    const values = [...pointers.current.values()];
    if (values.length < 2) return;
    start.current = {
      kind: "pinch",
      distance: Math.max(1, distance(values[0], values[1])),
      midpoint: midpoint(values[0], values[1]),
      transform: transformRef.current
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }

    if (pointers.current.size >= 2) {
      beginPinch();
      event.preventDefault();
      return;
    }

    start.current = {
      kind: "single",
      point,
      transform: transformRef.current,
      startedAt: performance.now()
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);

    if (pointers.current.size >= 2) {
      if (!start.current || start.current.kind !== "pinch") beginPinch();
      const pinch = start.current;
      if (!pinch || pinch.kind !== "pinch") return;

      const values = [...pointers.current.values()];
      const currentDistance = Math.max(1, distance(values[0], values[1]));
      const currentMidpoint = midpoint(values[0], values[1]);
      const scale = clamp(pinch.transform.scale * (currentDistance / pinch.distance), MIN_SCALE, MAX_SCALE);

      // Keep the document point that was under the fingers under the current
      // fingers. This makes zoom follow the pinch focal point instead of the centre.
      const contentX = (pinch.midpoint.x - pinch.transform.x) / pinch.transform.scale;
      const contentY = (pinch.midpoint.y - pinch.transform.y) / pinch.transform.scale;
      const x = currentMidpoint.x - contentX * scale;
      const y = currentMidpoint.y - contentY * scale;
      setTransform(bounded({ scale, x, y }));
      event.preventDefault();
      return;
    }

    const single = start.current;
    if (!single || single.kind !== "single") return;
    const dx = point.x - single.point.x;
    const dy = point.y - single.point.y;

    if (transformRef.current.scale > 1.001) {
      setTransform(bounded({
        scale: single.transform.scale,
        x: single.transform.x + dx,
        y: single.transform.y + dy
      }));
      event.preventDefault();
      return;
    }

    // At 1x, horizontal movement belongs to the comparison switch while
    // vertical movement remains native page scrolling.
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.15) event.preventDefault();
  }

  function endPointer(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const point = pointers.current.get(event.pointerId) || localPoint(event);
    const single = start.current;
    const wasSingle = pointers.current.size === 1 && single?.kind === "single";
    pointers.current.delete(event.pointerId);

    if (!cancelled && wasSingle && transformRef.current.scale <= 1.001 && single?.kind === "single") {
      const dx = point.x - single.point.x;
      const dy = point.y - single.point.y;
      const elapsed = Math.max(1, performance.now() - single.startedAt);
      const velocity = Math.abs(dx) / elapsed;
      const horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
      if (horizontal && (Math.abs(dx) >= SWIPE_DISTANCE || velocity >= SWIPE_VELOCITY)) {
        if (dx < 0) onSwipeNext?.();
        else onSwipePrevious?.();
      }
    }

    if (pointers.current.size === 1) {
      const remaining = [...pointers.current.values()][0];
      start.current = {
        kind: "single",
        point: remaining,
        transform: transformRef.current,
        startedAt: performance.now()
      };
    } else {
      start.current = null;
    }
  }

  function zoomAtCenter(nextScale: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const old = transformRef.current;
    const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    if (scale <= 1.001) {
      setTransform({ scale: 1, x: 0, y: 0 });
      return;
    }
    const cx = viewport.clientWidth / 2;
    const cy = viewport.clientHeight / 2;
    const contentX = (cx - old.x) / old.scale;
    const contentY = (cy - old.y) / old.scale;
    setTransform(bounded({
      scale,
      x: cx - contentX * scale,
      y: cy - contentY * scale
    }));
  }

  const zoomed = transform.scale > 1.001;

  return (
    <div className={`gesture-shell ${className}`}>
      <div
        ref={viewportRef}
        className={`gesture-viewport${zoomed ? " is-zoomed" : ""}`}
        aria-label={label}
        style={{ touchAction: zoomed ? "none" : "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endPointer(event)}
        onPointerCancel={(event) => endPointer(event, true)}
        onDoubleClick={() => setTransform({ scale: 1, x: 0, y: 0 })}
      >
        <div
          className="gesture-content"
          style={{ transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})` }}
        >
          {children}
        </div>
      </div>
      <div className="gesture-toolbar" aria-label="בקרת זום">
        <button type="button" onClick={() => zoomAtCenter(transformRef.current.scale / 1.35)} aria-label="הקטן">−</button>
        <span>{Math.round(transform.scale * 100)}%</span>
        <button type="button" onClick={() => zoomAtCenter(transformRef.current.scale * 1.35)} aria-label="הגדל">+</button>
        <button type="button" onClick={() => setTransform({ scale: 1, x: 0, y: 0 })} aria-label="אפס זום">↺</button>
      </div>
    </div>
  );
}
