import { useCallback, useRef, useState } from "react";

/**
 * WhatsApp-style swipe-left gesture on a scroll container.
 * Returns a `dragX` (0..max) that consumers apply as translateX(-dragX)
 * to reveal a right-side info panel while dragging. Snaps back to 0 on release.
 *
 * Also exposes an `onClickCapture` blocker so a swipe doesn't trigger a click
 * on the underlying element (e.g. image link, download button).
 */
export function useSwipeReveal(max = 110) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const startX = useRef(0);
  const startY = useRef(0);
  const locked = useRef<"h" | "v" | null>(null);
  const justSwiped = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    locked.current = null;
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX.current;
      const dy = e.clientY - startY.current;
      if (!locked.current) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          locked.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
        }
      }
      if (locked.current === "h") {
        // swipe left (dx negative) reveals right-side info
        const reveal = Math.max(0, Math.min(max, -dx));
        setDragX(reveal);
      }
    },
    [dragging, max],
  );

  const end = useCallback(() => {
    if (locked.current === "h" && dragX > 6) {
      justSwiped.current = true;
      window.setTimeout(() => {
        justSwiped.current = false;
      }, 300);
    }
    setDragging(false);
    setDragX(0);
    locked.current = null;
  }, [dragX]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (justSwiped.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return {
    dragX,
    dragging,
    max,
    containerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onClickCapture,
      style: { touchAction: "pan-y" as const },
    },
  };
}
