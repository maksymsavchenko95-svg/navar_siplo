"use client";

import { useEffect, useState } from "react";

import { LANDING_CONTENT, type StatItem } from "@/lib/landing-content";
import { useInView } from "@/lib/useInView";

function AnimatedStatTile({
  item,
  triggerAnimation,
}: {
  item: StatItem;
  triggerAnimation: boolean;
}) {
  const [currentValue, setCurrentValue] = useState(0);

  useEffect(() => {
    if (!triggerAnimation) return;

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setCurrentValue(item.value);
      return;
    }

    let startTime: number | null = null;
    const duration = 1400;

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setCurrentValue(Math.round(ease * item.value));

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };

    const animFrame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animFrame);
  }, [triggerAnimation, item.value]);

  return (
    <div className="stats-tile">
      <div className="stats-number-row">
        {item.prefix && <span className="stats-prefix">{item.prefix}</span>}
        <span className="stats-number">{triggerAnimation ? currentValue : 0}</span>
        {item.suffix && <span className="stats-suffix">{item.suffix}</span>}
      </div>
      <div className="stats-label">{item.label}</div>
      <div className="stats-sublabel">{item.sublabel}</div>
    </div>
  );
}

export function StatsBand() {
  const { ref, isInView } = useInView({ threshold: 0.2 });

  return (
    <section className="landing-stats-section" ref={ref} aria-label="Ключові показники проєкту">
      <div className="landing-stats-grid">
        {LANDING_CONTENT.stats.map((stat, idx) => (
          <AnimatedStatTile key={idx} item={stat} triggerAnimation={isInView} />
        ))}
      </div>
    </section>
  );
}
