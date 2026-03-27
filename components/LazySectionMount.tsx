'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

type LazySectionMountProps = {
  children: ReactNode;
  placeholderHeight?: number;
};

export default function LazySectionMount({
  children,
  placeholderHeight = 180,
}: LazySectionMountProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) {
      return;
    }

    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      const frame = window.requestAnimationFrame(() => setMounted(true));
      return () => window.cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);

  return (
    <div ref={ref}>
      {mounted ? (
        children
      ) : (
        <div className="panel-2" style={{ minHeight: placeholderHeight, padding: 16 }} />
      )}
    </div>
  );
}
