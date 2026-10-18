import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Cloud,
  Heart,
  Moon,
  RotateCcw,
  Sparkles,
  Sprout,
  Utensils,
  Volume2,
  VolumeX,
  Waves,
  X,
} from "lucide-react";
import { request } from "./api";
import { PixelEgg, Sprite } from "./Sprite";
import { personalities, species } from "./types";
import type { PetState, Result } from "./types";

type Page =
  "choose" | "hatch" | "home" | "menu" | "status" | "journal" | "game";
const items = [
  {
    label: "吃点东西",
    hint: "一份香喷喷的小饭团",
    icon: Utensils,
    kind: "feed",
  },
  { label: "一起玩耍", hint: "来接住闪闪的星星", icon: Sparkles, kind: "play" },
  { label: "洗个澡澡", hint: "把小烦恼也洗掉", icon: Waves, kind: "clean" },
  { label: "睡个好觉", hint: "做一个软绵绵的梦", icon: Moon, kind: "sleep" },
  { label: "看看状态", hint: "了解小伙伴的心情", icon: Heart, kind: "status" },
  {
    label: "成长日记",
    hint: "记住每一个小瞬间",
    icon: Sprout,
    kind: "journal",
  },
];
const needs = [
  { key: "hunger", label: "饱食", icon: Utensils, color: "orange" },
  { key: "mood", label: "心情", icon: Heart, color: "pink" },
  { key: "clean", label: "清洁", icon: Waves, color: "blue" },
  { key: "energy", label: "体力", icon: Moon, color: "green" },
] as const;
const timeLabel = (n: number) =>
  new Date(n).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export default function App() {
  const [pet, setPet] = useState<PetState | null>(null);
  const [page, setPage] = useState<Page>("choose");
  const [chosen, setChosen] = useState(0);
  const [selected, setSelected] = useState(0);
  const [lane, setLane] = useState(1);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [animation, setAnimation] = useState("");
  const [savedAt, setSavedAt] = useState(0);
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem("pixelpet-sound") === "on";
    } catch {
      return false;
    }
  });
  const [tools, setTools] = useState(false);
  const [help, setHelp] = useState(false);
  const [reset, setReset] = useState(false);
  const [pressed, setPressed] = useState("");
  const [journalIndex, setJournalIndex] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const initialized = useRef(false);
  const latestRevision = useRef(-1);
  const modalRef = useRef<HTMLElement>(null);

  const apply = useCallback((r: Result) => {
    if (r.state.revision < latestRevision.current) return;
    latestRevision.current = r.state.revision;
    offset.current = r.serverTime - Date.now();
    setPet(r.state);
    setSavedAt(r.state.lastTick);
    setError("");
    if (r.message) setMessage(r.message);
  }, []);
  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    try {
      const r = await request("state");
      apply(r);
      if (!initialized.current) {
        setChosen(r.state.species);
        setPage(
          r.state.hatchedAt ? (r.state.game ? "game" : "home") : "choose",
        );
        initialized.current = true;
      }
    } catch {
      setError("还没连上小窝，请确认 Go 服务已启动。");
    }
  }, [apply]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const focus = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", focus);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Date.now() + offset.current),
      page === "game" ? 100 : 1000,
    );
    return () => clearInterval(timer);
  }, [page]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 4200);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (!animation) return;
    const timer = setTimeout(() => setAnimation(""), 1100);
    return () => clearTimeout(timer);
  }, [animation]);
  useEffect(() => {
    if (!help && !reset) return;
    const previous = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setHelp(false);
        setReset(false);
      }
      if (event.key !== "Tab") return;
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),a[href]",
      );
      if (!focusable?.length) return;
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap, true);
    return () => {
      document.removeEventListener("keydown", trap, true);
      previous?.focus();
    };
  }, [help, reset]);

  function beep(confirm = false) {
    if (!sound) return;
    try {
      const ctx = audio.current || (audio.current = new AudioContext());
      void ctx.resume();
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = confirm ? 740 : 520;
      gain.gain.setValueAtTime(0.045, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.1);
    } catch {
      /* Audio is optional. */
    }
  }
  async function act(kind: string, extra: Record<string, unknown> = {}) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await request("action", {
        kind,
        ...extra,
        requestId: crypto.randomUUID(),
      });
      apply(r);
      if (kind === "hatch") {
        setPage("home");
        setAnimation("hatch");
      } else if (kind === "play") {
        setPage("game");
        setLane(1);
      } else if (kind === "catch" && !r.state.game) {
        setPage("home");
        setAnimation("play");
      } else if (kind === "cancel-play") setPage("home");
      else if (kind === "feed" || kind === "clean" || kind === "sleep") {
        setPage("home");
        setAnimation(kind);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作没有保存，请重试");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const controls = useRef<(key: string) => void>(() => {});
  controls.current = (key: string) => {
    if (tools || help || reset || busyRef.current) return;
    setPressed(key);
    setTimeout(() => setPressed(""), 140);
    beep(key === "B");
    if (!pet) {
      if (key === "B") void refresh();
      return;
    }
    setError("");
    if (key === "A") {
      if (page === "choose") setChosen((v) => (v + 1) % 10);
      else if (page === "home") {
        setPage("menu");
        setSelected(0);
      } else if (page === "menu") setSelected((v) => (v + 1) % items.length);
      else if (page === "game") setLane((v) => (v + 1) % 3);
      else if (page === "journal")
        setJournalIndex((v) => (v + 1) % Math.max(1, pet.logs.length));
      return;
    }
    if (key === "C") {
      if (page === "game") {
        void act("cancel-play");
        return;
      }
      if (page === "hatch") setPage("choose");
      else if (pet.hatchedAt) setPage("home");
      return;
    }
    if (page === "choose") {
      setPage("hatch");
      return;
    }
    if (page === "hatch") {
      void act("hatch", { species: chosen });
      return;
    }
    if (page === "home") {
      setPage("menu");
      setSelected(0);
      return;
    }
    if (page === "menu") {
      const item = items[selected];
      if (item.kind === "status") setPage("status");
      else if (item.kind === "journal") {
        setPage("journal");
        setJournalIndex(0);
      } else void act(item.kind);
    } else if (page === "game") void act("catch", { lane });
    else setPage("home");
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (
        e.target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT", "A"].includes(e.target.tagName) ||
          (e.target.tagName === "BUTTON" &&
            !e.target.classList.contains("physical-button")))
      )
        return;
      const key = e.key.toLowerCase();
      const mapped = ["a", "arrowright", "arrowdown"].includes(key)
        ? "A"
        : ["b", "enter", " "].includes(key)
          ? "B"
          : ["c", "escape"].includes(key)
            ? "C"
            : null;
      if (mapped) {
        e.preventDefault();
        controls.current(mapped);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);
  async function importFile(file?: File) {
    setTools(false);
    if (!file) return;
    if (file.size > 64 * 1024) {
      setError("备份文件过大，请选择 PixelPet 导出的 JSON 文件。");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await request("import", JSON.parse(await file.text()));
      latestRevision.current = -1;
      apply(r);
      setPage(r.state.hatchedAt ? "home" : "choose");
      setChosen(r.state.species);
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "文件不是有效的 JSON 备份。"
          : e instanceof Error
            ? e.message
            : "导入失败，现有存档未改变。",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function restart() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await request("reset", { confirm: true });
      latestRevision.current = -1;
      apply(r);
      setChosen(0);
      setPage("choose");
      setReset(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "重新开始失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const index = pet?.hatchedAt ? pet.species : chosen;
  const age = pet?.hatchedAt ? Math.max(0, now - pet.hatchedAt) : 0;
  const stage =
    age >= 72 * 3600000 ? "成年期" : age >= 24 * 3600000 ? "成长期" : "幼年期";
  const low = pet && Math.min(...Object.values(pet.needs)) < 25;
  const mood = pet?.sleeping
    ? "正在做一个甜甜的梦"
    : low
      ? "想要你的一点点照顾"
      : "今天也是好心情";
  const target = pet?.game
    ? Math.floor(Math.max(0, now - pet.game.startedAt) / 900) % 3
    : 0;
  const lcdHint = !pet
    ? "B 重新连接"
    : page === "choose"
      ? "A 换一位　 B 就是它"
      : page === "hatch"
        ? "B 轻轻唤醒　 C 再选选"
        : page === "home"
          ? "A / B 打开菜单"
          : page === "menu"
            ? "A 选择　 B 确认　 C 返回"
            : page === "game"
              ? "A 移动　 B 接住　 C 退出"
              : page === "journal"
                ? "A 下一条　 C 返回"
                : "C 返回小窝";

  return (
    <div className="app">
      <header className="topbar">
        <a href="/" className="wordmark" aria-label="PixelPet 首页">
          <span className="brand-icon">
            <PixelEgg />
          </span>
          PixelPet<span className="brand-dot">®</span>
        </a>
        <div className="header-right">
          <span className="edition">
            <span />
            LOCAL EDITION <span className="edition-version">/ 001</span>
          </span>
          <div className="header-divider" />
          <button
            className="icon-button"
            aria-label={sound ? "关闭声音" : "打开声音"}
            title={sound ? "关闭声音" : "打开声音"}
            onClick={() => {
              const v = !sound;
              setSound(v);
              (() => {
                try {
                  localStorage.setItem("pixelpet-sound", v ? "on" : "off");
                } catch {
                  /* The game save lives in SQLite. */
                }
              })();
            }}
          >
            {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button
            className="icon-button"
            aria-label="玩法说明"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={18} />
          </button>
          <div className="tools-wrap">
            <button
              className={`backup-button ${tools ? "active" : ""}`}
              aria-expanded={tools}
              onClick={() => setTools((v) => !v)}
            >
              <ArrowDownToLine size={14} />
              存档盒
              <ChevronRight size={13} />
            </button>
            {tools && (
              <div className="tools-menu">
                <p>装好每一次小小的成长</p>
                <a href="/api/backup" download onClick={() => setTools(false)}>
                  <ArrowDownToLine size={16} />
                  导出存档
                </a>
                <button
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <ArrowUpFromLine size={16} />
                  导入备份
                </button>
                <button
                  disabled={busy}
                  className="reset-link"
                  onClick={() => {
                    setTools(false);
                    setReset(true);
                  }}
                >
                  <RotateCcw size={16} />
                  重新开始
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept=".json,application/json"
        aria-label="导入存档文件"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      <main>
        <section className="intro">
          <div className="eyebrow">
            <span className="tiny-star">✳</span> SMALL PIXELS, BIG FEELINGS
          </div>
          <h1>
            把日子，养得<span>可爱一点。</span>
            <svg viewBox="0 0 30 35" className="title-spark">
              <path d="M15 0v35M0 17h30M5 7l20 21M25 7L5 28" />
            </svg>
          </h1>
          <p>三个按键，一只小伙伴。找回口袋里最简单的快乐。</p>
        </section>
        <section className="play-space" aria-label="PixelPet 电子宠物机">
          <div className="left-note">
            <div className="note-index">
              01 <span>/ THE LITTLE THINGS</span>
            </div>
            <h2>
              小小一颗，
              <br />
              慢慢长大。
            </h2>
            <p>
              不用着急，也不必完美。
              <br />
              它只需要你偶尔的惦记。
            </p>
            <div className="note-doodle">
              <Heart size={30} strokeWidth={1.3} />
              <svg viewBox="0 0 100 46">
                <path d="M2 9c20 10 15 30 42 22s29-26 49-17m-9-4 10 4-6 9" />
              </svg>
            </div>
            <div className="local-status">
              <span className={error ? "status-dot warning" : "status-dot"} />
              {!pet
                ? "小窝连接中"
                : busy
                  ? "正在保存…"
                  : error
                    ? "有一条小提醒"
                    : "成长已好好保存"}
              <small>
                {savedAt ? `${timeLabel(savedAt)} · 本机存档` : "GO + SQLITE"}
              </small>
            </div>
          </div>
          <div className="device-stage">
            <span className="device-orbit orbit-one">✧</span>
            <span className="device-orbit orbit-two">+</span>
            <div className="device-shadow" />
            <div className="device">
              <div className="shell-shine" />
              <div className="lanyard" />
              <div className="shell-brand">
                pixelpet<span>™</span>
                <i>pocket companion</i>
              </div>
              <div className="screen-bezel">
                <div className="bezel-screw screw-left" />
                <div className="bezel-screw screw-right" />
                <div
                  className={`lcd ${pet?.sleeping ? "night" : ""}`}
                  aria-label="宠物屏幕，只能使用 A B C 按键操作"
                  aria-busy={busy}
                >
                  <div className="lcd-top">
                    <span>
                      {page === "choose"
                        ? "HELLO, FRIEND"
                        : page === "menu"
                          ? "CARE MENU"
                          : page === "status"
                            ? "MY STATUS"
                            : page === "journal"
                              ? "LITTLE DIARY"
                              : page === "game"
                                ? "CATCH A STAR"
                                : "PIXELPET / 01"}
                    </span>
                    <span className="lcd-battery">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                  <div className={`lcd-content content-${page}`}>
                    {!pet ? (
                      <div className="screen-wait">
                        <PixelEgg />
                        <p>
                          {error ? "小窝暂时没有连接" : "正在寻找你的小伙伴…"}
                        </p>
                        <small>{error ? "按 B 重试" : "请稍等一下"}</small>
                      </div>
                    ) : (
                      <>
                        {page === "choose" && (
                          <>
                            <div className="screen-caption">
                              遇见你的第一位小伙伴
                            </div>
                            <div className="choose-sprite">
                              <span className="pixel-spark spark-left">✦</span>
                              <Sprite index={chosen} className="idle" />
                              <span className="pixel-spark spark-right">✧</span>
                            </div>
                            <div className="choose-name">
                              {species[chosen]}
                              <span>
                                {String(chosen + 1).padStart(2, "0")} / 10
                              </span>
                            </div>
                            <div className="choose-dots">
                              {species.map((_, i) => (
                                <i
                                  key={i}
                                  className={i === chosen ? "selected" : ""}
                                />
                              ))}
                            </div>
                          </>
                        )}
                        {page === "hatch" && (
                          <div className="hatch-view">
                            <div className="screen-caption">
                              很高兴，遇见你。
                            </div>
                            <PixelEgg />
                            <strong>{species[chosen]}在等你</strong>
                            <small>按下 B，让故事开始吧。</small>
                          </div>
                        )}
                        {page === "home" && (
                          <>
                            <div className="home-caption">
                              <span>{pet.name}</span>
                              <span>
                                {pet.sleeping
                                  ? "☾ 晚安"
                                  : `${stage} · DAY ${Math.floor(age / 86400000) + 1}`}
                              </span>
                            </div>
                            <div
                              className={`pet-room ${pet.sleeping ? "sleeping" : ""} animation-${animation}`}
                            >
                              <Cloud
                                className="room-cloud"
                                size={30}
                                strokeWidth={1.5}
                              />
                              <span className="room-sun">
                                {pet.sleeping ? "☾" : "✳"}
                              </span>
                              <div className="room-window" />
                              <Sprite
                                index={index}
                                className={
                                  pet.sleeping ? "sleep-sprite" : "idle"
                                }
                              />
                              {pet.sleeping && (
                                <span className="sleep-z">z Z</span>
                              )}
                              {animation === "feed" && (
                                <span className="action-prop">🍙</span>
                              )}
                              {animation === "clean" && (
                                <span className="action-prop bubbles">
                                  ○ ◌ ○
                                </span>
                              )}
                              {(animation === "play" ||
                                animation === "hatch") && (
                                <span className="action-prop">✦ ♡ ✧</span>
                              )}
                              {pet.needs.clean < 35 && (
                                <span className="dirty-mark">♨</span>
                              )}
                              <div className="room-floor" />
                            </div>
                            <div className="pet-thought">
                              <Heart size={10} fill="currentColor" />
                              {message || mood}
                            </div>
                          </>
                        )}
                        {page === "menu" && (
                          <div className="care-menu">
                            {items.map((item, i) => {
                              const Icon = item.icon;
                              return (
                                <div
                                  key={item.kind}
                                  className={`care-item ${i === selected ? "selected" : ""}`}
                                >
                                  <span className="menu-arrow">
                                    {i === selected ? "▸" : ""}
                                  </span>
                                  <Icon size={15} />
                                  <span>
                                    {item.kind === "sleep" && pet.sleeping
                                      ? "起床啦"
                                      : item.label}
                                  </span>
                                  <span className="menu-number">0{i + 1}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {page === "status" && (
                          <div className="screen-status">
                            <div className="status-name">
                              <Sprite index={index} />
                              <div>
                                <strong>{pet.name}</strong>
                                <small>
                                  {stage} · 第 {Math.floor(age / 86400000) + 1}{" "}
                                  天
                                </small>
                              </div>
                            </div>
                            {needs.map((n) => (
                              <div className="lcd-meter" key={n.key}>
                                <span>{n.label}</span>
                                <div>
                                  <i
                                    style={{ width: `${pet.needs[n.key]}%` }}
                                  />
                                </div>
                                <b>{Math.round(pet.needs[n.key])}</b>
                              </div>
                            ))}
                            <div className="care-total">
                              收到过 {pet.careCount} 次温柔照顾 ♡
                            </div>
                          </div>
                        )}
                        {page === "journal" && (
                          <div className="screen-journal">
                            <Sprout size={26} />
                            <small>
                              {timeLabel(pet.logs[journalIndex]?.at || now)}
                            </small>
                            <p>{pet.logs[journalIndex]?.text}</p>
                            <span>
                              {journalIndex + 1} / {pet.logs.length}
                            </span>
                          </div>
                        )}
                        {page === "game" && pet.game && (
                          <div className="star-game">
                            <div className="game-score">
                              ROUND {pet.game.round + 1}/5{" "}
                              <span>★ {pet.game.score}</span>
                            </div>
                            <div className="game-lanes">
                              {[0, 1, 2].map((i) => (
                                <div
                                  key={i}
                                  className={`game-lane ${i === lane ? "lane-selected" : ""}`}
                                >
                                  <span
                                    className={`falling-star ${target === i ? "visible" : ""}`}
                                  >
                                    ★
                                  </span>
                                  {lane === i ? (
                                    <Sprite index={index} />
                                  ) : (
                                    <span className="lane-dot">·</span>
                                  )}
                                </div>
                              ))}
                            </div>
                            <div className="game-message">
                              {message || "移到星星下面，按 B 接住！"}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="lcd-bottom">
                    <span>{lcdHint}</span>
                    <span>{busy ? "···" : "♥"}</span>
                  </div>
                  <div className="lcd-scanlines" />
                </div>
              </div>
              <div className="device-model">
                <span>PP—001</span>
                <div className="speaker">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <span>HAVE A NICE DAY</span>
              </div>
              <div className="device-buttons">
                {["A", "B", "C"].map((key, i) => (
                  <div className="button-unit" key={key}>
                    <button
                      disabled={busy}
                      className={`physical-button button-${key.toLowerCase()} ${pressed === key ? "is-pressed" : ""}`}
                      aria-label={`${key} ${["选择", "确认", "返回"][i]}`}
                      onClick={() => controls.current(key)}
                    >
                      <span>{key}</span>
                    </button>
                    <span className="button-label">
                      {["选择", "确认", "返回"][i]}
                    </span>
                  </div>
                ))}
              </div>
              <span className="shell-bottom">a little friend, always.</span>
            </div>
          </div>
          <aside className="companion-note">
            <div className="companion-head">
              <span className="eyebrow">YOUR LITTLE COMPANION</span>
              <span className="small-cross">+</span>
            </div>
            <div className="companion-title">
              <h2>{pet?.hatchedAt ? pet.name : species[chosen]}</h2>
              <span>{pet?.hatchedAt ? stage : "等待相遇"}</span>
            </div>
            <p className="personality">{personalities[index]}</p>
            <div className="note-rule" />
            {pet?.hatchedAt ? (
              <div className="outside-needs">
                {needs.map((n) => {
                  const Icon = n.icon;
                  return (
                    <div className={`outside-meter ${n.color}`} key={n.key}>
                      <div>
                        <Icon size={13} />
                        <span>{n.label}</span>
                        <b>
                          {Math.round(pet.needs[n.key])}
                          <small>/100</small>
                        </b>
                      </div>
                      <div className="outside-track">
                        <i style={{ width: `${pet.needs[n.key]}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="welcome-note">
                <span className="welcome-icon">
                  <Sprout size={23} strokeWidth={1.3} />
                </span>
                <h3>每一次相遇，都很特别</h3>
                <p>
                  按 A 认识不同的小伙伴，
                  <br />按 B 带它回家。
                </p>
              </div>
            )}
            <div className="control-guide">
              <span>玩法很简单</span>
              <div>
                <kbd>A</kbd>
                <p>选一选</p>
                <i>→</i>
                <kbd>B</kbd>
                <p>确定啦</p>
                <i>→</i>
                <kbd>C</kbd>
                <p>退一步</p>
              </div>
              <small>鼠标按机身按钮，或直接用键盘 A / B / C</small>
            </div>
            <div className="tiny-note">
              <span>✦</span> 屏幕只负责可爱，按键负责一切。
            </div>
          </aside>
        </section>
        <section
          className="collection"
          aria-label="十位原创小伙伴，使用 A 键选择"
        >
          <div className="collection-label">
            <span>THE LITTLE FAMILY</span>
            <h3>十种可爱，等一次相遇。</h3>
            <p>
              原创像素小伙伴 <ArrowUpRight size={13} />
            </p>
          </div>
          <div className="collection-pets">
            {species.map((name, i) => (
              <div
                className={`collection-pet ${index === i ? "is-chosen" : ""}`}
                key={name}
              >
                <div>
                  <Sprite index={i} />
                </div>
                <span>{name}</span>
                {index === i && <i />}
              </div>
            ))}
          </div>
        </section>
        <div className="bottom-note">
          <span>不必时刻在线，惦记的时候，回来看看就好。</span>
          <Heart size={13} />
        </div>
      </main>
      <footer>
        <span>
          © 2026 PIXELPET <i>·</i> MADE FOR THE LITTLE MOMENTS
        </span>
        <span>
          <span className="footer-dot" />
          本地小窝，安心陪伴
        </span>
      </footer>
      {(message || error) && (
        <div
          className={`toast ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error ? <Cloud size={17} /> : <Check size={17} />}
          <span>{error || message}</span>
          <button
            aria-label="关闭提示"
            onClick={() => {
              setMessage("");
              setError("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {(help || reset) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setHelp(false);
            setReset(false);
          }}
        >
          <section
            ref={modalRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="modal-close icon-button"
              aria-label="关闭"
              onClick={() => {
                setHelp(false);
                setReset(false);
              }}
            >
              <X size={20} />
            </button>
            <span className="modal-eyebrow">PIXELPET / POCKET GUIDE</span>
            <h2 id="modal-title">
              {reset ? "新的相遇，也很美好。" : "三个按键，就是全部。"}
            </h2>
            {reset ? (
              <>
                <p>
                  重新开始会替换当前宠物。建议先导出备份，留住这段小小的陪伴。
                </p>
                <a className="modal-export" href="/api/backup" download>
                  <ArrowDownToLine size={16} />
                  先导出当前存档
                </a>
                <button
                  disabled={busy}
                  className="confirm-reset"
                  onClick={() => void restart()}
                >
                  {busy ? "正在保存…" : "确认重新开始"}
                </button>
              </>
            ) : (
              <>
                <p>
                  这是一台藏在网页里的电子宠物机。屏幕不用点，只需按下机身上的按钮，或者使用键盘。
                </p>
                <div className="help-keys">
                  <p>
                    <kbd>A</kbd>
                    <span>切换角色、菜单；小游戏里移动。</span>
                  </p>
                  <p>
                    <kbd>B</kbd>
                    <span>确认选择；小游戏里接住星星。</span>
                  </p>
                  <p>
                    <kbd>C</kbd>
                    <span>返回小窝，或者退出小游戏。</span>
                  </p>
                </div>
                <p className="help-save">
                  照顾成功后自动存档在这台电脑里。离线时也会慢慢成长，最多结算
                  12
                  小时的状态变化；没有永久死亡。睡着时会恢复体力。存档盒可以导出、导入备份。
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
