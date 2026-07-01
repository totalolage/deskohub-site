"use client";

import {
  type PanInfo,
  useDragControls,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

type UseMotionSwipeCarouselOptions = {
  count: number;
  autoPlayInterval?: number;
};

export const swipeTimelineThreshold = 0.32;
export const swipeVelocityThreshold = 520;
export const swipeClickSuppressionDistance = 8;
export const clickSuppressionAfterSwipeMs = 180;

export const wrapIndex = (index: number, length: number) => {
  if (length <= 0) return 0;

  return ((index % length) + length) % length;
};

export const getClosestVirtualIndex = (
  targetIndex: number,
  currentVirtualIndex: number,
  length: number
) => {
  if (length <= 0) return currentVirtualIndex;

  const currentLogicalIndex = wrapIndex(currentVirtualIndex, length);
  let delta = targetIndex - currentLogicalIndex;

  if (delta > length / 2) delta -= length;
  if (delta < -length / 2) delta += length;

  return currentVirtualIndex + delta;
};

export const truncateTowardZero = (value: number) =>
  value < 0 ? Math.ceil(value) : Math.floor(value);

export const getSwipeTargetVirtualIndex = ({
  currentVirtualIndex,
  offsetX,
  offsetY,
  swipeDistance,
  velocityX,
}: {
  currentVirtualIndex: number;
  offsetX: number;
  offsetY: number;
  swipeDistance: number;
  velocityX: number;
}) => {
  if (swipeDistance <= 0) return currentVirtualIndex;

  const rawTimelineOffset = -offsetX / swipeDistance;
  const wholeSteps = truncateTowardZero(rawTimelineOffset);
  const fractionalOffset = rawTimelineOffset - wholeSteps;
  const isHorizontalDrag =
    Math.abs(offsetX) >= swipeClickSuppressionDistance &&
    Math.abs(offsetX) > Math.abs(offsetY);
  let nextIndex = currentVirtualIndex + wholeSteps;

  if (!isHorizontalDrag) return currentVirtualIndex;

  if (
    fractionalOffset >= swipeTimelineThreshold ||
    velocityX <= -swipeVelocityThreshold
  ) {
    nextIndex += 1;
  } else if (
    fractionalOffset <= -swipeTimelineThreshold ||
    velocityX >= swipeVelocityThreshold
  ) {
    nextIndex -= 1;
  }

  return nextIndex;
};

export function useMotionSwipeCarousel({
  count,
  autoPlayInterval,
}: UseMotionSwipeCarouselOptions) {
  const shouldReduceMotion = useReducedMotion();
  const [virtualIndex, setVirtualIndex] = useState(0);
  const [swipeTimelineOffset, setSwipeTimelineOffset] = useState(0);
  const [isPointerOver, setIsPointerOver] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragControls = useDragControls();
  const dragX = useMotionValue(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const virtualIndexRef = useRef(virtualIndex);
  const dragStartVirtualIndexRef = useRef(virtualIndex);
  const lastSwipeAtRef = useRef(0);
  const canSwipe = count > 1;
  const isPaused = isPointerOver || isFocusWithin || isDragging;
  const visibleVirtualIndex = virtualIndex + swipeTimelineOffset;
  const activeIndex =
    count > 0 ? wrapIndex(Math.round(visibleVirtualIndex), count) : 0;
  const isSwiping = swipeTimelineOffset !== 0;

  useEffect(() => {
    virtualIndexRef.current = virtualIndex;
  }, [virtualIndex]);

  useEffect(() => {
    if (!canSwipe || isPaused || shouldReduceMotion || !autoPlayInterval)
      return;

    const interval = setInterval(() => {
      setVirtualIndex((index) => {
        const nextIndex = index + 1;

        virtualIndexRef.current = nextIndex;

        return nextIndex;
      });
    }, autoPlayInterval);

    return () => clearInterval(interval);
  }, [autoPlayInterval, canSwipe, isPaused, shouldReduceMotion]);

  const moveToVirtualIndex = (nextIndex: number) => {
    if (count <= 0) return;

    virtualIndexRef.current = nextIndex;
    setVirtualIndex(nextIndex);
    setSwipeTimelineOffset(0);
  };
  const moveToIndex = (nextIndex: number) => {
    if (count <= 0) return;

    moveToVirtualIndex(
      getClosestVirtualIndex(nextIndex, virtualIndexRef.current, count)
    );
  };
  const getSwipeTimelineDistance = () => {
    const stageWidth = stageRef.current?.clientWidth ?? 0;

    return Math.max(96, Math.min(stageWidth * 0.28, 260));
  };
  const resetDragCarrier = () => {
    dragX.stop();
    dragX.set(0);
  };
  const applyDragOffset = (offsetX: number) => {
    const rawTimelineOffset = -offsetX / getSwipeTimelineDistance();
    const wholeSteps = truncateTowardZero(rawTimelineOffset);
    const fractionalOffset = rawTimelineOffset - wholeSteps;
    const nextIndex = dragStartVirtualIndexRef.current + wholeSteps;

    if (nextIndex !== virtualIndexRef.current) {
      virtualIndexRef.current = nextIndex;
      setVirtualIndex(nextIndex);
    }

    setSwipeTimelineOffset(fractionalOffset);
  };
  const startDrag = (event: ReactPointerEvent) => {
    if (!canSwipe || event.button !== 0) return;

    dragControls.start(event);
  };
  const handleDragStart = () => {
    if (!canSwipe) return;

    dragStartVirtualIndexRef.current = virtualIndexRef.current;
    resetDragCarrier();
    setIsDragging(true);
    setSwipeTimelineOffset(0);
  };
  const handleDragMove = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (!canSwipe) return;

    const absX = Math.abs(info.offset.x);
    const absY = Math.abs(info.offset.y);

    if (absX <= absY) {
      setSwipeTimelineOffset(0);
      return;
    }

    if (absX >= swipeClickSuppressionDistance) {
      lastSwipeAtRef.current = Date.now();
    }

    applyDragOffset(info.offset.x);
  };
  const handleDragEnd = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (!canSwipe) return;

    const isHorizontalDrag =
      Math.abs(info.offset.x) >= swipeClickSuppressionDistance &&
      Math.abs(info.offset.x) > Math.abs(info.offset.y);
    const nextIndex = getSwipeTargetVirtualIndex({
      currentVirtualIndex: dragStartVirtualIndexRef.current,
      offsetX: info.offset.x,
      offsetY: info.offset.y,
      swipeDistance: getSwipeTimelineDistance(),
      velocityX: info.velocity.x,
    });

    if (isHorizontalDrag) lastSwipeAtRef.current = Date.now();

    moveToVirtualIndex(nextIndex);
    resetDragCarrier();
    setIsDragging(false);
  };
  const shouldSuppressClickAfterSwipe = () =>
    Date.now() - lastSwipeAtRef.current < clickSuppressionAfterSwipeMs;

  return {
    activeIndex,
    canSwipe,
    dragControls,
    dragX,
    handleDragEnd,
    handleDragMove,
    handleDragStart,
    isFocusWithin,
    isPaused,
    isPointerOver,
    isSwiping,
    moveToIndex,
    moveToVirtualIndex,
    setIsFocusWithin,
    setIsPointerOver,
    shouldReduceMotion,
    shouldSuppressClickAfterSwipe,
    stageRef,
    startDrag,
    swipeTimelineOffset,
    virtualIndex,
    visibleVirtualIndex,
  };
}
