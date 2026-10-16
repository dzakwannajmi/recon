"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { folderSize } from "./folder-size";

const Folder = dynamic(() => import("@/components/effects/Folder"), { ssr: false });

const INK = "#151515";
const CHARTREUSE = "#b4f03c";
const REDUCED = "(prefers-reduced-motion: reduce)";

function Paper({ n, text }: { n: string; text: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-full flex-col justify-between"
      style={{ padding: "calc(12px * var(--folder-scale))", color: INK }}
    >
      <span
        className="self-start rounded-full"
        style={{
          background: CHARTREUSE,
          fontSize: "calc(20px * var(--folder-scale))",
          lineHeight: 1,
          padding: "calc(6px * var(--folder-scale)) calc(12px * var(--folder-scale))",
        }}
      >
        {n}
      </span>
      <p style={{ fontSize: "max(12px, calc(10.5px * var(--folder-scale)))", lineHeight: 1.3, margin: 0 }}>{text}</p>
    </div>
  );
}

/**
 * The three points as papers in a folder. The folder is plain DOM and CSS (no WebGL), loaded only near the viewport.
 * The server and the first render show the card list (`fallback`); it stays for reduced motion and without JavaScript.
 * Once the folder is on screen the text lives in a screen-reader list, because the folder is one button.
 */
export function ProblemFolder({ points, fallback }: { points: string[]; fallback: ReactNode }) {
  const slot = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [near, setNear] = useState(false);
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState(false);
  const autoOpened = useRef(false);

  useEffect(() => {
    const reduced = window.matchMedia(REDUCED);
    const update = () => setEnabled(!reduced.matches);
    update();
    reduced.addEventListener("change", update);
    return () => reduced.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const el = slot.current;
    if (!el || !enabled || near) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return undefined;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, near]);

  useEffect(() => {
    const el = slot.current;
    if (!el || !enabled || !near) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, near]);

  // Open once, the first time the folder is mostly on screen. After that the visitor decides.
  useEffect(() => {
    const el = slot.current;
    if (!el || !enabled || !near || width === 0 || autoOpened.current) return undefined;
    if (typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (autoOpened.current || !entries.some((e) => e.isIntersecting)) return;
        autoOpened.current = true;
        setOpen(true);
        io.disconnect();
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, near, width]);

  const live = enabled && near && width > 0;

  return (
    <div ref={slot} className="relative flex min-h-[320px] w-full items-center justify-center md:min-h-[460px]">
      {live ? (
        <>
          <ul className="sr-only">
            {points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <Folder
            label="Issuer claims"
            mode="flap"
            layout="spread"
            variant="solid"
            color={INK}
            paperColor="#ffffff"
            tabPosition="left"
            size={folderSize(width)}
            open={open}
            onOpenChange={setOpen}
            peek
            intro={false}
            draggable={false}
            closeOnOutsideClick={false}
            theme="dark"
            items={points.map((text, i) => ({ content: <Paper n={String(i + 1).padStart(2, "0")} text={text} /> }))}
          />
        </>
      ) : (
        fallback
      )}
    </div>
  );
}
