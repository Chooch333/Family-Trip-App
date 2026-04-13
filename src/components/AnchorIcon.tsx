"use client";
import React, { useState } from "react";

interface AnchorIconProps {
  isAnchored: boolean;
  onToggle: () => void;
  size?: number;
}

export default function AnchorIcon({ isAnchored, onToggle, size = 28 }: AnchorIconProps) {
  const [animating, setAnimating] = useState(false);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    setAnimating(true);
    onToggle();
    setTimeout(() => setAnimating(false), 200);
  }

  const scale = animating ? 1.15 : 1;

  return (
    <button
      onClick={handleClick}
      aria-label={isAnchored ? "Remove anchor" : "Set as anchor"}
      className="flex-shrink-0 flex items-center justify-center"
      style={{
        width: size,
        height: size,
        transform: `scale(${scale})`,
        transition: "transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        cursor: "pointer",
        background: "none",
        border: "none",
        padding: 0,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={isAnchored ? "-4 -4 44 44" : "0 0 36 36"}
        fill="none"
      >
        {isAnchored && (
          <circle cx="18" cy="18" r="20" fill="#E1F5EE" stroke="#9FE1CB" strokeWidth="1" />
        )}
        <circle
          cx="18"
          cy="6"
          r="3.5"
          stroke={isAnchored ? "#0F6E56" : "#B4B2A9"}
          strokeWidth={isAnchored ? 2 : 1.5}
          fill={isAnchored ? "#1D9E75" : "none"}
        />
        <line
          x1="12" y1="12" x2="24" y2="12"
          stroke={isAnchored ? "#0F6E56" : "#B4B2A9"}
          strokeWidth={isAnchored ? 2 : 1.5}
          strokeLinecap="round"
        />
        <line
          x1="18" y1="9.5" x2="18" y2="31"
          stroke={isAnchored ? "#0F6E56" : "#B4B2A9"}
          strokeWidth={isAnchored ? 2 : 1.5}
          strokeLinecap="round"
        />
        <path
          d="M9 20Q9 28 18 31Q27 28 27 20"
          stroke={isAnchored ? "#0F6E56" : "#B4B2A9"}
          strokeWidth={isAnchored ? 2 : 1.5}
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </button>
  );
}
