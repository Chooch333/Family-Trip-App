"use client";
import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import AnchorIcon from "@/components/AnchorIcon";
import { formatTime12 } from "@/lib/tripHelpers";
import type { Stop } from "@/lib/database.types";

interface SortableStopRowProps {
  stop: Stop;
  dayColor: string;
  isSelected: boolean;
  onClick: () => void;
  refSetter: (el: HTMLDivElement | null) => void;
  isAnchored: boolean;
  onToggleAnchor: () => void;
}

export default function SortableStopRow({
  stop,
  dayColor,
  isSelected,
  onClick,
  refSetter,
  isAnchored,
  onToggleAnchor,
}: SortableStopRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: stop.id });
  const style: React.CSSProperties = {
    transform: isDragging
      ? `${CSS.Transform.toString(transform) || ""} scale(1.02)`
      : CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
    border: isDragging ? "1.5px solid #534AB7" : "1.5px solid transparent",
    borderRadius: isDragging ? 6 : 0,
    backgroundColor: isDragging ? "white" : (isSelected ? "#f9fafb" : "transparent"),
    boxShadow: isDragging ? "0 4px 12px rgba(83, 74, 183, 0.18)" : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: "relative",
    borderBottomWidth: isDragging ? undefined : 0.5,
  };
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        refSetter(el);
      }}
      onClick={onClick}
      className="flex items-stretch border-b border-gray-100 cursor-pointer transition-colors"
      style={style}
    >
      {isOver && !isDragging && (
        <div
          className="absolute left-0 right-0 pointer-events-none"
          style={{ top: -1, height: 2, backgroundColor: "#534AB7", zIndex: 5 }}
        />
      )}
      <div
        className="flex-shrink-0 flex items-center justify-center text-gray-300 hover:text-gray-500"
        style={{ width: 18, cursor: isDragging ? "grabbing" : "grab" }}
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
          <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
          <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
          <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
        </svg>
      </div>
      <div className="flex-shrink-0" style={{ width: isAnchored ? 8 : 4, backgroundColor: dayColor, transition: "width 200ms ease" }} />
      <div className="flex-1 min-w-0 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[18px] font-medium text-gray-900 truncate leading-tight">{stop.name}</div>
            <div className="text-[15px] text-gray-500 mt-0.5 truncate">
              {stop.stop_type} · {stop.duration_minutes} min
            </div>
          </div>
          {stop.start_time && (
            <div className="text-[15px] text-gray-400 whitespace-nowrap pt-0.5">{formatTime12(stop.start_time)}</div>
          )}
          <AnchorIcon isAnchored={isAnchored} onToggle={onToggleAnchor} size={28} />
        </div>
        {stop.description && (
          <div className="text-[13px] text-gray-400 mt-1 leading-snug" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {stop.description}
          </div>
        )}
      </div>
    </div>
  );
}