"use client";
import { ZOOM, ZoomKey } from "./Timeline";

type Props = {
  zoom: ZoomKey;
  onChange: (z: ZoomKey) => void;
};

export default function ZoomControl({ zoom, onChange }: Props) {
  return (
    <div className="zoom-ctl">
      {(Object.entries(ZOOM) as [ZoomKey, typeof ZOOM["day"]][]).map(([k, z]) => (
        <button
          key={k}
          className={zoom === k ? "on" : ""}
          onClick={() => onChange(k)}
        >
          {z.label}
        </button>
      ))}
    </div>
  );
}
