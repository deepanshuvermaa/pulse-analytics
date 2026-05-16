import { useEffect, useRef, useState } from 'react';

export default function BoomerangVideoBg({ src, className }: { src: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const framesRef = useRef<HTMLCanvasElement[]>([]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const frames: HTMLCanvasElement[] = [];
    let capturing = true, lastTime = -1;

    const capture = () => {
      if (!capturing || video.readyState < 2 || video.currentTime === lastTime) return;
      lastTime = video.currentTime;
      const scale = Math.min(1, 960 / video.videoWidth);
      const w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(video, 0, 0, w, h);
      frames.push(c);
    };

    const onEnded = () => { capturing = false; if (frames.length) { framesRef.current = frames; setReady(true); } };
    const onLoaded = () => { video.play().catch(() => {}); const loop = () => { capture(); if (capturing) requestAnimationFrame(loop); }; requestAnimationFrame(loop); };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('ended', onEnded);
    if (video.readyState >= 1) onLoaded();
    return () => { capturing = false; video.removeEventListener('loadedmetadata', onLoaded); video.removeEventListener('ended', onEnded); };
  }, [src]);

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current, frames = framesRef.current;
    if (!canvas || !frames.length) return;
    const ctx = canvas.getContext('2d')!;
    canvas.width = frames[0].width; canvas.height = frames[0].height;
    let i = 0, dir = 1, last = 0, raf = 0;
    const render = (now: number) => {
      if (now - last >= 33) { last = now; ctx.drawImage(frames[i], 0, 0); i += dir; if (i >= frames.length - 1) { i = frames.length - 1; dir = -1; } else if (i <= 0) { i = 0; dir = 1; } }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  return (
    <div className={className ?? 'absolute inset-0 w-full h-full'}>
      <video ref={videoRef} src={src} className="w-full h-full object-cover" style={{ display: ready ? 'none' : 'block' }} muted playsInline preload="auto" crossOrigin="anonymous" />
      <canvas ref={canvasRef} className="w-full h-full object-cover" style={{ display: ready ? 'block' : 'none' }} />
    </div>
  );
}
