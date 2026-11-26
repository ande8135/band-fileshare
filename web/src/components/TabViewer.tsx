// Read-only Guitar Pro viewer: renders the tab with alphaTab and plays it back through
// alphaTab's built-in MIDI synthesizer. Loaded lazily (see TabViewerLauncher), so the
// ~1 MB library, notation font and soundfont are only fetched when someone opens a tab.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as alphaTab from "@coderline/alphatab";
import { api } from "../lib/api";
import { Button, Tile } from "./ui";
import { Icon } from "./Icon";

type Track = alphaTab.model.Track;
type Status = "loading" | "rendering" | "ready" | "error";
/** Per-track playback settings. Only affect what this browser plays; the file is never changed. */
type Mix = { mute: boolean; solo: boolean; volume: number };
const ALL = -1; // track picker value for "show every track"

const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5];
const ZOOMS = [0.75, 0.9, 1, 1.15, 1.3, 1.5];

const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export interface TabViewerProps {
  fileId: string;
  version: number;
  name: string;
  isCurrent: boolean;
  onClose: () => void;
}

export default function TabViewer({ fileId, version, name, isCurrent, onClose }: TabViewerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const at = useRef<alphaTab.AlphaTabApi | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [meta, setMeta] = useState({ title: "", artist: "" });
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackIndex, setTrackIndex] = useState(0);
  const [soundProgress, setSoundProgress] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState({ current: 0, end: 0 });
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [horizontal, setHorizontal] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [loop, setLoop] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [mix, setMix] = useState<Mix[]>([]);
  const [mixerOpen, setMixerOpen] = useState(false);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  // Create alphaTab, fetch the file through a presigned URL, and wire up events.
  useEffect(() => {
    let cancelled = false;
    const fail = (e: unknown) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    };

    const a = new alphaTab.AlphaTabApi(surface.current!, {
      core: { engine: "svg", logLevel: "warning", fontDirectory: "/font/" },
      display: { layoutMode: alphaTab.LayoutMode.Page, scale: 1 },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
        soundFont: "/soundfont/sonivox.sf3",
        scrollElement: scroller.current!,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        // Clicking a beat moves the playback position. Nothing in the viewer can edit the score.
        enableUserInteraction: true,
      },
    });
    at.current = a;

    a.scoreLoaded.on((score) => {
      setTracks(score.tracks);
      // Start from the mute/solo state saved in the Guitar Pro file.
      setMix(score.tracks.map((t) => ({ mute: t.playbackInfo.isMute, solo: t.playbackInfo.isSolo, volume: 1 })));
      setMeta({ title: score.title, artist: score.artist });
    });
    a.renderStarted.on(() => setStatus((s) => (s === "ready" ? s : "rendering")));
    a.renderFinished.on(() => setStatus("ready"));
    a.error.on(() => fail(new Error("This file couldn't be read as a Guitar Pro tab.")));
    a.soundFontLoad.on((e) => setSoundProgress(e.total ? e.loaded / e.total : 0));
    a.playerReady.on(() => setPlayerReady(true));
    a.playerStateChanged.on((e) => setPlaying(e.state === alphaTab.synth.PlayerState.Playing));
    a.playerPositionChanged.on((e) =>
      // Position events fire many times a second; only re-render when the shown second changes.
      setPos((p) => (Math.floor(p.current / 1000) === Math.floor(e.currentTime / 1000) && p.end === e.endTime ? p : { current: e.currentTime, end: e.endTime })));

    (async () => {
      try {
        const { url } = await api<{ url: string }>("GET", `/files/${fileId}/versions/${version}/download`);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Couldn't download the file (${r.status})`);
        const data = new Uint8Array(await r.arrayBuffer());
        if (cancelled) return;
        a.load(data, [0]);
      } catch (e) { fail(e); }
    })();

    return () => {
      cancelled = true;
      a.destroy(); // stops playback and releases audio + workers
      at.current = null;
    };
  }, [fileId, version]);

  const rerender = (fn: (s: alphaTab.Settings) => void) => {
    const a = at.current;
    if (!a) return;
    fn(a.settings);
    a.updateSettings();
    a.render();
  };

  const selectTrack = (i: number) => {
    if (!at.current) return;
    const shown = i === ALL ? tracks : tracks[i] ? [tracks[i]] : [];
    if (!shown.length) return;
    setTrackIndex(i);
    at.current.renderTracks(shown); // display only; every track still plays unless muted
  };

  const updateMix = (i: number, patch: Partial<Mix>) => {
    const a = at.current;
    const t = tracks[i];
    if (!a || !t) return;
    if (patch.mute !== undefined) a.changeTrackMute([t], patch.mute);
    if (patch.solo !== undefined) a.changeTrackSolo([t], patch.solo);
    if (patch.volume !== undefined) a.changeTrackVolume([t], patch.volume);
    setMix((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };

  const resetMix = () => {
    const a = at.current;
    if (!a || !tracks.length) return;
    a.changeTrackMute(tracks, false);
    a.changeTrackSolo(tracks, false);
    a.changeTrackVolume(tracks, 1);
    setMix(tracks.map(() => ({ mute: false, solo: false, volume: 1 })));
  };

  const anySolo = mix.some((m) => m.solo);
  const mixChanged = mix.some((m) => m.mute || m.solo || m.volume !== 1);

  const onKey = (e: KeyboardEvent) => {
    // Space toggles playback unless a control has focus.
    if (e.key === " " && !/SELECT|INPUT|BUTTON/.test((e.target as HTMLElement).tagName) && playerReady) {
      e.preventDefault();
      at.current?.playPause();
    }
  };

  const seek = (clientX: number, bar: HTMLElement) => {
    const a = at.current;
    if (!a || !pos.end) return;
    const r = bar.getBoundingClientRect();
    a.timePosition = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * pos.end;
  };

  const loadingLabel =
    status === "loading" ? "Loading tab…"
      : status === "rendering" ? "Rendering…"
        : !playerReady ? `Loading sounds ${Math.round(soundProgress * 100)}%` : "";

  return (
    <dialog ref={dialog} className="tabviewer" onClose={onClose} onKeyDown={onKey} aria-label={`Preview of ${name}`}
      // Escape closes the mixer first, then the viewer.
      onCancel={(e) => { if (mixerOpen) { e.preventDefault(); setMixerOpen(false); } }}>
      <header className="tv-head">
        <Tile node={{ type: "file", name }} />
        <div className="tv-title">
          <h2>{meta.title || name}</h2>
          <p className="sub">
            {[meta.artist, `v${version}${isCurrent ? " (current)" : ""}`, meta.title && meta.title !== name ? name : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="tv-readonly"><Icon name="eye" />Preview only</span>
        <Button icon="x" title="Close preview" onClick={() => dialog.current?.close()} />
      </header>

      <div className="tv-bar" role="toolbar" aria-label="Playback">
        <div className="tv-group">
          <Button icon={playing ? "pause" : "play"} kind="primary" title={playing ? "Pause (space)" : "Play (space)"} disabled={!playerReady} onClick={() => at.current?.playPause()} className="tv-play" />
          <Button icon="stop" title="Stop" disabled={!playerReady} onClick={() => at.current?.stop()} />
          <span className="tv-time num">{fmtTime(pos.current)} / {fmtTime(pos.end)}</span>
        </div>

        <div className="tv-progress" role="slider" aria-label="Playback position" aria-valuemin={0} aria-valuemax={Math.round(pos.end / 1000)}
          aria-valuenow={Math.round(pos.current / 1000)} tabIndex={0}
          onPointerDown={(e) => seek(e.clientX, e.currentTarget)}>
          <span style={{ width: pos.end ? `${(pos.current / pos.end) * 100}%` : 0 }} />
        </div>

        <div className="tv-group tv-options">
          {tracks.length > 1 && (
            <select className="input sm" aria-label="Track" value={trackIndex} onChange={(e) => selectTrack(Number(e.target.value))}>
              {tracks.map((t, i) => <option key={i} value={i}>{t.name || `Track ${i + 1}`}</option>)}
              <option value={ALL}>All tracks</option>
            </select>
          )}
          {tracks.length > 0 && (
            <Button label="Mixer" icon="sliders" size="sm" aria-expanded={mixerOpen} aria-controls="tv-mixer"
              className={mixerOpen || mixChanged ? "tv-on" : ""} onClick={() => setMixerOpen((o) => !o)} />
          )}
          <select className="input sm" aria-label="Speed" value={speed}
            onChange={(e) => { const v = Number(e.target.value); setSpeed(v); if (at.current) at.current.playbackSpeed = v; }}>
            {SPEEDS.map((s) => <option key={s} value={s}>{Math.round(s * 100)}% speed</option>)}
          </select>
          <Toggle on={metronome} icon="metronome" title="Metronome"
            onChange={(v) => { setMetronome(v); if (at.current) at.current.metronomeVolume = v ? 1 : 0; }} />
          <Toggle on={countIn} icon="timer" title="Count-in"
            onChange={(v) => { setCountIn(v); if (at.current) at.current.countInVolume = v ? 1 : 0; }} />
          <Toggle on={loop} icon="repeat" title="Loop"
            onChange={(v) => { setLoop(v); if (at.current) at.current.isLooping = v; }} />
          <label className="tv-volume" title="Volume">
            <Icon name="volume" />
            <input type="range" min={0} max={1} step={0.05} value={volume} aria-label="Volume"
              onChange={(e) => { const v = Number(e.target.value); setVolume(v); if (at.current) at.current.masterVolume = v; }} />
          </label>
          <select className="input sm" aria-label="Zoom" value={zoom}
            onChange={(e) => { const v = Number(e.target.value); setZoom(v); rerender((s) => { s.display.scale = v; }); }}>
            {ZOOMS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
          </select>
          <Toggle on={horizontal} icon="columns" title="Single-line layout"
            onChange={(v) => { setHorizontal(v); rerender((s) => { s.display.layoutMode = v ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page; }); }} />
        </div>
      {mixerOpen && (
        <div id="tv-mixer" className="tv-mixer" role="group" aria-label="Mixer">
          <div className="tv-mixer-head">
            <strong>Mixer</strong>
            <span className="hint">Only changes what you hear</span>
            <Button label="Reset" size="sm" disabled={!mixChanged} onClick={resetMix} />
            <Button icon="x" size="sm" title="Close mixer" onClick={() => setMixerOpen(false)} />
          </div>
          {tracks.map((t, i) => {
            const m = mix[i] ?? { mute: false, solo: false, volume: 1 };
            const silent = m.mute || (anySolo && !m.solo);
            return (
              <div key={i} className={`tv-mix-row${silent ? " silent" : ""}`}>
                <span className="tv-mix-name" title={t.name}>{t.name || `Track ${i + 1}`}</span>
                <button className={`tv-ms mute${m.mute ? " on" : ""}`} aria-pressed={m.mute} title={m.mute ? "Unmute" : "Mute"}
                  onClick={() => updateMix(i, { mute: !m.mute })}>M</button>
                <button className={`tv-ms solo${m.solo ? " on" : ""}`} aria-pressed={m.solo} title={m.solo ? "Unsolo" : "Solo (hear only this)"}
                  onClick={() => updateMix(i, { solo: !m.solo })}>S</button>
                <Icon name={silent ? "volumeOff" : "volume"} className="tv-mix-icon" />
                <input type="range" min={0} max={1.5} step={0.05} value={m.volume} aria-label={`${t.name} volume`}
                  onChange={(e) => updateMix(i, { volume: Number(e.target.value) })} />
                <span className="tv-mix-pct num">{Math.round(m.volume * 100)}%</span>
              </div>
            );
          })}
        </div>
      )}
      </div>

      <div className="tv-scroll" ref={scroller}>
        {status === "error" ? (
          <div className="tv-message"><Icon name="alert" /><p>{error}</p></div>
        ) : (
          loadingLabel && <div className="tv-status" aria-live="polite"><span className="tv-spinner" />{loadingLabel}</div>
        )}
        {/* alphaTab renders into this white "paper" so the notation reads well in dark mode too. */}
        <div className={`tv-paper${status === "error" ? " hidden" : ""}`}>
          <div ref={surface} />
        </div>
      </div>
    </dialog>
  );
}

function Toggle({ on, icon, title, onChange }: { on: boolean; icon: Parameters<typeof Icon>[0]["name"]; title: string; onChange: (on: boolean) => void }) {
  return <Button icon={icon} title={title} aria-pressed={on} className={on ? "tv-on" : ""} onClick={() => onChange(!on)} />;
}
