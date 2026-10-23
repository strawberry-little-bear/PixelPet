import { usePhysicalButtonFocus } from "./usePhysicalButtonFocus";
import { CareReadingRegion } from "./CareReadingRegion";
import { starsReactionFor, starsReactionMs, type StarsReaction } from "./stars-reaction";
import { treasureReactionFor, treasureReactionMs, type TreasureReaction } from "./treasure-reaction";
import { anchorServerClock, readServerClock } from "./serverClock";
import { useTreasureViewport, type TreasureDestination } from "./useTreasureViewport";
import { useReadingViewport } from "./useReadingViewport";
import { usePauseReadingViewport, type PauseReadingDestination } from "./usePauseReadingViewport";
import { GrowthTrack } from "./GrowthTrack";
import { useBackupExport } from "./useBackupExport";
import { needMeterAttributes, needMeterDescriptionId } from "./needMeter";
import { PetCareGuide } from "./PetCareGuide";
import { ButtonAudio } from "./buttonAudio";
import { purchaseMatches, selectedShopIndex, type PurchaseQuote } from "./shopBrowsing";
import { JournalPanel } from "./JournalPanel";
import { nextJournal, previousJournal, reconcileJournal, startJournal } from "./journal";
import { stageLook } from "./stageLooks";
import { StatusGuide, statusPageCount, validCareRules } from "./StatusGuide";
import { StatusReading } from "./StatusReading";
import type { CareRules } from "./types";
import { CarePreview } from "./CarePreview";
import { TreasureGame } from "./TreasureGame";
import { nextTreasure, treasureDone, treasureMenu } from "./treasure";
import { WalkingGame, ParkAlbum } from "./WalkingGame";
import { parkCatalog, walkMenu } from "./walk";
import { completedExperience, experienceWords, recordNewDiscoveries, takeDiscoveryEcho, type CompanionEchoKind } from "./companion";
import { FishingGame, FishAlbum } from "./FishingGame";
import { fishCatalogFor, fishingMenu } from "./fishing";
import { TetrisGame, tetrisOptions } from "./TetrisGame";
import { SnakeGame } from "./SnakeGame";
import { StarsGame } from "./StarsGame";
import { useTileViewport, type TileDestination } from "./useTileViewport";
import { TileGame, nextTile } from "./TileGame";
import { GameAllowance } from "./GuideReward";
import { ArcadePanel, GameGuide, AbandonGame } from "./ArcadePanel";
import { gameFinishInstruction, gameStartInstruction, games, guideSeen, rememberGuide, gameSessionKey, gameAwaitingFinish } from "./games";
import type { TileHint, TileLink } from "./TileGame";
import { ShopPanel, dailyClaimed } from "./ShopPanel";
import { dailyWalletNotice, shopItems, shopSections } from "./shop";
import type { ShopCategory } from "./shop";
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
import { petNeed } from "./needs";
import { request } from "./api";
import { isClockAhead, isSaveCorrupt, isSaveChanged, isGameFinished, isSleepChanged, failureGeneration, needsReconciliation } from "./requestFailure";
import { PixelEgg } from "./Sprite";
import { PetArt } from "./PetArt";
import { PetScene } from "./PetScene";
import { GrowthPanel } from "./GrowthPanel";
import { CareAdvice } from "./CareAdvice";
import { careMenuLabel } from "./careMenu";
import { previewBackup, backupSizeLimit } from "./backup";
import { ImportPreview, type PendingImport } from "./ImportPreview";
import { albumView, nextAlbum, previousAlbum, reconcileAlbum, startAlbum } from "./album-reading";
import { AlbumDirectory, AlbumPanel, albumCategories, type AlbumCategory } from "./AlbumPanel";
import { ReturnPanel, returnPageCount } from "./ReturnPanel";
import { CareFeedback } from "./CareFeedback";
import { QuietMoment } from "./QuietMoment";
import { nextQuietMemory, quietMemories } from "./quiet-memory";
import { CareOutcome, hasCareOutcome } from "./CareOutcome";
import { GameOutcome } from "./GameOutcome";
import { completedGameOutcome, type GameOutcomeRecord } from "./game-outcome";
import {
  petGrowth,
  stageNames,
  growthPageCount,
  formNames,
  tendency,
  growthPercentReading,
  stagePointsReading,
  stagePoints,
} from "./growth";
import type { GrowthStage, AdultForm } from "./types";
import { careClip, clipDurations, sceneMotion } from "./motion";
import type { MotionClip } from "./motion";
import { personalities, species } from "./types";
import type {
  PetState,
  Result,
  CareFeedback as Feedback,
  ReturnRecap,
  Shop,
} from "./types";

type Page =
  | "choose"
  | "hatch"
  | "home"
  | "menu"
  | "status"
  | "journal"
  | "game"
  | "arcade"
  | "game-guide"
  | "pause-guide"
  | "growth"
  | "return"
  | "album"
  | "shop"
  | "fish-album"
  | "park-album"
  | "moment"
  | "import-preview";
const items = [
  {
    label: careMenuLabel("feed"),
    hint: "一份香喷喷的小饭团",
    icon: Utensils,
    kind: "feed",
  },
  {
    label: careMenuLabel("arcade"),
    hint: `共 ${games.length} 款小游戏 · 按喜好选，不必都玩`,
    icon: Sparkles,
    kind: "arcade",
  },
  { label: careMenuLabel("clean"), hint: "把小烦恼也洗掉", icon: Waves, kind: "clean" },
  { label: careMenuLabel("sleep"), hint: "做一个软绵绵的梦", icon: Moon, kind: "sleep" },
  { label: "看看状态", hint: "了解小伙伴的心情", icon: Heart, kind: "status" },
  {
    label: "成长日记",
    hint: "记住每一个小瞬间",
    icon: Sprout,
    kind: "journal",
  },
  {
    label: "成长手册",
    hint: "看看成长与照顾习惯",
    icon: Sprout,
    kind: "growth",
  },
  {
    label: "回访小结",
    hint: "重看最近一次离开后的变化",
    icon: Sprout,
    kind: "return",
  },
  {
    label: "永久纪念册",
    hint: "收藏一起走过的日子",
    icon: Heart,
    kind: "album",
  },
  {
    label: "小窝商店",
    hint: "小问候、装扮与布置",
    icon: Sparkles,
    kind: "shop",
  },
  { label: "池塘鱼图鉴", hint: "看看真正遇见过的小鱼", icon: Waves, kind: "fish-album" },
  { label: "公园沿途发现", hint:"收藏散步中真正遇见的事物", icon:Sprout, kind:"park-album" },
  { label: "陪它一会儿", hint: "不为奖励，只陪它发发呆", icon: Heart, kind: "moment" },
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
  const [careRules, setCareRules] = useState<CareRules | null>(null);
  const [statusPage, setStatusPage] = useState(0);
  const [quietMomentChoice, setQuietMomentChoice] = useState(0);
  const [quietMomentReplied, setQuietMomentReplied] = useState(false);
  const [quietMemoryKey, setQuietMemoryKey] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("choose");
  const [chosen, setChosen] = useState(0);
  const [selected, setSelected] = useState(0);
  const [lane, setLane] = useState(1);
  const [starsReaction, setStarsReaction] = useState<StarsReaction | null>(null);
  const [now, setNow] = useState(Date.now());
  const clock = useRef(anchorServerClock(now));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // Invalidate focus only for interruptions/authoritative replacements, not
  // the player's own acknowledged hatch, game start or completion.
  const physicalFocusEpoch = useRef(0);
  // Only automatic game steps admit C while writing. Other operations
  // remain locked; no general input queue or replay of uncertain writes.
  const [busyAction, setBusyAction] = useState("");
  const busyActionRef = useRef("");
  const pendingFishingPause = useRef<{ id: string; generation?: string; epoch: number } | null>(null);
  const pendingBoardPause = useRef<{ kind: "snake" | "tetris"; id: string; generation?: string; epoch: number } | null>(null);
  const pendingWalkPause = useRef<{ id: string; generation?: string; epoch: number } | null>(null);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const unavailableRef = useRef(false);
  const [clockAhead, setClockAhead] = useState(false);
  const clockAheadRef = useRef(false);
  const [corrupt, setCorrupt] = useState(false);
  const corruptRef = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const backupExport = useBackupExport(!!pet && !busy && !uncertain && !unavailable && !clockAhead && !corrupt);
  const [refusedChange, setRefusedChange] = useState<"save" | "game" | "sleep" | null>(null);
  const refusedChangeRef = useRef<"save" | "game" | "sleep" | null>(null);
  const [checking, setChecking] = useState(false);
  const uncertainRef = useRef(false);
  const readInFlight = useRef<number | null>(null);
  // Returning during a write or an older read must not lose the request for
  // current state. Coalesce those return events into one subsequent read.
  const returnReadPending = useRef(false);
  // Invalidate reads that started before a write, even when their response is late.
  const syncEpoch = useRef(0);
  const [message, setMessage] = useState("");
  const [careFeedback, setCareFeedback] = useState<Feedback | null>(null);
  // Keep the last received receipt readable after the short growth toast.
  // It is page-local history, never reconstructed from later need readings.
  const [careOutcome, setCareOutcome] = useState<Feedback | null>(null);
  // Ordinary reads keep this last acknowledged game result unchanged.
  const [gameOutcome, setGameOutcome] = useState<GameOutcomeRecord | null>(null);
  // A page-local visual window, independent of saved dates and server clock anchors.
  const [homeEcho, setHomeEcho] = useState<{ kind: CompanionEchoKind; monotonicUntil: number } | null>(null);
  const seenExperiences = useRef(new Set<string>());
  const seenDiscoveries = useRef(new Set<string>());
  const pendingDiscoveryEchoes = useRef(new Map<string, "fish-discovery" | "park-discovery">());
  const homeEchoEpoch = useRef(0);
  const recapDisplayEpoch = useRef(0);
  const [foreground, setForeground] = useState(() => !document.hidden);
  // Focus tracks presence, separately from visible reading time.
  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus());
  const [clip, setClip] = useState<MotionClip | null>(null);
  const clipRef = useRef<MotionClip | null>(null);
  const clipSequence = useRef(0);
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
  const [resetConfirmation, setResetConfirmation] = useState("");
  const resetWords = !corrupt && pet?.hatchedAt && pet.name.trim() ? pet.name.trim() : "重新开始";
  const resetConfirmed = reset && resetConfirmation.trim() === resetWords;
  const [pressed, setPressed] = useState("");
  const [journalCursor, setJournalCursor] = useState(() => startJournal([]));
  const [growthPage, setGrowthPage] = useState(0);
  const [arcadeSelection, setArcadeSelection] = useState<{ petKey: string; choice: number } | null>(null);
  const [guidePage, setGuidePage] = useState(0);
  const [guideReview, setGuideReview] = useState(false);
  // A current-session reader, never a start card. Its B only turns a page.
  const [pauseGuideSession, setPauseGuideSession] = useState<string | null>(null);
  const readingRoot = useRef<HTMLDivElement>(null);
  const [pauseReadingDestination, setPauseReadingDestination] = useState<PauseReadingDestination | null>(null);
  const [abandonGame, setAbandonGame] = useState<string | null>(null);
  const sessionKey = gameSessionKey(pet?.game);
  const pauseGuide = pauseGuideSession === sessionKey ? games.find(game => game.id === pet?.game?.kind) : undefined;
  usePauseReadingViewport(readingRoot, pauseReadingDestination, sessionKey, page,
    uncertain || unavailable || corrupt || clockAhead || tools || help || reset || !foreground);
  const abandoning = page === "game" && abandonGame !== null && abandonGame === sessionKey;
  useEffect(() => { setAbandonGame(null); }, [sessionKey]);
  const [fishingSession, setFishingSession] = useState("");
  const [fishingChoice, setFishingChoice] = useState(0);
  const [fishPage, setFishPage] = useState(0);
  const fishingEpoch = useRef(0);
  const [treasureSession, setTreasureSession] = useState("");
  const [treasureReaction, setTreasureReaction] = useState<TreasureReaction | null>(null);
  const treasureReactionSerial = useRef(0);
  const [treasureDestination, setTreasureDestination] = useState<TreasureDestination | null>(null);
  const [treasureCursor, setTreasureCursor] = useState(0);
  const [treasureChoice, setTreasureChoice] = useState(0);
  const [walkSession,setWalkSession] = useState("");
  const [walkChoice,setWalkChoice] = useState(0);
  const [parkPage,setParkPage] = useState(0);
  const walkEpoch = useRef(0);
  // Observed window focus gates visits as well as local game permission.
  // A late accepted response may update the board, but cannot restore local
  // permission to run after backgrounding or opening a non-game panel.
  const boardEpoch = useRef(0);
  const windowActive = useRef(windowFocused);
  const [tetrisSession, setTetrisSession] = useState("");
  const [tetrisChoice, setTetrisChoice] = useState(0);
  const [snakeSession, setSnakeSession] = useState("");
  const snakeTurn = useRef(0);
  const [queuedTurn, setQueuedTurn] = useState(0);
  const [tileCursor, setTileCursor] = useState(0);
  const [tileLink, setTileLink] = useState<TileLink | null>(null);
  const tileLinkSequence = useRef(0);
  const [tileHint, setTileHint] = useState<TileHint | null>(null);
  const tileHintSequence = useRef(0);
  const tileHintShownFor = useRef("");
  const [tileDestination, setTileDestination] = useState<TileDestination | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [shopPage, setShopPage] = useState(0);
  const [shopCategory, setShopCategory] = useState<ShopCategory | null>(null);
  const [shopItemId, setShopItemId] = useState<string | null>(null);
  const [shopNotice, setShopNotice] = useState("");
  const [purchaseConfirm, setPurchaseConfirm] = useState<PurchaseQuote | null>(null);
  const visibleShopItems = pet && shopCategory ? shopItems(shop, pet, shopCategory) : [];
  const shopItemIndex = selectedShopIndex(visibleShopItems, shopItemId);
  const purchaseReady = !!pet && purchaseMatches(purchaseConfirm, visibleShopItems[shopItemIndex], pet);
  useEffect(() => {
    if (page !== "shop" || !shopCategory || !pet) return;
    const entries = shopItems(shop, pet, shopCategory);
    const item = entries[selectedShopIndex(entries, shopItemId)];
    const removed = shopItemId !== null && !entries.some(entry => entry.id === shopItemId);
    if (removed || (!shopItemId && item)) setShopItemId(item?.id ?? null);
    if (purchaseConfirm && !busy && !purchaseMatches(purchaseConfirm, item, pet)) {
      setPurchaseConfirm(null);
      setShopNotice("物品或当前状态已更新，购买确认已取消；请重新核对后再按 B。");
    } else if (removed) {
      setShopNotice("刚才预览的物品已不在这个分类中，已更新预览；请重新核对。");
    }
  }, [page, shopCategory, shop, pet, shopItemId, purchaseConfirm, busy]);
  // A pause-menu shortcut reuses the permanent reader, but C must return to
  // this exact session without granting permission to run it.
  const [albumReturnSession, setAlbumReturnSession] = useState<string | null>(null);
  const returningToPause = albumReturnSession !== null && albumReturnSession === sessionKey;
  const [albumCursor, setAlbumCursor] = useState(startAlbum);
  const [albumChoice, setAlbumChoice] = useState(0);
  const [albumCategory, setAlbumCategory] = useState<AlbumCategory | null>(null);
  const albumReading = pet && albumCategory !== null ? albumView(pet, albumCategory, albumCursor) : null;
  const [returnRecap, setReturnRecap] = useState<ReturnRecap | null>(null);
  const [returnPending, setReturnPending] = useState(false);
  const [returnReading, setReturnReading] = useState<{ id: string; page: number; updated: boolean } | null>(null);
  // Derive the first page immediately for a different record, so both render
  // and an input before the reconciliation effect use the same new decision.
  const returnChanged = !!returnRecap && !!returnReading && returnRecap.id !== returnReading.id;
  const returnPage = returnReading?.id === returnRecap?.id ? returnReading?.page ?? 0 : 0;
  const returnUpdated = returnChanged || !!returnReading?.updated;
  useEffect(() => {
    if (page === "return" && returnRecap && returnChanged)
      setReturnReading(current => current?.id === returnRecap.id ? current : { id: returnRecap.id, page: 0, updated: true });
  }, [page, returnRecap?.id, returnChanged]);
  const returnAttempt = useRef("");
  const [queuedReturn, setQueuedReturn] = useState<{ id: string; epoch: number } | null>(null);
  const knownStage = useRef<GrowthStage | null>(null);
  const [evolution, setEvolution] = useState<{
    stage: GrowthStage;
    form: AdultForm | "";
  } | null>(null);
  const activeEvolution = useRef<typeof evolution>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const pendingImportRef = useRef<PendingImport | null>(null);
  const importSequence = useRef(0);
  const importReturn = useRef<{ page: Page; gameId: string | null }>({ page: "home", gameId: null });
  const discardImport = useCallback(() => {
    importSequence.current++;
    pendingImportRef.current = null;
    setPendingImport(null);
  }, []);
  useEffect(() => () => { importSequence.current++; }, []);
  const audio = useRef<ButtonAudio | null>(null);
  if (!audio.current) audio.current = new ButtonAudio();
  useEffect(() => { audio.current?.setEnabled(sound); }, [sound]);
  useEffect(() => () => { audio.current?.dispose(); }, []);
  const initialized = useRef(false);
  const initialReadStarted = useRef(false);
  const latestRevision = useRef(-1);
  const acceptedPet = useRef<PetState | null>(null);
  const acceptedGeneration = useRef<string | undefined>(undefined);
  const [careReadingDestination, setCareReadingDestination] = useState<{ petKey: string | null; page: "growth" | "status" | "journal" | "menu" } | null>(null);
  // Immutable lifecycle fields keep older services usable; the generation also
  // distinguishes restoring a backup of the same pet. Never key on revision.
  const careReadingKey = pet ? JSON.stringify([acceptedGeneration.current, pet.createdAt, pet.hatchedAt, pet.species]) : null;
  // Page-local browsing memory, not a saved preference or an instruction to play.
  // Polls, care and growth keep it; another pet/save must not inherit it.
  const arcadeChoice = careReadingKey && arcadeSelection?.petKey === careReadingKey ? arcadeSelection.choice : 0;
  const setArcadeChoice = (choice: number) => {
    if (careReadingKey) setArcadeSelection({ petKey: careReadingKey, choice });
  };
  usePhysicalButtonFocus(JSON.stringify([physicalFocusEpoch.current, page === "import-preview"]),
    tools || help || reset || uncertain || unavailable || corrupt || clockAhead || !foreground || !windowFocused);
  useReadingViewport(readingRoot, careReadingDestination,
    page === "menu" ? '.care-menu [aria-current="true"]' :
      page === "journal" ? ".screen-journal [data-care-reading-start]" : "[data-care-reading-start]",
    !!careReadingKey && careReadingDestination?.petKey === careReadingKey && careReadingDestination?.page === page &&
    !pet?.game && !uncertain && !unavailable && !corrupt && !clockAhead && !tools && !help && !reset && foreground && !clip && !evolution);
  // Only a newly acknowledged completion requests this one-shot position.
  // The receipt survives reads/navigation, so none of those may replay it.
  // Ordinary play animation can continue; an evolution takes precedence.
  useReadingViewport(readingRoot, gameOutcome, ".game-outcome > h3",
    page === "home" && !pet?.game && !uncertain && !unavailable && !corrupt && !clockAhead &&
    !tools && !help && !reset && foreground && !evolution && clip?.kind !== "evolve");
  const navigateCareReading = (destination: "growth" | "status" | "journal" | "menu") => {
    setCareReadingDestination({ petKey: careReadingKey, page: destination });
  };

  // Explicit navigation follows the stable item/quote, never a polling revision.
  const [shopReadingDestination, setShopReadingDestination] = useState<{
    petKey: string | null; category: ShopCategory | null; section: number;
    itemId: string | null; target: "section" | "item" | "decision"; confirm: boolean;
  } | null>(null);
  useReadingViewport(readingRoot, shopReadingDestination,
    !shop || !pet?.economy ? ".shop-panel > header" : shopReadingDestination?.target === "decision" ? ".shop-decision" :
      shopCategory ? ".shop-panel h3" : '.shop-sections [aria-current="true"]',
    !!careReadingKey && shopReadingDestination?.petKey === careReadingKey && page === "shop" &&
    shopReadingDestination?.category === shopCategory &&
    (shopCategory ? shopReadingDestination?.itemId === (visibleShopItems[shopItemIndex]?.id ?? null) : shopReadingDestination?.section === shopPage) &&
    shopReadingDestination?.confirm === purchaseReady &&
    !pet?.game && !uncertain && !unavailable && !corrupt && !clockAhead && !tools && !help && !reset && foreground && !clip && !evolution);
  const navigateShopReading = (category: ShopCategory | null, itemId: string | null, section: number,
    target: "section" | "item" | "decision", confirm = false) => {
    setShopReadingDestination({ petKey: careReadingKey, category, section, itemId, target, confirm });
  };

  const [arcadeReadingDestination, setArcadeReadingDestination] = useState<{
    petKey: string | null; page: "arcade" | "game-guide"; choice: number;
  } | null>(null);
  useReadingViewport(readingRoot, arcadeReadingDestination,
    page === "arcade" ? '.arcade-card[aria-current="true"]' : ".game-guide > header",
    !!careReadingKey && arcadeReadingDestination?.petKey === careReadingKey &&
    arcadeReadingDestination?.page === page && arcadeReadingDestination?.choice === arcadeChoice &&
    !pet?.game && !uncertain && !unavailable && !corrupt && !clockAhead && !tools && !help && !reset && foreground && !clip && !evolution);
  const navigateArcadeReading = (destination: "arcade" | "game-guide", choice = arcadeChoice) => {
    setArcadeReadingDestination({ petKey: careReadingKey, page: destination, choice });
  };

  const [collectionReadingDestination, setCollectionReadingDestination] = useState<{
    petKey: string | null; sessionKey: string | null; page: "fish-album" | "park-album"; index: number;
  } | null>(null);
  useReadingViewport(readingRoot, collectionReadingDestination, "[data-collection-reading-start]",
    !!careReadingKey && collectionReadingDestination?.petKey === careReadingKey &&
    collectionReadingDestination?.sessionKey === sessionKey && collectionReadingDestination?.page === page &&
    collectionReadingDestination?.index === (page === "fish-album" ? fishPage : parkPage) &&
    !uncertain && !unavailable && !corrupt && !clockAhead && !tools && !help && !reset && foreground && !clip && !evolution);
  const navigateCollectionReading = (destination: "fish-album" | "park-album", index: number) => {
    setCollectionReadingDestination({ petKey: careReadingKey, sessionKey, page: destination, index });
  };

  const [albumReadingDestination, setAlbumReadingDestination] = useState<{
    petKey: string | null; sessionKey: string | null; category: AlbumCategory | null;
  } | null>(null);
  useReadingViewport(readingRoot, albumReadingDestination,
    albumCategory === null ? '.album-directory [aria-current="true"]' : '.album-panel > header',
    !!careReadingKey && albumReadingDestination?.petKey === careReadingKey &&
    albumReadingDestination?.sessionKey === sessionKey && albumReadingDestination?.category === albumCategory && page === "album" &&
    !uncertain && !unavailable && !corrupt && !clockAhead && !tools && !help && !reset && foreground && !clip && !evolution);
  const navigateAlbumReading = (category: AlbumCategory | null) => {
    setAlbumReadingDestination({ petKey: careReadingKey, sessionKey, category });
  };

  const [quietReadingDestination, setQuietReadingDestination] = useState<{ petKey: string | null; choice: number } | null>(null);
  useReadingViewport(readingRoot, quietReadingDestination, ".quiet-moment-copy",
    !!careReadingKey && quietReadingDestination?.petKey === careReadingKey && page === "moment" &&
    quietReadingDestination?.choice === quietMomentChoice &&
    !pet?.game && !uncertain && !unavailable && !corrupt && !clockAhead && !tools && !help && !reset && foreground && !clip && !evolution);
  const navigateQuietReading = (choice: number) => {
    setQuietReadingDestination({ petKey: careReadingKey, choice });
  };

  const [returnReadingDestination, setReturnReadingDestination] = useState<{ petKey: string | null; recapId: string; page: number } | null>(null);
  useReadingViewport(readingRoot, returnReadingDestination, ".return-panel > header",
    !!careReadingKey && returnReadingDestination?.petKey === careReadingKey &&
    returnReadingDestination?.recapId === returnRecap?.id && returnReadingDestination?.page === returnPage && page === "return" &&
    !pet?.game && !uncertain && !unavailable && !corrupt && !clockAhead && !tools && !help && !reset && foreground && !clip && !evolution);
  const navigateReturnReading = (recapId: string, targetPage: number) => {
    setReturnReadingDestination({ petKey: careReadingKey, recapId, page: targetPage });
  };

  const modalRef = useRef<HTMLElement>(null);
  const modalReturnFocus = useRef<HTMLElement | null>(null);

  const apply = useCallback((r: Result, silent = false, authoritativeRead = false) => {
    // Revision order is meaningful within a generation. An explicit repair can
    // legitimately replace an unreadable revision with a lower one. Only a
    // fresh, epoch-checked read may cross that boundary, never a cached action.
    const newGeneration = acceptedGeneration.current !== undefined && r.saveGeneration !== undefined && acceptedGeneration.current !== r.saveGeneration;
    if (r.state.revision < latestRevision.current && !(authoritativeRead && newGeneration)) return false;
    latestRevision.current = r.state.revision;
    if (acceptedPet.current && acceptedPet.current.sleeping !== r.state.sleeping) {
      setQuietMomentReplied(false);
      setQuietMemoryKey(null);
    }
    acceptedPet.current = r.state;
    acceptedGeneration.current = r.saveGeneration;
    const nextStage = r.state.growth?.stage;
    if (nextStage) {
      const rank = ["egg", "baby", "growing", "adult"];
      if (
        !silent && knownStage.current &&
        rank.indexOf(nextStage) > rank.indexOf(knownStage.current) &&
        nextStage !== "baby"
      )
        setEvolution({ stage: nextStage, form: r.state.growth?.form || "" });
      knownStage.current = nextStage;
    }
    clock.current = anchorServerClock(r.serverTime);
    // The new snapshot must not render against the previous/browser clock
    // until the next interval (days, legacy estimates and live star position).
    setNow(r.serverTime);
    if (r.returnRecap) setReturnRecap(r.returnRecap);
    if (r.recapPending !== undefined) setReturnPending(r.recapPending);
    setPet(r.state);
    setCareRules(validCareRules(r.careRules) ? r.careRules : null);
    if (r.shop) setShop(r.shop);
    setSavedAt(r.state.lastTick);
    setError("");
    clockAheadRef.current = false;
    setClockAhead(false);
    corruptRef.current = false;
    setCorrupt(false);
    unavailableRef.current = false;
    setUnavailable(false);
    if (!silent && r.message) setMessage(r.message);
    return true;
  }, []);
  useEffect(() => {
    if (page === "journal") setJournalCursor(cursor => reconcileJournal(pet?.logs ?? [], cursor));
  }, [page, pet?.logs]);
  useEffect(() => {
    if (page === "album" && pet && albumCategory !== null) {
      setAlbumCursor(cursor => reconcileAlbum(pet, albumCategory, cursor));
    }
  }, [page, pet?.album, albumCategory]);
  const stopActivity = useCallback(() => {
    physicalFocusEpoch.current++;
    audio.current?.cancel();
    recapDisplayEpoch.current++;
    setQueuedReturn(null);
    setMessage("");
    setCareFeedback(null);
    setCareOutcome(null);
    setGameOutcome(null);
    setHomeEcho(null);
    setQuietMemoryKey(null);
    setQuietMomentReplied(false);
    seenDiscoveries.current.clear();
    pendingDiscoveryEchoes.current.clear();
    setEvolution(null);
    activeEvolution.current = null;
    clipRef.current = null;
    setClip(null);
    walkEpoch.current++;
    fishingEpoch.current++;
    boardEpoch.current++;
    homeEchoEpoch.current++;
    setWalkSession(""); setTreasureSession(""); setTreasureReaction(null); setStarsReaction(null);
    setFishingSession("");
    setTetrisSession("");
    setSnakeSession("");
    snakeTurn.current = 0;
    setQueuedTurn(0);
    setTileLink(null);
    setTileHint(null);
  }, []);
  const markCorrupt = useCallback((reconciled = false, generation?: string) => {
    const replaced = generation !== undefined && acceptedGeneration.current !== undefined && generation !== acceptedGeneration.current;
    if (generation) acceptedGeneration.current = generation;
    // Repeated corrupt-state polls must not close the toolbox or cancel a
    // repair preview. Only the first authoritative diagnosis enters recovery.
    if (corruptRef.current && !reconciled && !replaced) return;
    clockAheadRef.current = false;
    setClockAhead(false);
    corruptRef.current = true;
    setCorrupt(true);
    refusedChangeRef.current = null;
    setRefusedChange(null);
    // An explicit repair may replace an unreadable revision with a new one.
    // Do not compare that new save generation with the last healthy snapshot.
    latestRevision.current = -1;
    knownStage.current = null;
    setReturnRecap(null);
    setReturnPending(false);
    unavailableRef.current = false;
    setUnavailable(false);
    uncertainRef.current = false;
    setUncertain(false);
    discardImport();
    stopActivity();
    setPage("choose");
    setReset(false);
    setTools(false);
    setPurchaseConfirm(null);
    setError("存档未通过校验，未自动替换。请从存档盒选择已有备份修复，或明确确认重新开始。");
  }, [discardImport, stopActivity]);
  const markClockAhead = useCallback(() => {
    setClockAhead(true);
    if (clockAheadRef.current) return;
    clockAheadRef.current = true;
    corruptRef.current = false;
    setCorrupt(false);
    unavailableRef.current = true;
    setUnavailable(true);
    // Keep an unknown write unknown: a clock diagnosis is not a healthy read.
    discardImport();
    stopActivity();
    setHelp(false);
    setAbandonGame(null);
    setReturnRecap(null);
    setReturnPending(false);
    setReset(false);
    setTools(false);
    setPurchaseConfirm(null);
    setPage("choose");
    setError("服务时间早于存档时间。请校准运行 Go 服务的电脑时间，再按 B 检查；不要重置存档。");
  }, [discardImport, stopActivity]);
  const markUncertain = useCallback(() => {
    setRefusedChange(null);
    refusedChangeRef.current = null;
    discardImport();
    corruptRef.current = false;
    setCorrupt(false);
    uncertainRef.current = true;
    setUncertain(true);
    stopActivity();
    setError("这次操作的结果还未确认，可能已经保存。按 B 核对存档，不会自动重试。");
  }, [stopActivity, discardImport]);
  const markChangeRejected = useCallback((reason: "save" | "game" | "sleep") => {
    markUncertain();
    setRefusedChange(reason);
    refusedChangeRef.current = reason;
    setHelp(false);
    setReset(false);
    setTools(false);
    setPurchaseConfirm(null);
    setAbandonGame(null);
    setError(reason === "sleep"
      ? "睡眠状态已在其他页面变化，本次入睡或起床未执行。按 B 读取最新状态，不会自动重试。"
      : reason === "save"
      ? "存档已在其他页面替换，本次操作未执行。按 B 读取当前存档，不会自动重试。"
      : "本局已在其他页面结束，本次放弃未执行。按 B 读取最新结果，不会自动收好。");
  }, [markUncertain]);
  // Both heartbeat and recap acknowledgement replies contain a fresh current
  // state, unlike cached gameplay acknowledgements. Keep their routing and
  // replacement handling together so a claim cannot hide a newly started game.
  const acceptCurrentRead = useCallback((r: Result, context: {
    recovering?: boolean; changed?: boolean; repairing?: boolean; clockBlocked?: boolean;
  } = {}) => {
    const { recovering = false, changed = false, repairing = false, clockBlocked = false } = context;
    // The installation token also identifies a same-pet backup restore.
    // Immutable lifecycle fields retain hatch routing/older-server support.
    // Reject stale responses before invalidating any local intent.
    const previous = acceptedPet.current;
    const generationChanged = acceptedGeneration.current !== undefined && r.saveGeneration !== undefined && acceptedGeneration.current !== r.saveGeneration;
    const replaced = previous !== null && (generationChanged || (r.state.revision >= latestRevision.current && (
      previous.createdAt !== r.state.createdAt ||
      previous.hatchedAt !== r.state.hatchedAt ||
      (r.state.hatchedAt > 0 && previous.species !== r.state.species)
    )));
    // A session can change without replacing the pet/save generation. Route
    // newly started games into reach and discard confirmation/menu intent
    // from the old board. A terminal same-ID result is also a new decision:
    // an old "discard unfinished game" confirmation must not throw it away.
    const sessionChanged = previous !== null && gameSessionKey(previous.game) !== gameSessionKey(r.state.game);
    const resultReady = previous !== null && !sessionChanged && !gameAwaitingFinish(previous.game) && gameAwaitingFinish(r.state.game);
    const gameChanged = sessionChanged || resultReady;
    if (!apply(r, recovering || repairing || clockBlocked || replaced || gameChanged, true)) {
      if (recovering || clockBlocked) setError(changed ? "读到较旧的存档，上次操作未执行。按 B 再次读取当前存档。" : "读到较旧的存档，结果仍未确认。按 B 再次核对。");
      return false;
    }
    // Unlike cached action replies, this is an authoritative current read:
    // an absent recap means it was cleared (including same-pet imports).
    setReturnRecap(r.returnRecap ?? null);
    setReturnPending(!!r.recapPending);
    if (!r.returnRecap) setPage(value => value === "return" ? (r.state.hatchedAt ? "home" : "choose") : value);
    if (replaced || gameChanged) {
      stopActivity();
      setHelp(false);
      setAbandonGame(null);
      setReturnReading(null);
    }
    if (recovering || repairing || clockBlocked || replaced || gameChanged) {
      setAlbumReturnSession(null);
      setPauseGuideSession(null);
      discardImport();
      uncertainRef.current = false;
      setUncertain(false);
      setRefusedChange(null);
      refusedChangeRef.current = null;
      setChosen(r.state.species);
      setPage(r.state.hatchedAt ? (r.state.game ? "game" : "home") : "choose");
      setReset(false);
      setTools(false);
      setPurchaseConfirm(null);
      setLane(1);
      setTileCursor(nextTile(r.state.game?.tiles?.board ?? [], -1));
      setTetrisChoice(0);
      setFishingChoice(0);
      setWalkChoice(0);
      returnAttempt.current = r.returnRecap?.id ?? "";
      initialized.current = true;
      const gameMessage = resultReady
        ? "已同步本局结果，请查看后按 B / C 收好。没有自动结算。"
        : r.state.game
          ? "已同步其他页面的新一局，请从当前画面继续。实时游戏不会自动启动。"
          : "另一页面已结束这一局，已回到小窝。没有重复结算。";
      setMessage(clockBlocked
        ? "时间已恢复，已重新读取存档。游戏不会自动继续，上次操作没有重试。"
        : repairing ? "已重新读到有效存档，请查看状态。没有自动导入或重新开始。"
        : changed ? "已读取当前存档。上次操作未执行，没有自动重试。"
        : recovering ? "已核对当前存档，请查看状态。上次操作没有自动重试。"
        : gameChanged ? gameMessage
        : "已同步其他页面更新的伙伴，请从当前画面继续。");
    } else if (r.recapPending) returnAttempt.current = "";
    if (!initialized.current) {
      setChosen(r.state.species);
      setPage(r.state.hatchedAt ? (r.state.game ? "game" : "home") : "choose");
      initialized.current = true;
    }
    return true;
  }, [apply, stopActivity, discardImport]);
  const refresh = useCallback(async function readCurrent() {
    if (busyRef.current || readInFlight.current === syncEpoch.current || document.hidden) return;
    // A visible but initially unfocused window may display authoritative state
    // once without recording a visit. Neither polling nor failed bootstraps
    // count as presence until a real focus event arrives.
    if (!windowActive.current && initialReadStarted.current) return;
    initialReadStarted.current = true;
    returnReadPending.current = false;
    const epoch = syncEpoch.current;
    const recovering = uncertainRef.current;
    const changed = refusedChangeRef.current !== null;
    const repairing = corruptRef.current;
    const clockBlocked = clockAheadRef.current;
    readInFlight.current = epoch;
    if (recovering || repairing || unavailableRef.current) setChecking(true);
    try {
      // Recovery only reads authoritative state. Never replay the lost mutation
      // or claim a recap as a substitute for finding out what was saved.
      const r = recovering || repairing || clockBlocked || !windowActive.current ? await request("state") : await request("visit", {});
      if (epoch !== syncEpoch.current) return;
      acceptCurrentRead(r, { recovering, changed, repairing, clockBlocked });
    } catch (error) {
      if (epoch !== syncEpoch.current) return;
      if (isClockAhead(error)) { markClockAhead(); return; }
      if (isSaveCorrupt(error)) {
        // An explicit diagnosis is authoritative current-state evidence, not
        // a retry of a previous unknown write. Its payload was discarded.
        markCorrupt(recovering, failureGeneration(error));
        return;
      }
      // Keep the read-only recovery marker across transport failures, but do
      // not present an old clock diagnosis as a fresh server response.
      setClockAhead(false);
      corruptRef.current = false;
      setCorrupt(false);
      if (!recovering) {
        discardImport();
        setPage(value => value === "import-preview" ? importReturn.current.page : value);
        unavailableRef.current = true;
        setUnavailable(true);
        stopActivity();
      }
      setError(recovering
        ? changed ? "还无法读取当前存档。按 B 重连，上次操作未执行且不会重试。" : "还无法核对存档，结果仍未确认。按 B 重连，不会重复提交上次操作。"
        : "还没连上小窝，请确认 Go 服务已启动。");
    } finally {
      if (readInFlight.current === epoch) {
        readInFlight.current = null;
        setChecking(false);
      }
      if (returnReadPending.current) void readCurrent();
    }
  }, [acceptCurrentRead, stopActivity, discardImport, markCorrupt, markClockAhead]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const returned = () => {
      if (document.hidden) return;
      returnReadPending.current = true;
      void refresh();
    };
    const windowFocus = (event: Event) => {
      // Moving focus between physical keys is not returning to the window.
      if (event.target !== event.currentTarget) return;
      // Update synchronously: returned() can start a read before React renders.
      windowActive.current = true;
      setWindowFocused(true);
      returned();
    };
    const left = () => {
      setForeground(false);
      audio.current?.cancel();
      recapDisplayEpoch.current++;
      homeEchoEpoch.current++;
      setHomeEcho(null);
    };
    const windowBlur = (event: Event) => {
      if (event.target !== event.currentTarget) return;
      windowActive.current = false;
      setWindowFocused(false);
      recapDisplayEpoch.current++;
      // Visible reading timers keep their established behavior. Only presence
      // and automatic recap presentation treat this window blur as leaving.
    };
    const visibility = () => {
      setForeground(!document.hidden);
      if (document.hidden) left();
      else returned();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", windowFocus);
    window.addEventListener("blur", windowBlur);
    return () => {
      returnReadPending.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", windowFocus);
      window.removeEventListener("blur", windowBlur);
    };
  }, [refresh]);
  useEffect(() => {
    if (!busy && returnReadPending.current) void refresh();
  }, [busy, refresh]);
  useEffect(() => {
    const timer = setInterval(
      () => setNow(readServerClock(clock.current)),
      page === "game" ? 100 : 1000,
    );
    return () => clearInterval(timer);
  }, [page]);
  useEffect(() => {
    if (!starsReaction) return;
    const timer = setTimeout(() => setStarsReaction(null), starsReactionMs);
    return () => clearTimeout(timer);
  }, [starsReaction]);
  useEffect(() => { setStarsReaction(null); }, [sessionKey, page]);
  useEffect(() => {
    if (!treasureReaction) return;
    const timer = setTimeout(() => setTreasureReaction(null), treasureReactionMs);
    return () => clearTimeout(timer);
  }, [treasureReaction]);
  useEffect(() => {
    if (!tileLink) return;
    const timer = setTimeout(() => setTileLink(null), 850);
    return () => clearTimeout(timer);
  }, [tileLink]);
  useEffect(() => {
    if (!tileHint) return;
    const timer = setTimeout(() => setTileHint(null), 3200);
    return () => clearTimeout(timer);
  }, [tileHint]);
  useEffect(() => {
    tileHintShownFor.current = "";
    setTileHint(null);
  }, [pet?.game?.id]);
  useEffect(() => {
    const board = pet?.game?.tiles?.board;
    if (board && !board[tileCursor]) setTileCursor(nextTile(board, tileCursor));
  }, [pet?.game?.id, pet?.game?.tiles?.board, tileCursor]);
  useEffect(() => {
    const hunt = pet?.game?.treasure;
    if (hunt) setTreasureCursor(nextTreasure(hunt, -1));
    setTreasureChoice(0);
  }, [pet?.game?.id]);
  useEffect(() => {
    const hunt = pet?.game?.treasure;
    if (hunt && hunt.opened.includes(treasureCursor) && !treasureDone(hunt))
      setTreasureCursor(nextTreasure(hunt, treasureCursor));
  }, [pet?.game?.treasure, treasureCursor]);
  // A different tab can finish or cancel the persisted game. Do not leave a
  // blank game screen or replay its reward/celebration on this tab.
  useEffect(() => {
    if (pet && page === "game" && !pet.game && !busy) {
      setTileLink(null);
      setTileHint(null);
      setPage("home");
    }
  }, [pet, page, busy]);
  useEffect(() => {
    if (page !== "home" || tools || help || reset) setHomeEcho(null);
  }, [page, tools, help, reset]);
  useEffect(() => {
    if (!homeEcho) return;
    const timer = setTimeout(() => setHomeEcho(null), Math.max(0, homeEcho.monotonicUntil - performance.now()));
    return () => clearTimeout(timer);
  }, [homeEcho]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 4200);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (!clip) return;
    const timer = setTimeout(() => {
      if (clipRef.current?.id === clip.id) {
        activeEvolution.current = null;
        clipRef.current = null;
        setClip(null);
      }
    }, clipDurations[clip.kind]);
    return () => clearTimeout(timer);
  }, [clip]);
  // A celebration is only consumed when it finishes visibly (or C skips it).
  // Restart the short clip after an interruption rather than claiming to freeze
  // CSS animation frames. A newer queued stage wins; save/game/recovery changes
  // still discard both presentations through stopActivity.
  useEffect(() => {
    if (clip?.kind !== "evolve" || !activeEvolution.current) return;
    if (foreground && !document.hidden && page === "home" &&
      !tools && !help && !reset && !pet?.sleeping && !pet?.game) return;
    const interrupted = activeEvolution.current;
    activeEvolution.current = null;
    clipRef.current = null;
    setClip(null);
    setEvolution(queued => queued ?? interrupted);
    setMessage("");
  }, [clip, foreground, page, tools, help, reset, pet?.sleeping, pet?.game]);
  useEffect(() => {
    if (
      !evolution || uncertain || unavailable || corrupt || page !== "home" ||
      busy || clip || pet?.sleeping || pet?.game || tools || help || reset ||
      !foreground || document.hidden
    ) return;
    const next = { kind: "evolve" as const, id: ++clipSequence.current };
    activeEvolution.current = evolution;
    clipRef.current = next;
    setClip(next);
    setMessage(
      evolution.stage === "adult"
        ? `长大啦！成为了${formNames[evolution.form || "balanced"]}。`
        : `进入成长期，${stageLook(pet?.species ?? -1, "growing").pose}！`,
    );
    setEvolution(null);
  }, [evolution, uncertain, unavailable, corrupt, page, busy, clip, pet?.sleeping, pet?.game, pet?.species, tools, help, reset, foreground]);
  useEffect(() => { recapDisplayEpoch.current++; }, [page, tools, help, reset]);
  // Let confirmed care feedback and any saved growth celebration finish before
  // automatically presenting a recap. Care feedback keeps its existing full
  // home reading interval; the persistent outcome must not block the recap.
  // Navigation/backgrounding cancels only this automatic presentation;
  // the acknowledged card stays in the menu.
  useEffect(() => {
    if (!queuedReturn) return;
    if (
      queuedReturn.epoch !== recapDisplayEpoch.current || !foreground || !windowFocused || !windowActive.current || document.hidden ||
      page !== "home" || tools || help || reset || uncertain || unavailable || corrupt ||
      !pet?.hatchedAt || pet.sleeping || pet.game || returnRecap?.id !== queuedReturn.id
    ) {
      setQueuedReturn(null);
      return;
    }
    if (busy || evolution || clip || careFeedback) return;
    setQueuedReturn(null);
    setReturnReading({ id: queuedReturn.id, page: 0, updated: false });
    navigateReturnReading(queuedReturn.id, 0);
    setPage("return");
  }, [queuedReturn, page, tools, help, reset, uncertain, unavailable, corrupt, pet?.hatchedAt, pet?.sleeping, pet?.game, returnRecap?.id, busy, evolution, clip, careFeedback, foreground, windowFocused]);
  useEffect(() => {
    if (
      uncertain || unavailable || corrupt ||
      !returnRecap ||
      !returnPending ||
      // A focused return may be replacing an initially read pending recap.
      // Wait for that read before claiming or invalidating its sync epoch.
      readInFlight.current !== null ||
      page !== "home" ||
      busy ||
      clip ||
      evolution ||
      careFeedback ||
      pet?.sleeping ||
      pet?.game ||
      tools ||
      help ||
      reset ||
      !foreground ||
      !windowFocused ||
      document.hidden ||
      !windowActive.current ||
      returnAttempt.current === returnRecap.id
    )
      return;
    returnAttempt.current = returnRecap.id;
    const displayEpoch = recapDisplayEpoch.current;
    syncEpoch.current++;
    busyRef.current = true;
    setBusy(true);
    void request("recap/read", { id: returnRecap.id }, acceptedGeneration.current)
      .then((r) => {
        if (!acceptCurrentRead(r)) { markUncertain(); return; }
        if (
          displayEpoch === recapDisplayEpoch.current && !document.hidden && windowActive.current &&
          r.state.hatchedAt > 0 && r.recapClaimed &&
          r.returnRecap?.id === returnRecap.id &&
          !r.state.sleeping &&
          !r.state.game
        ) {
          setQueuedReturn({ id: returnRecap.id, epoch: displayEpoch });
        }
      })
      .catch((error: unknown) => {
        if (isClockAhead(error)) { markClockAhead(); return; }
        if (isSaveCorrupt(error)) { markCorrupt(false, failureGeneration(error)); return; }
        if (isSaveChanged(error)) { markChangeRejected("save"); return; }
        if (needsReconciliation(error)) { markUncertain(); return; }
        // If not accepted, a later heartbeat retries. If the response was lost
        // after acceptance, the saved recap remains available in the menu.
        setError("回访小结暂时没连上，下次连接时再看。");
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  }, [
    uncertain,
    unavailable,
    corrupt,
    markCorrupt,
    markClockAhead,
    markChangeRejected,
    markUncertain,
    returnRecap,
    returnPending,
    foreground,
    windowFocused,
    page,
    busy,
    clip,
    evolution,
    careFeedback,
    pet?.sleeping,
    pet?.game,
    tools,
    help,
    reset,
    acceptCurrentRead,
  ]);
  // Give the confirmed result a full reading interval on unobscured home.
  // As with menu navigation, returning from a panel/hidden tab starts eight
  // seconds afresh; it never replays a clip, action, or acknowledged reward.
  useEffect(() => {
    if (!careFeedback || clip || evolution || page !== "home" ||
      !foreground || document.hidden || tools || help || reset) return;
    const timer = setTimeout(() => setCareFeedback(null), 8000);
    return () => clearTimeout(timer);
  }, [careFeedback, clip, evolution, page, foreground, tools, help, reset]);
  function finishClip() {
    activeEvolution.current = null;
    clipRef.current = null;
    setClip(null);
  }
  useEffect(() => {
    if (!help && !reset) return;
    const previous = modalReturnFocus.current || document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const trap = (event: KeyboardEvent) => {
      // Keep IME selection and native shortcuts (such as copy) out of modal controls.
      if (event.isComposing || event.keyCode === 229 ||
        event.metaKey || event.ctrlKey || event.altKey) return;
      const editing = event.target instanceof HTMLElement &&
        (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      if (event.key === "Escape" || (!editing && event.key.toLowerCase() === "c")) {
        event.preventDefault();
        event.stopPropagation();
        setHelp(false);
        setReset(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),a[href],input:not(:disabled)",
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
      // The tools menu is outside the three-key surface. Returning focus to
      // that removed/ordinary button makes keyboard A/B/C appear dead, so
      // resume from the physical C key where the LCD shortcut is unambiguous.
      const fallback = document.querySelector<HTMLButtonElement>(".physical-button.button-c");
      if (fallback?.isConnected) fallback.focus({ preventScroll: true });
      else if (previous?.isConnected) previous.focus();
      modalReturnFocus.current = null;
    };
  }, [help, reset]);

  function beep(confirm = false) {
    void audio.current?.play(confirm);
  }

  async function act(kind: string, extra: Record<string, unknown> = {}) {
    if (busyRef.current || uncertainRef.current || unavailableRef.current || corruptRef.current) return false;
    syncEpoch.current++;
    if (kind === "tile-pick") setTileHint(null);
    setCareFeedback(null);
    setCareOutcome(null);
    // A new acknowledged action starts a fresh receipt window. The previous
    // game result is no longer the primary explanation on the home/status page.
    setGameOutcome(null);
    setTreasureReaction(null); setStarsReaction(null);
    setHomeEcho(null);
    busyRef.current = true;
    setBusy(true);
    busyActionRef.current = kind;
    setBusyAction(kind);
    let succeeded = false;
    const activeEpoch = fishingEpoch.current;
    const actionStartedAt = performance.now();
    const activeWalkEpoch = walkEpoch.current;
    const activeBoardEpoch = boardEpoch.current;
    const echoEpoch = homeEchoEpoch.current;
    try {
      const body = {
        kind,
        ...((kind === "catch" ||
          kind === "cancel-play" ||
          kind === "tile-pick" ||
          kind === "tile-clear" ||
          kind.startsWith("snake-") || kind.startsWith("tetris-") || kind.startsWith("fish-") || kind.startsWith("walk-") || kind.startsWith("treasure-")) &&
          pet?.game?.id
          ? { gameId: pet.game.id }
          : {}),
        ...extra,
        requestId: crypto.randomUUID(),
      };
      const r = kind === "sleep"
        ? await request("action", body, acceptedGeneration.current, pet?.sleeping)
        : await request("action", body, acceptedGeneration.current);
      if (!apply(r)) {
        markUncertain();
        return false;
      }
      const outcome = completedGameOutcome(kind, pet, r);
      if (outcome) setGameOutcome(outcome);
      // Only this live pulse may announce its own wait -> bite transition.
      // Reads, resumes, restored games, late replies after an interruption and
      // repeated bite pulses are intentionally silent. Visual cues remain primary.
      const beforeFish = pet?.game?.fishing, afterFish = r.state.game?.fishing;
      if (kind === "fish-step" && page === "game" && pet?.game?.kind === "fishing"
        && fishingSession === pet.game.id && r.state.game?.id === pet.game.id
        && beforeFish?.phase === "wait" && !beforeFish.paused
        && afterFish?.phase === "bite" && !afterFish.paused
        && activeEpoch === fishingEpoch.current && performance.now() - actionStartedAt <= 1500
        && !document.hidden && windowActive.current)
        audio.current?.bite();
      if (kind === "catch" && page === "game" && activeBoardEpoch === boardEpoch.current
        && performance.now() - actionStartedAt <= 2000 && !document.hidden && windowActive.current)
        setStarsReaction(starsReactionFor(pet?.game, r.state.game, extra.lane));
      if (kind === "treasure-dig" && page === "game" && treasureSession === pet?.game?.id
        && activeBoardEpoch === boardEpoch.current && performance.now() - actionStartedAt <= 2000
        && !document.hidden && windowActive.current)
        setTreasureReaction(treasureReactionFor(pet?.game, r.state.game, extra.tile, ++treasureReactionSerial.current));
      if (kind === "treasure-resume" && activeBoardEpoch === boardEpoch.current && !document.hidden && windowActive.current) setTreasureSession(r.state.game?.id ?? "");
      if (["treasure-resume", "treasure-dig"].includes(kind) && page === "game"
        && activeBoardEpoch === boardEpoch.current && !document.hidden && windowActive.current
        && pet?.game?.id && r.state.game?.id === pet.game.id && r.state.game.treasure) {
        setTreasureDestination({ sessionKey: pet.game.id, target: treasureDone(r.state.game.treasure)
          ? "done" : kind === "treasure-dig" ? "result" : "selection" });
      }
      if (["treasure-pause", "treasure-finish", "cancel-play"].includes(kind)) { setTreasureSession(""); setTreasureChoice(0); }
      const activeGameID = pet?.game?.id;
      const activeGameKind = pet?.game?.kind;
      if (activeGameID && activeGameKind === "fishing")
        recordNewDiscoveries("fish", activeGameID, pet?.pond?.fish,
          r.state.pond?.fish, pendingDiscoveryEchoes.current, seenDiscoveries.current);
      if (activeGameID && activeGameKind === "walk")
        recordNewDiscoveries("park", activeGameID, pet?.park?.finds,
          r.state.park?.finds, pendingDiscoveryEchoes.current, seenDiscoveries.current);
      const discoveryEcho = !r.state.game && activeGameID && ["fish-finish", "walk-finish", "cancel-play"].includes(kind)
        ? activeGameKind === "fishing"
          ? takeDiscoveryEcho("fish", activeGameID, pendingDiscoveryEchoes.current)
          : activeGameKind === "walk"
            ? takeDiscoveryEcho("park", activeGameID, pendingDiscoveryEchoes.current)
            : null
        : null;
      const experience = completedExperience(activeGameID, r.state.companion?.recent, !!r.careFeedback && !r.state.game, seenExperiences.current);
      if ((discoveryEcho || experience) && !document.hidden && echoEpoch === homeEchoEpoch.current)
        setHomeEcho({ kind: discoveryEcho ?? experience!.kind, monotonicUntil: performance.now() + 12000 });
      if (kind === "walk-resume" && activeWalkEpoch === walkEpoch.current && !document.hidden && windowActive.current) setWalkSession(r.state.game?.id ?? "");
      if (["walk-pause","walk-finish","cancel-play"].includes(kind)) {setWalkSession("");setWalkChoice(0);}
      if (["fish-cast", "fish-resume"].includes(kind) && activeEpoch === fishingEpoch.current && !document.hidden && windowActive.current) setFishingSession(r.state.game?.id ?? "");
      if (["fish-pause", "fish-finish", "cancel-play"].includes(kind)) { setFishingSession(""); setFishingChoice(0); }
      if (["tetris-resume", "tetris-rotate", "tetris-drop"].includes(kind) && activeBoardEpoch === boardEpoch.current && !document.hidden && windowActive.current) setTetrisSession(r.state.game?.id ?? "");
      if (["tetris-pause", "tetris-finish", "cancel-play"].includes(kind)) { setTetrisSession(""); setTetrisChoice(0); }
      if (kind === "snake-resume" && activeBoardEpoch === boardEpoch.current && !document.hidden && windowActive.current) setSnakeSession(r.state.game?.id ?? "");
      if (
        kind === "snake-pause" ||
        kind === "snake-finish" ||
        kind === "cancel-play"
      ) setSnakeSession("");
      // Explicit, confirmed tile feedback only: snapshots and late replies must
      // not pull a reader back to the board after a recovery or window change.
      const tileKey = gameSessionKey(r.state.game);
      if ((kind === "play-tiles" || (["tile-pick", "tile-clear"].includes(kind)
        && page === "game" && tileKey === gameSessionKey(pet?.game)))
        && tileKey && r.state.game?.tiles && activeBoardEpoch === boardEpoch.current
        && !document.hidden && windowActive.current)
        setTileDestination({ sessionKey: tileKey, target: kind === "play-tiles" ? "selection" : "feedback" });
      // A saved pair still applies after interruption, but its transient link
      // belongs only to the uninterrupted action in this game session.
      if (kind === "tile-pick" && page === "game" && r.tileLink?.length && pet?.game?.tiles
        && (!r.state.game || tileKey === gameSessionKey(pet.game))
        && activeBoardEpoch === boardEpoch.current && !document.hidden && windowActive.current) {
        setTileLink({
          path:
            r.state.game?.tiles &&
              r.state.game.tiles.shuffles !== pet.game.tiles.shuffles
              ? []
              : r.tileLink,
          tile: pet.game.tiles.board[pet.game.tiles.pick],
          id: ++tileLinkSequence.current,
        });
      }
      if (kind === "tile-pick" && r.tileHint?.length && tileKey && pet?.game?.tiles
        && tileHintShownFor.current !== tileKey
        && r.state.game?.tiles && tileKey === gameSessionKey(pet.game)
        && activeBoardEpoch === boardEpoch.current && !document.hidden && windowActive.current) {
        tileHintShownFor.current = tileKey;
        setTileHint({ path: r.tileHint, id: ++tileHintSequence.current });
      }
      setCareFeedback(r.careFeedback ?? null);
      setCareOutcome(r.careFeedback ?? null);
      const clipKind = careClip(kind, r.state.sleeping);
      if (clipKind) {
        const next = { kind: clipKind, id: ++clipSequence.current };
        clipRef.current = next;
        setClip(next);
      }
      if (kind === "hatch") {
        setPage("home");
      } else if (
        games.some(game => game.startAction === kind)
      ) {
        setPage("game");
        setLane(1);
        setTileHint(null);
        setTileCursor(nextTile(r.state.game?.tiles?.board ?? [], -1));
        setTileLink(null);
      } else if (
        (kind === "catch" || kind === "tile-pick" ||
          (["snake-finish", "tetris-finish", "fish-finish", "walk-finish", "treasure-finish"].includes(kind) && r.careFeedback)) && !r.state.game
      ) {
        setPage("home");
        const next = { kind: "play" as const, id: ++clipSequence.current };
        clipRef.current = next;
        setClip(next);
      } else if (kind === "cancel-play" || kind === "snake-finish" || kind === "tetris-finish" || kind === "fish-finish" || kind === "walk-finish" || kind === "treasure-finish") {
        setTileLink(null);
        setPage("home");
      } else if (kind === "feed" || kind === "clean" || kind === "sleep") {
        setPage("home");
      }
      succeeded = true;
      return true;
    } catch (e) {
      if (isClockAhead(e)) markClockAhead();
      else if (isSaveCorrupt(e)) markCorrupt(false, failureGeneration(e));
      else if (isSaveChanged(e)) markChangeRejected("save");
      else if (isGameFinished(e)) markChangeRejected("game");
      else if (isSleepChanged(e)) markChangeRejected("sleep");
      else if (needsReconciliation(e)) markUncertain();
      else setError(e instanceof Error ? e.message : "操作被拒绝，请查看提示。");
      return false;
    } finally {
      busyRef.current = false;
      busyActionRef.current = "";
      setBusyAction("");
      setBusy(false);
      if (kind === "snake-step" || kind === "tetris-step") {
        const pause = pendingBoardPause.current;
        pendingBoardPause.current = null;
        const game = acceptedPet.current?.game;
        const board = pause?.kind === "snake" ? game?.snake : game?.tetris;
        // Only the acknowledged automatic step may carry a pause intent. An
        // ended board still needs a new keypress to collect, never this old C.
        if (succeeded && pause && kind === `${pause.kind}-step` && pause.epoch === boardEpoch.current &&
          pause.generation === acceptedGeneration.current && game?.id === pause.id && game.kind === pause.kind &&
          board && !board.paused && !board.end && !clockAheadRef.current &&
          !document.hidden && windowActive.current && !uncertainRef.current &&
          !unavailableRef.current && !corruptRef.current) {
          void act(`${pause.kind}-pause`, { gameId: pause.id, step: board.step });
        }
      }
      if (kind === "walk-step") {
        const pause = pendingWalkPause.current;
        pendingWalkPause.current = null;
        const game = acceptedPet.current?.game;
        // A pause is not a finish command: reaching beat 72 still needs an
        // explicit new keypress to collect. Unknown steps are never replayed.
        if (succeeded && pause && pause.epoch === walkEpoch.current &&
          pause.generation === acceptedGeneration.current && game?.id === pause.id &&
          game.kind === "walk" && game.walking && !game.walking.paused && game.walking.beat < 72 &&
          !clockAheadRef.current && !document.hidden && windowActive.current &&
          !uncertainRef.current && !unavailableRef.current && !corruptRef.current) {
          void act("walk-pause", { gameId: pause.id, step: game.walking.step });
        }
      }
      if (kind === "fish-step") {
        const pause = pendingFishingPause.current;
        pendingFishingPause.current = null;
        const game = acceptedPet.current?.game;
        // Serialize the pause behind an acknowledged pulse, using its new step.
        // Interruption epochs and generation/session checks forbid delayed
        // writes after a blur, overlay, save replacement, or uncertain reply.
        if (succeeded && pause && pause.epoch === fishingEpoch.current &&
          pause.generation === acceptedGeneration.current && game?.id === pause.id &&
          game.fishing && !game.fishing.paused && game.fishing.phase !== "done" &&
          !clockAheadRef.current && !document.hidden && windowActive.current &&
          !uncertainRef.current && !unavailableRef.current && !corruptRef.current) {
          void act("fish-pause", { gameId: pause.id, step: game.fishing.step });
        }
      }
    }
  }
  useEffect(() => {
    if (tools || help || reset) {
      audio.current?.cancel();
      setTileLink(null);
      setTileHint(null);
      boardEpoch.current++;
      walkEpoch.current++;setWalkSession(""); setTreasureSession(""); setTreasureReaction(null); setStarsReaction(null);
      fishingEpoch.current++;
      setFishingSession("");
      setTetrisSession("");
      setSnakeSession("");
      snakeTurn.current = 0;
      setQueuedTurn(0);
    }
  }, [tools, help, reset]);
  useEffect(() => {
    const n = pet?.game?.walking;
    if(page!=="game" || !n || n.paused || n.beat===72 || walkSession!==pet.game?.id || busy || (document.hidden || !windowActive.current) || tools || help || reset || abandoning)return;
    const epoch = walkEpoch.current;
    const timer=setTimeout(()=>{
      if (epoch !== walkEpoch.current) return;
      if(document.hidden || !windowActive.current){walkEpoch.current++;setWalkSession("");return;}
      void act("walk-step",{step:n.step}).then(ok=>{if(!ok){walkEpoch.current++;setWalkSession("");void refresh();}});
    },Math.max(80,1050-(readServerClock(clock.current)-n.lastPulseAt)));
    return ()=>clearTimeout(timer);
  },[pet?.game,walkSession,page,busy,tools,help,reset,abandoning]);
  useEffect(() => {
    const n = pet?.game?.fishing;
    if (page !== "game" || !n || n.paused || !["wait", "bite"].includes(n.phase) || fishingSession !== pet.game?.id || busy || (document.hidden || !windowActive.current) || tools || help || reset || abandoning) return;
    const epoch = fishingEpoch.current;
    const timer = setTimeout(() => {
      if (epoch !== fishingEpoch.current) return;
      if (document.hidden || !windowActive.current) { fishingEpoch.current++; setFishingSession(""); return; }
      void act("fish-step", { step: n.step }).then(ok => {
        if (!ok) {
          fishingEpoch.current++;
          setFishingSession("");
          void refresh();
        }
      });
    }, Math.max(80, 1050 - (readServerClock(clock.current) - n.lastPulseAt)));
    return () => clearTimeout(timer);
  }, [pet?.game, fishingSession, page, busy, tools, help, reset, abandoning]);
  useEffect(() => {
    const n = pet?.game?.tetris;
    if (page !== "game" || !n || n.paused || n.end || tetrisSession !== pet.game?.id || busy || (document.hidden || !windowActive.current) || tools || help || reset || abandoning) return;
    const epoch = boardEpoch.current;
    const timer = setTimeout(() => {
      if (epoch !== boardEpoch.current) return;
      if (document.hidden || !windowActive.current) { boardEpoch.current++; setTetrisSession(""); return; }
      void act("tetris-step", { step: n.step }).then(ok => {
        if (!ok) { setTetrisSession(""); void refresh(); }
      });
    }, Math.max(40, 1050 - (readServerClock(clock.current) - n.lastFallAt)));
    return () => clearTimeout(timer);
  }, [pet?.game, tetrisSession, page, busy, tools, help, reset, abandoning]);
  useEffect(() => {
    const n = pet?.game?.snake;
    if (
      page !== "game" || !n || n.paused || n.end ||
      snakeSession !== pet.game?.id || busy || (document.hidden || !windowActive.current) ||
      tools || help || reset || abandoning
    ) return;
    // The server applies at most one cell and verifies the expected step.
    // Never synthesize missed beats after backgrounding or a slow request.
    const epoch = boardEpoch.current;
    const timer = setTimeout(() => {
      if (epoch !== boardEpoch.current) return;
      if (document.hidden || !windowActive.current) {
        boardEpoch.current++;
        setSnakeSession("");
        return;
      }
      const turn = snakeTurn.current;
      snakeTurn.current = 0;
      setQueuedTurn(0);
      void act("snake-step", { step: n.step, turn }).then((ok) => {
        if (!ok) {
          setSnakeSession("");
          void refresh();
        }
      });
    }, Math.max(80, 650 - (readServerClock(clock.current) - n.lastMoveAt)));
    return () => clearTimeout(timer);
  }, [pet?.game, snakeSession, page, busy, tools, help, reset, abandoning]);
  useEffect(() => {
    const stop = () => {
      audio.current?.cancel();
      setTileLink(null);
      setTileHint(null);
      boardEpoch.current++;
      walkEpoch.current++; setWalkSession(""); setTreasureSession(""); setTreasureReaction(null); setStarsReaction(null);
      fishingEpoch.current++; setFishingSession("");
      setSnakeSession("");
      setTetrisSession("");
      snakeTurn.current = 0;
      setQueuedTurn(0);
    };
    const visibility = () => { if (document.hidden) stop(); };
    const blur = (event: Event) => {
      // Element focus changes can bubble in synthetic/embedded environments.
      // Invalidate synchronously, before an already-due game callback can run.
      if (event.target !== event.currentTarget) return;
      stop();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      // A pulse may resolve after the component is gone; never write a queued
      // pause from a disposed page (including StrictMode cleanup).
      fishingEpoch.current++;
      pendingFishingPause.current = null;
      walkEpoch.current++;
      pendingWalkPause.current = null;
      boardEpoch.current++;
      pendingBoardPause.current = null;
    };
  }, []);

  const openPauseGuide = () => {
    // Invalidate local run permission and any late automatic callback. Merely
    // reading does not persist a pause, step, reward or tutorial preference.
    boardEpoch.current++; fishingEpoch.current++; walkEpoch.current++;
    setTetrisSession(""); setFishingSession(""); setWalkSession(""); setTreasureSession(""); setTreasureReaction(null); setStarsReaction(null);
    setPauseGuideSession(sessionKey); setGuidePage(0); setPage("pause-guide");
    setPauseReadingDestination({ sessionKey, target: "guide" });
  };
  const canPauseFishingPulse = (kind: string) => kind === "fish-step" && page === "game" &&
    pet?.game?.kind === "fishing" && !!pet.game.id && fishingSession === pet.game.id &&
    !!pet.game.fishing && !pet.game.fishing.paused && ["wait", "bite"].includes(pet.game.fishing.phase) &&
    !tools && !help && !reset && !abandoning && !document.hidden && windowActive.current &&
    !uncertainRef.current && !unavailableRef.current && !corruptRef.current;
  const canPauseWalkingStep = (kind: string) => kind === "walk-step" && page === "game" &&
    pet?.game?.kind === "walk" && !!pet.game.id && walkSession === pet.game.id &&
    !!pet.game.walking && !pet.game.walking.paused && pet.game.walking.beat < 72 &&
    !tools && !help && !reset && !abandoning && !document.hidden && windowActive.current &&
    !clockAheadRef.current && !uncertainRef.current && !unavailableRef.current && !corruptRef.current;
  const canPauseBoardStep = (kind: string) => {
    const game = pet?.game;
    if (!game || page !== "game" || tools || help || reset || abandoning || document.hidden || !windowActive.current ||
      clockAheadRef.current || uncertainRef.current || unavailableRef.current || corruptRef.current) return false;
    return (kind === "snake-step" && game.kind === "snake" && snakeSession === game.id &&
      !!game.snake && !game.snake.paused && !game.snake.end) ||
      (kind === "tetris-step" && game.kind === "tetris" && tetrisSession === game.id &&
      !!game.tetris && !game.tetris.paused && !game.tetris.end);
  };
  const controls = useRef<(key: string) => void>(() => {});
  controls.current = (key: string) => {
    // External overlays own C even while a save write is still in flight.
    // Otherwise a slow request can leave keyboard users trapped in the overlay.
    if ((tools || help || reset) && key === "C") {
      setHelp(false);
      setReset(false);
      if (tools) setTools(false);
      return;
    }
    if (busyRef.current) {
      if (key === "C" && pet?.game?.id && canPauseFishingPulse(busyActionRef.current) && !pendingFishingPause.current) {
        audio.current?.cancel();
        fishingEpoch.current++;
        pendingFishingPause.current = { id: pet.game.id, generation: acceptedGeneration.current, epoch: fishingEpoch.current };
        setFishingSession(""); setFishingChoice(0);
      } else if (key === "C" && pet?.game?.id && canPauseWalkingStep(busyActionRef.current) && !pendingWalkPause.current) {
        audio.current?.cancel();
        walkEpoch.current++;
        pendingWalkPause.current = { id: pet.game.id, generation: acceptedGeneration.current, epoch: walkEpoch.current };
        setWalkSession(""); setWalkChoice(0);
      } else if (key === "C" && pet?.game?.id && (pet.game.kind === "snake" || pet.game.kind === "tetris") &&
        canPauseBoardStep(busyActionRef.current) && !pendingBoardPause.current) {
        audio.current?.cancel();
        boardEpoch.current++;
        pendingBoardPause.current = { kind: pet.game.kind, id: pet.game.id, generation: acceptedGeneration.current, epoch: boardEpoch.current };
        setSnakeSession(""); setTetrisSession(""); setTetrisChoice(0);
        snakeTurn.current = 0; setQueuedTurn(0);
      }
      return;
    }
    if (uncertainRef.current || unavailableRef.current) {
      if (key === "B") void refresh();
      return;
    }
    if (tools || help || reset) return;
    if (clipRef.current) {
      if (key === "C") {
        beep();
        setHomeEcho(null);
        finishClip();
      }
      return;
    }
    setPressed(key);
    setTimeout(() => setPressed(""), 140);
    // A deliberate fishing input takes over from the optional bite cue,
    // especially when pausing or reeling; do not let it ring over the next view.
    if (page === "game" && pet?.game?.kind === "fishing") audio.current?.cancel();
    beep(key === "B");
    if (page === "import-preview") {
      setError("");
      if (key === "A" || key === "C") cancelImport();
      else if (key === "B" && pendingImportRef.current?.backup) void confirmImport();
      return;
    }
    if (corruptRef.current || !pet) {
      if (key === "B") void refresh();
      return;
    }
    setError("");
    if (page === "journal") {
      if (key === "C") setPage("home");
      else {
        setJournalCursor(cursor => (key === "A" ? nextJournal : previousJournal)(pet.logs, cursor));
        navigateCareReading("journal");
      }
      return;
    }
    if (page === "album") {
      if (albumCategory === null) {
        if (key === "A") { setAlbumChoice(v => (v + 1) % albumCategories.length); navigateAlbumReading(null); }
        else if (key === "B") {
          const category = albumCategories[albumChoice].id;
          setAlbumCategory(category); setAlbumCursor(startAlbum()); navigateAlbumReading(category);
        }
        else if (key === "C") setPage("home");
      } else if (key === "C") {
        if (returningToPause) {
          setAlbumReturnSession(null);
          setPage("game"); setPauseReadingDestination({ sessionKey, target: "pause" });
        } else { setAlbumCategory(null); navigateAlbumReading(null); }
      }
      else if (key === "A" || key === "B") {
        setAlbumCursor(cursor => (key === "A" ? previousAlbum : nextAlbum)(pet, albumCategory, cursor)); navigateAlbumReading(albumCategory);
      }
      return;
    }
    if (page === "park-album") {
      if (key === "C") {
        setPage(pet.game?.kind === "walk" ? "game" : "home"); setWalkChoice(0);
        if (pet.game?.kind === "walk") setPauseReadingDestination({ sessionKey, target: "pause" });
      } else {
        const next = (parkPage + (key === "A" ? parkCatalog.length - 1 : 1)) % parkCatalog.length;
        setParkPage(next); navigateCollectionReading("park-album", next);
      }
      return;
    }
    if (page === "fish-album") {
      if (key === "C") {
        setPage(pet.game?.kind === "fishing" ? "game" : "home"); setFishingChoice(0);
        if (pet.game?.kind === "fishing") setPauseReadingDestination({ sessionKey, target: "pause" });
      } else {
        const count = fishCatalogFor(pet).length;
        const next = (fishPage + (key === "A" ? count - 1 : 1)) % count;
        setFishPage(next); navigateCollectionReading("fish-album", next);
      }
      return;
    }
    if (page === "arcade") {
      if (key === "A") {
        const next = (arcadeChoice + 1) % games.length;
        setArcadeChoice(next); navigateArcadeReading("arcade", next);
      } else if (key === "C") setPage("home");
      else if (pet.sleeping) setError("它正在睡觉，先从菜单选「起床啦」，醒来后再一起玩。");
      else { setGuidePage(0); setGuideReview(false); setPage("game-guide"); navigateArcadeReading("game-guide"); }
      return;
    }
    if (page === "pause-guide") {
      if (key === "C" || !pauseGuide) {
        setPauseGuideSession(null);
        setPage(pet.game ? "game" : "home");
        if (pauseGuide) setPauseReadingDestination({ sessionKey, target: "pause" });
      } else {
        setGuidePage(v => (v + 1) % 2);
        setPauseReadingDestination({ sessionKey, target: "guide" });
      }
      return;
    }
    if (page === "game-guide") {
      if (key === "A") {
        if (guideSeen(games[arcadeChoice].id) && !guideReview) { setGuideReview(true); setGuidePage(0); }
        else setGuidePage(v => (v + 1) % 2);
        navigateArcadeReading("game-guide");
      }
      else if (key === "C") { setPage("arcade"); navigateArcadeReading("arcade"); }
      else if (pet.sleeping) setError("它正在睡觉，先从菜单选「起床啦」，醒来后再一起玩。");
      else {
        const game = games[arcadeChoice];
        void act(game.startAction).then(ok => { if (ok) rememberGuide(game.id); });
      }
      return;
    }
    if (abandoning) {
      if (key === "B") void act("cancel-play").then(ok => { if (ok) setAbandonGame(null); });
      else {
        setAbandonGame(null); setTetrisChoice(0); setFishingChoice(0); setWalkChoice(0); setTreasureChoice(0);
        if (pet.game?.kind === "tiles" && sessionKey) setTileDestination({ sessionKey, target: "selection" });
      }
      return;
    }
    if (page === "game" && !abandoning && pet.game?.kind === "treasure" && pet.game.treasure) {
      const n = pet.game.treasure;
      if (treasureDone(n)) {
        if (key === "A") setMessage("本局已经结束，A 暂不操作；按 B 或 C 收好本局发现。");
        else void act("treasure-finish", { step: n.step });
      } else if (n.paused || treasureSession !== pet.game.id) {
        if (key === "A") setTreasureChoice(v => (v + 1) % treasureMenu.length);
        else if (key === "C" || treasureChoice === 0) void act("treasure-resume", { step: n.step });
        else if (treasureChoice === 1) openPauseGuide();
        else { boardEpoch.current++; setTreasureSession(""); setAbandonGame(sessionKey); }
      } else if (key === "C") {
        boardEpoch.current++; setTreasureSession(""); setTreasureChoice(0);
        setPauseReadingDestination({ sessionKey, target: "pause" });
        void act("treasure-pause", { step: n.step });
      } else if (key === "A") {
        setTreasureCursor(nextTreasure(n, treasureCursor));
        setTreasureDestination({ sessionKey: pet.game.id!, target: "selection" });
      }
      else void act("treasure-dig", { step: n.step, tile: treasureCursor });
      return;
    }
    if(page==="game" && !abandoning && pet.game?.kind==="walk" && pet.game.walking) {
      const n=pet.game.walking;
      if(n.beat===72) {
        if (key === "A") setMessage("本局已经结束，A 暂不操作；按 B 或 C 收好本局发现。");
        else void act("walk-finish",{step:n.step});
      }
      else if(n.paused || walkSession!==pet.game.id) {
        if(key==="A")setWalkChoice(v=>(v+1)%walkMenu.length);
        else if(key==="C" || walkChoice===0)void act("walk-resume",{step:n.step});
        else if(walkChoice===1){walkEpoch.current++;setWalkSession("");setParkPage(0);setPage("park-album");navigateCollectionReading("park-album", 0);}
        else if (walkChoice === 4) openPauseGuide();
        else if (walkChoice === 3) {
          walkEpoch.current++; setWalkSession("");
          setAlbumReturnSession(sessionKey); setAlbumCategory("scenery"); setAlbumCursor(startAlbum()); setPage("album"); navigateAlbumReading("scenery");
        }
        else {walkEpoch.current++;setWalkSession("");setAbandonGame(sessionKey);}
      } else if(key==="C") {
        walkEpoch.current++;setWalkSession("");setWalkChoice(0);void act("walk-pause",{step:n.step});
      } else void act(key==="A"?"walk-jump":"walk-duck",{step:n.step});
      return;
    }
    if (page === "game" && !abandoning && pet.game?.kind === "fishing" && pet.game.fishing) {
      const n = pet.game.fishing;
      const paused = n.paused || (["wait", "bite"].includes(n.phase) && fishingSession !== pet.game.id);
      if (n.phase === "done") {
        if (key === "A") setMessage("本局已经结束，A 暂不操作；按 B 或 C 收好本局发现。");
        else void act("fish-finish", { step: n.step });
      } else if (paused) {
        if (key === "A") setFishingChoice(v => (v + 1) % fishingMenu.length);
        else if (key === "C" || fishingChoice === 0) void act("fish-resume", { step: n.step });
        else if (fishingChoice === 1) { setFishingSession(""); setFishPage(0); setPage("fish-album"); navigateCollectionReading("fish-album", 0); }
        else if (fishingChoice === 4) openPauseGuide();
        else if (fishingChoice === 3) {
          fishingEpoch.current++; setFishingSession("");
          setAlbumReturnSession(sessionKey); setAlbumCategory("scenery"); setAlbumCursor(startAlbum()); setPage("album"); navigateAlbumReading("scenery");
        }
        else { setFishingSession(""); setAbandonGame(sessionKey); }
      } else if (key === "C") {
        fishingEpoch.current++; setFishingSession(""); setFishingChoice(0);
        void act("fish-pause", { step: n.step });
      } else if (key === "A") {
        if (["ready", "result"].includes(n.phase)) void act("fish-spot", { step: n.step });
      } else void act(["wait", "bite"].includes(n.phase) ? "fish-reel" : "fish-cast", { step: n.step });
      return;
    }
    if (page === "game" && !abandoning && pet.game?.kind === "tetris" && pet.game.tetris) {
      const n = pet.game.tetris;
      if (n.end) {
        if (key === "A") setMessage("本局已经结束，A 暂不操作；按 B 或 C 收好本局成绩。");
        else void act("tetris-finish", { step: n.step });
      } else if (n.paused || tetrisSession !== pet.game.id) {
        if (key === "A") setTetrisChoice(v => (v + 1) % tetrisOptions.length);
        else if (key === "B" && tetrisChoice === 4) openPauseGuide();
        else {
          const kind = key === "C" ? "tetris-resume" : ["tetris-resume", "tetris-rotate", "tetris-drop", "cancel-play"][tetrisChoice];
          // After a reload the local pause may not yet be persisted. Save it
          // before a menu operation; the server never runs offline gravity.
          if (kind === "cancel-play") { setTetrisSession(""); setAbandonGame(sessionKey); }
          else if (!n.paused && (kind === "tetris-rotate" || kind === "tetris-drop")) {
            const epoch = boardEpoch.current;
            void act("tetris-pause", { step: n.step }).then(ok => {
              if (ok && epoch === boardEpoch.current && !document.hidden && windowActive.current) void act(kind, { step: n.step + 1 });
            });
          } else void act(kind, { step: n.step });
        }
      } else if (key === "C") {
        setTetrisSession(""); setTetrisChoice(0);
        void act("tetris-pause", { step: n.step });
      } else void act("tetris-move", { step: n.step, turn: key === "A" ? -1 : 1 });
      return;
    }
    if (page === "game" && !abandoning && pet.game?.kind === "snake" && pet.game.snake) {
      const n = pet.game.snake;
      if (n.end) {
        if (key === "A") setMessage("本局已经结束，A 暂不操作；按 B 或 C 收好本局成绩。");
        else void act("snake-finish", { step: n.step });
      } else if (n.paused || snakeSession !== pet.game.id) {
        snakeTurn.current = 0;
        setQueuedTurn(0);
        if (key === "B") { setSnakeSession(""); setAbandonGame(sessionKey); }
        else void act("snake-resume", { step: n.step });
      } else if (key === "C") {
        setSnakeSession("");
        void act("snake-pause", { step: n.step });
      } else if (!snakeTurn.current) {
        snakeTurn.current = key === "A" ? -1 : 1;
        setQueuedTurn(snakeTurn.current);
      }
      return;
    }
    if (page === "game" && !abandoning && pet.game?.kind === "tiles" && pet.game.tiles) {
      if (key === "A") {
        setTileCursor((v) => nextTile(pet.game!.tiles!.board, v));
        if (sessionKey) setTileDestination({ sessionKey, target: "selection" });
      } else if (key === "B") void act("tile-pick", { tile: tileCursor });
      else if (pet.game.tiles.pick >= 0) void act("tile-clear");
      else { setTileLink(null); setTileHint(null); setAbandonGame(sessionKey); }
      return;
    }
    if (page === "shop") {
      const items = shopCategory ? shopItems(shop, pet, shopCategory) : [];
      const itemIndex = selectedShopIndex(items, shopItemId);
      const item = items[itemIndex];
      setShopNotice("");
      if (purchaseConfirm) {
        // Even if an input races the reconciliation effect, never confirm a
        // different/changed item or convert the old B into an equip operation.
        if (!purchaseMatches(purchaseConfirm, item, pet)) {
          setPurchaseConfirm(null);
          setShopNotice("物品或当前状态已更新，购买确认已取消；请重新核对后再按 B。");
          return;
        }
        if (key === "A" || key === "C") {
          setPurchaseConfirm(null);
          navigateShopReading(shopCategory, item?.id ?? null, shopPage, "item");
        }
        else if (key === "B" && item) {
          if (pet.sleeping) setError("让它安心睡吧，起床后再操作。");
          else void act("buy", { item: item.id }).then(ok => {
            if (ok) setPurchaseConfirm(null);
          });
        }
      } else if (key === "A") {
        if (shopCategory) {
          const nextId = items[(itemIndex + 1) % Math.max(1, items.length)]?.id ?? null;
          setShopItemId(nextId);
          navigateShopReading(shopCategory, nextId, shopPage, "item");
        } else {
          const nextSection = (shopPage + 1) % shopSections.length;
          setShopPage(nextSection);
          navigateShopReading(null, null, nextSection, "section");
        }
      } else if (key === "C") {
        if (shopCategory) {
          const section = shopSections.findIndex(s => s.id === shopCategory);
          setShopPage(section);
          setShopCategory(null);
          navigateShopReading(null, null, section, "section");
        } else setPage("home");
      } else if (key === "B") {
        if (!pet.economy || !shop) setError("请更新小窝服务，再来逛小店。");
        else if (!shopCategory && shopPage !== 0) {
          const section = shopSections[shopPage];
          if (section.id !== "daily") {
            setShopCategory(section.id); setShopPage(0);
            const firstId = shopItems(shop, pet, section.id)[0]?.id ?? null;
            setShopItemId(firstId);
            navigateShopReading(section.id, firstId, 0, "item");
          }
        } else if (pet.sleeping) {
          setError("让它安心睡吧，起床后再操作。");
          navigateShopReading(shopCategory, item?.id ?? null, shopPage, "decision");
        } else if (!shopCategory) {
          navigateShopReading(null, null, shopPage, "decision");
          if (dailyClaimed(pet, now)) setMessage("今天的问候已经收好啦，不必连续来。");
          else if (dailyWalletNotice(pet, shop)) setMessage(dailyWalletNotice(pet, shop));
          else void act("daily");
        } else if (item) {
          if (pet.economy.owned?.includes(item.id)) {
            navigateShopReading(shopCategory, item.id, shopPage, "decision");
            void act("equip", { item: item.id });
          } else if (pet.economy.coins < item.price) {
            setMessage("金币还不够，慢慢来，不着急。");
            navigateShopReading(shopCategory, item.id, shopPage, "decision");
          } else {
            setPurchaseConfirm({ ...item });
            navigateShopReading(shopCategory, item.id, shopPage, "decision", true);
          }
        }
      }
      return;
    }
    if (page === "moment") {
      if (key === "A") {
        const nextChoice = (quietMomentChoice + 1) % 3;
        setQuietMomentChoice(nextChoice);
        navigateQuietReading(nextChoice);
        setQuietMomentReplied(false);
        setQuietMemoryKey(null);
      } else if (key === "B") {
        setQuietMomentReplied(true);
        navigateQuietReading(quietMomentChoice);
        if (!pet.sleeping && quietMomentChoice === 2) setQuietMemoryKey(value => nextQuietMemory(quietMemories(pet), value));
      } else if (key === "C") setPage("home");
      return;
    }
    if (page === "return") {
      if (!returnRecap) { setPage("home"); return; }
      if (key === "A" || (key === "B" && returnPage < returnPageCount - 1)) {
        const nextPage = (returnPage + 1) % returnPageCount;
        setReturnReading({ id: returnRecap.id, page: nextPage, updated: returnUpdated });
        navigateReturnReading(returnRecap.id, nextPage);
      } else setPage("home");
      return;
    }
    if (key === "A") {
      if (page === "choose") setChosen((v) => (v + 1) % 10);
      else if (page === "home") {
        setPage("menu");
        setSelected(0); navigateCareReading("menu");
      } else if (page === "menu") {
        setSelected((v) => (v + 1) % items.length); navigateCareReading("menu");
      }
      else if (page === "game") { setStarsReaction(null); setLane((v) => (v + 1) % 3); }
      else if (page === "status") {
        setStatusPage(v => (v + 1) % statusPageCount); navigateCareReading("status");
      }
      else if (page === "growth") {
        setGrowthPage((v) => (v + growthPageCount - 1) % growthPageCount); navigateCareReading("growth");
      }
      return;
    }
    if (key === "C") {
      if (page === "game") {
        setStarsReaction(null);
        setAbandonGame(sessionKey);
        return;
      }
      if (page === "home") {
        // C during a clip was consumed above. A separate home C acknowledges
        // the page-local receipt; it never deletes saved diary/album entries.
        if (document.activeElement?.matches(".care-outcome-reading,.game-outcome-reading"))
          document.querySelector<HTMLButtonElement>(".physical-button.button-c")?.focus({ preventScroll: true });
        setCareFeedback(null);
        setCareOutcome(null);
        setGameOutcome(null);
        setMessage("");
      } else if (page === "hatch") setPage("choose");
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
      setSelected(0); navigateCareReading("menu");
      return;
    }
    if (page === "menu") {
      const item = items[selected];
      if (item.kind === "arcade") {
        if (pet.sleeping) {
          setError("它正在睡觉，先从菜单选「起床啦」，醒来后再一起玩。");
          return;
        }
        setPage("arcade"); navigateArcadeReading("arcade");
      } else if (item.kind === "moment") {
        setQuietMomentChoice(0);
        setQuietMomentReplied(false);
        setQuietMemoryKey(null);
        setPage("moment");
        navigateQuietReading(0);
      } else if (item.kind === "return") {
        if (returnRecap) {
          setReturnReading({ id: returnRecap.id, page: 0, updated: false });
          navigateReturnReading(returnRecap.id, 0);
          setPage("return");
        } else
          setMessage(
            "还没有回访小结。离开至少 15 分钟后，回来会记录真实变化。",
          );
      } else if (item.kind === "shop") {
        setShopPage(0);
        setShopCategory(null);
        setShopItemId(null);
        setShopNotice("");
        setPurchaseConfirm(null);
        setPage("shop");
        navigateShopReading(null, null, 0, "section");
      } else if (item.kind === "park-album") {
        setPage("park-album");setParkPage(0);navigateCollectionReading("park-album", 0);
      } else if (item.kind === "fish-album") {
        setPage("fish-album"); setFishPage(0); navigateCollectionReading("fish-album", 0);
      } else if (item.kind === "album") {
        setAlbumReturnSession(null);
        setPage("album");
        setAlbumCategory(null);
        setAlbumChoice(0);
        setAlbumCursor(startAlbum()); navigateAlbumReading(null);
      } else if (item.kind === "status") {
        setStatusPage(0);
        setPage("status"); navigateCareReading("status");
      } else if (item.kind === "growth") {
        setPage("growth");
        setGrowthPage(0); navigateCareReading("growth");
      } else if (item.kind === "journal") {
        setPage("journal");
        setJournalCursor(startJournal(pet.logs)); navigateCareReading("journal");
      } else void act(item.kind);
    } else if (page === "game") void act("catch", { lane });
    else if (page === "growth") {
      setGrowthPage((v) => (v + 1) % growthPageCount); navigateCareReading("growth");
    }
    else setPage("home");
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented || e.isComposing || e.keyCode === 229 ||
        e.metaKey || e.ctrlKey || e.altKey
      ) return;
      const key = e.key.toLowerCase();
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT", "A"].includes(e.target.tagName))
      )
        return;
      // Keep native Enter/Space activation on external buttons, while letter
      // shortcuts remain available after a tool button has lost the overlay.
      if (e.target instanceof HTMLButtonElement &&
        !e.target.classList.contains("physical-button") && ["enter", " "].includes(key)) return;
      // Only a focused native reading region opts out of Down/Space shortcuts.
      // Held keys and Shift+Space keep their browser scroll behavior; letters
      // and shortcuts on physical buttons still perform the original controls.
      if (e.target instanceof HTMLElement && e.target.matches(".return-panel,.care-reading-region") &&
        (e.key === "ArrowDown" || e.key === " ")) return;
      // Enter on these reading stops is not a confirmation or page turn.
      // Native activation on physical buttons and explicit A/B/C stay intact.
      if (e.target instanceof HTMLElement && e.target.matches(".care-menu-reading,.care-outcome-reading,.game-outcome-reading,.memory-reading-region,.quiet-moment-reading,.sleep-home-guidance,.walk-discoveries,.fishing-catches") && e.key === "Enter") return;
      // Enter/Space activate the focused physical key, just like clicking it.
      // In particular the import preview deliberately focuses safe C: never
      // turn that native activation into the global B/confirm shortcut.
      const button = e.target instanceof HTMLButtonElement &&
        e.target.classList.contains("physical-button") ? e.target : null;
      const focusedKey = button && (key === "enter" || key === " ")
        ? ["A", "B", "C"].find(control => button.classList.contains(`button-${control.toLowerCase()}`))
        : undefined;
      const mapped = focusedKey ?? (["a", "arrowright", "arrowdown"].includes(key)
        ? "A"
        : ["b", "enter", " "].includes(key)
          ? "B"
          : ["c", "escape"].includes(key)
            ? "C"
            : null);
      if (mapped) {
        e.preventDefault();
        // Suppress native Enter/Space repeats on a focused physical button too.
        if (!e.repeat) controls.current(mapped);
      }
    };
    const up = (e: KeyboardEvent) => {
      // Chrome can still emit a native button click on Space release after
      // repeated keydowns. The mapped action already ran on the first down.
      if (e.key === " " && !e.isComposing && e.keyCode !== 229 &&
        !e.metaKey && !e.ctrlKey && !e.altKey &&
        e.target instanceof HTMLButtonElement && e.target.classList.contains("physical-button"))
        e.preventDefault();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  function cancelImport() {
    discardImport();
    const previous = importReturn.current;
    setPage(previous.page === "game" && previous.gameId !== sessionKey ? (pet?.hatchedAt ? "home" : "choose") : previous.page);
    setMessage("已取消导入，没有替换当前存档。");
  }
  async function importFile(file?: File) {
    // Clearing the input immediately also permits selecting the same file again.
    if (fileRef.current) fileRef.current.value = "";
    if (!file || backupExport.pending || busyRef.current || uncertainRef.current || unavailableRef.current || (!pet && !corruptRef.current)) return;
    if (page !== "import-preview") importReturn.current = { page, gameId: sessionKey };
    const sequence = ++importSequence.current;
    const pending: PendingImport = { fileName: file.name };
    pendingImportRef.current = pending;
    setPendingImport(pending);
    setTools(false);
    stopActivity();
    setError("");
    setPage("import-preview");
    document.querySelector<HTMLButtonElement>(".physical-button.button-c")?.focus();
    try {
      if (file.size > backupSizeLimit) throw new Error("备份文件过大，请选择 PixelPet 导出的 JSON 文件（不超过 64 KiB）。");
      const backup = previewBackup(await file.text());
      if (sequence !== importSequence.current) return;
      const ready = { fileName: file.name, backup };
      pendingImportRef.current = ready;
      setPendingImport(ready);
    } catch (error) {
      if (sequence !== importSequence.current) return;
      const rejected = { fileName: file.name, error: error instanceof Error ? error.message : "无法读取这份备份文件，请重新选择。" };
      pendingImportRef.current = rejected;
      setPendingImport(rejected);
    }
  }
  async function confirmImport() {
    const pending = pendingImportRef.current;
    if (!pending?.backup || backupExport.pending || busyRef.current || uncertainRef.current || unavailableRef.current) return;
    syncEpoch.current++;
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await request("import", pending.backup.data, acceptedGeneration.current);
      initialized.current = true;
      setArcadeSelection(null);
      setAlbumReturnSession(null);
      discardImport();
      latestRevision.current = -1;
      knownStage.current = null;
      setEvolution(null);
      setCareFeedback(null);
      setCareOutcome(null);
      setGameOutcome(null);
      setReturnRecap(null);
      setReturnPending(false);
      returnAttempt.current = "";
      finishClip();
      apply(r);
      setPage(r.state.hatchedAt ? "home" : "choose");
      setChosen(r.state.species);
    } catch (e) {
      if (isClockAhead(e)) markClockAhead();
      else if (isSaveChanged(e)) markChangeRejected("save");
      else if (needsReconciliation(e)) markUncertain();
      else setError(e instanceof Error ? e.message : "导入被拒绝，现有存档未替换。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function restart() {
    if (!resetConfirmed || backupExport.pending || busyRef.current || uncertainRef.current || unavailableRef.current) return;
    syncEpoch.current++;
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await request("reset", { confirm: true }, acceptedGeneration.current);
      initialized.current = true;
      setArcadeSelection(null);
      setAlbumReturnSession(null);
      discardImport();
      latestRevision.current = -1;
      knownStage.current = null;
      setEvolution(null);
      setCareFeedback(null);
      setCareOutcome(null);
      setGameOutcome(null);
      setReturnRecap(null);
      setReturnPending(false);
      returnAttempt.current = "";
      finishClip();
      apply(r);
      setChosen(0);
      setPage("choose");
      setReset(false);
    } catch (e) {
      if (isClockAhead(e)) markClockAhead();
      else if (isSaveChanged(e)) markChangeRejected("save");
      else if (needsReconciliation(e)) { setReset(false); markUncertain(); }
      else setError(e instanceof Error ? e.message : "重新开始失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const index = pet?.hatchedAt ? pet.species : chosen;
  const age = pet?.hatchedAt ? Math.max(0, now - pet.hatchedAt) : 0;
  const growth = petGrowth(pet, now);
  const stage = stageNames[growth.stage];
  const form = tendency(growth);
  const resetSummary = pet && !corrupt ? {
    days: pet.hatchedAt > 0 ? Math.floor(Math.max(0, now - pet.hatchedAt) / 86400000) + 1 : 0,
    logs: (pet.logs ?? []).length,
    memories: pet.album?.entries.length ?? 0,
    fishFound: new Set((pet.pond?.fish ?? []).map(fish => fish.id)).size,
    fishTotal: fishCatalogFor(pet).length,
    parkFound: new Set((pet.park?.finds ?? []).map(find => find.id)).size,
    parkTotal: parkCatalog.length,
  } : null;
  const need = petNeed(pet);
  const mood = pet?.sleeping
    ? "正在做一个甜甜的梦"
    : need?.text || "今天也是好心情";
  const target = pet?.game
    ? Math.floor(Math.max(0, now - pet.game.startedAt) / 900) % 3
    : 0;
  const echo = homeEcho && page === "home" && !clip && !evolution && !tools && !help && !reset && !document.hidden && performance.now() < homeEcho.monotonicUntil && !pet?.sleeping && !["hungry", "tired", "dirty"].includes(need?.kind ?? "") ? homeEcho.kind : undefined;
  const motion = sceneMotion(pet?.sleeping ?? false, clip);
  const blocks = pet?.game?.tetris;
  const tetrisHint = blocks?.end ? gameFinishInstruction(games[3]) : blocks?.paused || tetrisSession !== pet?.game?.id ? "A 选择  B 确认  C 继续" : "A 左移  B 右移  C 操作 / 暂停";
  const snake = pet?.game?.snake;
  const snakeHint = snake?.end
    ? gameFinishInstruction(games[2])
    : snake?.paused || snakeSession !== pet?.game?.id
      ? "A / C 继续  B 放弃确认"
      : "A 左转  B 右转  C 暂停";
  const treasure = pet?.game?.treasure;
  const tileView = page === "game" && pet?.game?.kind === "tiles" && !!pet.game.tiles && !abandoning
    && !uncertain && !unavailable && !corrupt && !clockAhead && !tools && !help && !reset;
  useTileViewport(readingRoot, tileDestination, sessionKey, tileView && foreground && windowFocused);
  const treasureView = page === "game" && pet?.game?.kind === "treasure" && !!treasure && !abandoning
    && !uncertain && !unavailable && !corrupt && !clockAhead && !tools && !help && !reset;
  useTreasureViewport(readingRoot, treasureDestination, sessionKey, treasureView && foreground);
  const treasureHint = treasure && treasureDone(treasure) ? gameFinishInstruction(games[6]) : treasure?.paused || treasureSession !== pet?.game?.id ? "A 选择  B 确认  C 继续" : "A 选格  B 探索  C 暂停";
  const walking=pet?.game?.walking;
  const walkHint=walking?.beat===72?gameFinishInstruction(games[5]):walking?.paused || walkSession!==pet?.game?.id?"A 选择  B 确认  C 继续":"A 跳跃  B 蹲下  C 暂停";
  const fishing = pet?.game?.fishing;
  const fishingHint = fishing?.phase === "done" ? gameFinishInstruction(games[4]) : fishing?.paused || (["wait", "bite"].includes(fishing?.phase ?? "") && fishingSession !== pet?.game?.id) ? "A 选择  B 确认  C 继续" : "A 换钓点  B 抛 / 提竿  C 暂停";
  // Keep reward context out of live boards. A refreshed session is locally
  // paused even when the last server snapshot still says it was running.
  const gameRewardReading = gameAwaitingFinish(pet?.game)
    || (snake && (snake.paused || snakeSession !== pet?.game?.id))
    || (blocks && (blocks.paused || tetrisSession !== pet?.game?.id))
    || (treasure && (treasure.paused || treasureSession !== pet?.game?.id))
    || (walking && (walking.paused || walkSession !== pet?.game?.id))
    || (fishing && (fishing.paused || (["wait", "bite"].includes(fishing.phase) && fishingSession !== pet?.game?.id)));
  const gameNavHint = page === "pause-guide" ? "A / B 翻页  C 返回暂停" : page === "arcade"
    ? pet?.sleeping ? "A 换游戏  B 暂不可开始  C 返回" : "A 换游戏  B 进入  C 返回"
    : page === "game-guide"
      ? pet?.sleeping ? "A 翻页  B 暂不可开始  C 返回选择" : `A 翻页  ${gameStartInstruction(games[arcadeChoice], guideSeen(games[arcadeChoice].id) && !guideReview)}  C 返回选择`
      : abandoning ? "A / C 留在本局  B 确认放弃" : (page === "fish-album" || page === "park-album") ? "A 上一页  B 下一页  C 返回" : "";
  const quietMemoryCount = page === "moment" && pet ? quietMemories(pet).length : 0;
  const quietMomentHint = pet?.sleeping
    ? "A 换陪伴　 B 安静陪着　 C 返回"
    : quietMomentChoice === 2 && quietMemoryCount
    ? `A 换回应　 B ${quietMemoryKey ? quietMemoryCount > 1 ? "再聊一段" : "再聊一次" : "聊聊回忆"}　 C 返回`
    : "A 换回应　 B 陪一会儿　 C 返回";
  const lcdHint = clockAhead ? "B 重新检查 · 不重置存档"
      : uncertain || unavailable ? checking ? "正在读取 · 不重做操作" : "B 读取存档 · 不重做操作"
      : page === "import-preview"
      ? busy ? "正在导入…" : pendingImport?.backup ? "A / C 取消  B 确认替换" : "A / C 取消"
      : corrupt ? "B 重新检查 · 存档盒可修复"
      : !pet ? "B 重新连接"
      : gameNavHint
      ? gameNavHint
      : page === "choose"
        ? "A 换一位　 B 就是它"
        : page === "hatch"
          ? "B 轻轻唤醒　 C 再选选"
          : page === "shop"
            ? purchaseReady
              ? "A / C 取消　 B 确认购买"
              : shopCategory ? "A 下一件　 B 购买 / 使用　 C 分类" : "A 换分类　 B 查看 / 领取　 C 返回"
            : page === "return"
              ? `A 换页　 B ${returnPage < returnPageCount - 1 ? "继续" : "回小窝"}　 C 返回`
              : page === "home"
                ? clip
                  ? `${clip.kind === "feed" ? "吃得香香" : clip.kind === "clean" ? "泡泡时间" : clip.kind === "wake" ? "伸个懒腰" : clip.kind === "evolve" ? "长大啦" : "好开心呀"} · C 跳过`
                  : gameOutcome || hasCareOutcome(careOutcome)
                    ? "A / B 菜单　 C 收起回执"
                    : careFeedback || message ? "A / B 菜单　 C 收起提示" : "A / B 打开菜单"
                : page === "menu"
                  ? "A 选择　 B 确认　 C 返回"
                  : page === "game"
                    ? pet.game?.kind === "treasure" ? treasureHint : pet.game?.kind === "walk" ? walkHint : pet.game?.kind === "fishing"
                      ? fishingHint
                      : pet.game?.kind === "tetris"
                      ? tetrisHint
                      : pet.game?.kind === "snake"
                        ? snakeHint
                        : pet.game?.kind === "tiles"
                          ? "A 移动  B 选牌  C 撤选 / 放弃"
                          : "A 移动　 B 接住　 C 放弃确认"
                    : page === "status"
                      ? "A 换页　 B / C 回小窝"
                      : page === "album"
                      ? albumCategory === null ? "A 换分类  B 进入  C 返回小窝" : returningToPause ? "A 上一页  B 下一页  C 返回暂停" : "A 上一页  B 下一页  C 返回分类"
                      : page === "growth"
                      ? "A 上一页  B 下一页  C 返回"
                      : page === "journal"
                        ? "A 较早　 B 较新　 C 返回"
                        : page === "moment"
                          ? quietMomentHint
                          : "C 返回小窝";

  // Use the same reading decision for geometry and successful notices.
  const readingMode = page !== "game" || abandoning || uncertain || unavailable || corrupt
    || treasure || pet?.game?.kind === "tiles" || (pet?.game && !pet.game.kind)
    || (snake && (snake.paused || snake.end || snakeSession !== pet?.game?.id))
    || (blocks && (blocks.paused || blocks.end || tetrisSession !== pet?.game?.id))
    || (walking && (walking.paused || walking.beat === 72 || walkSession !== pet?.game?.id))
    || (fishing && (fishing.paused || fishing.phase === "done" || (["wait", "bite"].includes(fishing.phase) && fishingSession !== pet?.game?.id)));
  // Persistent recovery errors stay above the device. Successful reading
  // feedback belongs below it, so expiry cannot shift the device or cover keys.
  const recoveryVisible = uncertain || unavailable || (corrupt && !(page === "import-preview" && pendingImport));
  const readingNotice = !recoveryVisible && readingMode && !error;
  const notice = (message || error) && (
    <div
      className={`toast ${error ? "error" : ""} ${recoveryVisible ? "recovery-notice" : readingNotice ? "reading-notice" : ""}`}
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
  );

  return (
    <div className={`app ${treasureView ? "treasure-view" : ""}`}>
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
            title={sound ? "关闭按键与咬钩提示音" : "打开按键与咬钩提示音（非必需）"}
            aria-describedby="sound-description"
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
          <span className="sr-only" id="sound-description">开启后提供按键与咬钩短提示音；静音不影响文字提示和三键游玩。</span>
          <button
            className="icon-button"
            aria-label="玩法说明"
            onClick={(event) => { modalReturnFocus.current = event.currentTarget; setHelp(true); }}
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
                {clockAhead ? <p>先校准运行 Go 服务的电脑时间，再按 B 检查；暂不导出或替换存档。</p> : corrupt ? <p>当前存档无法正常导出；修复前会保留原始内容快照。</p> : <button disabled={backupExport.pending || busy || uncertain || unavailable || !pet} onClick={() => void backupExport.download()} aria-busy={backupExport.pending}>
                  <ArrowDownToLine size={16} />
                  导出存档
                </button>}
                {backupExport.feedback && <p className="export-feedback" role={backupExport.feedback.error ? "alert" : "status"}>{backupExport.feedback.text}</p>}
                {backupExport.pending && <p role="status">正在读取备份，请稍候…</p>}
                <button
                  disabled={backupExport.pending || busy || uncertain || unavailable || (!pet && !corrupt)}
                  onClick={() => fileRef.current?.click()}
                >
                  <ArrowUpFromLine size={16} />
                  导入备份
                </button>
                <button
                  disabled={backupExport.pending || busy || uncertain || unavailable || (!pet && !corrupt)}
                  className="reset-link"
                  onClick={(event) => {
                    modalReturnFocus.current = event.currentTarget.closest(".tools-wrap")?.querySelector<HTMLButtonElement>(".backup-button") || null;
                    setTools(false);
                    setResetConfirmation("");
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
        disabled={!tools}
        tabIndex={tools ? 0 : -1}
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      <main>
        <p className="sr-only" id={needMeterDescriptionId}>最近读取的需求，范围 0–100，越高越舒适；显示的整数可能经过四舍五入，不是随本地时钟变化的预测。</p>
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
        {recoveryVisible && notice}
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
              {clockAhead ? "服务时间待校准" : uncertain
                ? checking ? "正在核对存档…" : "保存结果待核对"
                : corrupt ? "存档需要修复"
                : unavailable ? "小窝暂未连接"
                : !pet
                ? "小窝连接中"
                : busy
                  ? "正在保存…"
                  : error
                    ? "有一条小提醒"
                    : "成长已好好保存"}
              <small>
                {savedAt ? `${timeLabel(savedAt)} · ${uncertain || unavailable || corrupt ? "上次读取" : "本机存档"}` : "GO + SQLITE"}
              </small>
            </div>
          </div>
          <div className={`device-stage ${readingMode ? "reading-mode" : ""} ${page === "return" && returnRecap && pet && !uncertain && !unavailable && !corrupt && !clockAhead ? "return-mode" : ""} ${treasureView ? "treasure-mode" : ""} ${tileView ? "tiles-mode" : ""}`}>
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
                      {clockAhead ? "CLOCK CHECK" : page === "import-preview" ? "BACKUP PREVIEW" : corrupt ? "SAVE RECOVERY" : page === "choose"
                        ? "HELLO, FRIEND"
                        : (page === "arcade" || page === "game-guide" || page === "pause-guide")
                          ? "PLAY TOGETHER"
                          : page === "menu"
                            ? "CARE MENU"
                            : page === "shop"
                              ? "LITTLE SHOP"
                              : page === "album"
                                ? "OUR MEMORIES"
                                : page === "return"
                                  ? "WELCOME BACK"
                                  : page === "status"
                                    ? "MY STATUS"
                                    : page === "growth"
                                      ? "GROWTH BOOK"
                                      : page === "journal"
                                        ? "LITTLE DIARY"
                                        : page === "game"
                                          ? pet?.game?.kind === "treasure" ? "FOREST TOGETHER" : pet?.game?.kind === "walk" ? "PARK TOGETHER" : pet?.game?.kind === "fishing"
                                            ? "POND TOGETHER"
                                            : pet?.game?.kind === "tetris"
                                            ? "BLOCK GARDEN"
                                            : pet?.game?.kind === "snake"
                                              ? "ORCHARD SNAKE"
                                              : pet?.game?.kind === "tiles"
                                                ? "LINK & COLLECT"
                                                : "CATCH A STAR"
                                          : "PIXELPET / 01"}
                    </span>
                    <span className="lcd-battery">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                  <div ref={readingRoot} className={`lcd-content content-${page}`}>
                    {uncertain || unavailable ? (
                      <div className={`save-recovery ${clockAhead ? "clock-recovery" : ""}`} role="status" aria-live="polite">
                        <Cloud size={28} />
                        <h2>{checking ? "正在核对存档" : clockAhead ? "服务时间待校准" : uncertain ? "先核对，再继续" : "小窝暂时未连接"}</h2>
                        <p>{clockAhead ? "服务时间早于存档时间，先暂停操作；这不表示存档损坏。" : refusedChange === "sleep" ? "睡眠状态已在其他页面变化，本次入睡或起床未执行。" : refusedChange === "game" ? "本局已在其他页面结束，本次放弃未执行。" : refusedChange === "save" ? "存档已在其他页面替换，本次操作未执行。" : uncertain ? "上次操作可能已经保存，暂不重复提交。" : pet ? "暂时无法读取最新状态，先暂停操作。" : "还没有读到存档，请确认本机服务已启动。"}</p>
                        <p>{checking ? "只读取当前存档，不重做操作。" : clockAhead ? "请校准运行 Go 服务的电脑时间，再按 B 检查。不要重置存档。" : "按 B 重连并查看当前存档。"}</p>
                        <small>{clockAhead && uncertain ? "上次操作结果仍待核对 · 不自动重试" : "游戏不会自动继续 · 不重播成功动作"}</small>
                      </div>
                    ) : page === "import-preview" && pendingImport ? (
                      <ImportPreview pending={pendingImport} pet={corrupt ? null : pet} busy={busy} />
                    ) : corrupt ? (
                      <div className="save-recovery corrupt-recovery" role="status" aria-live="polite">
                        <Cloud size={28} />
                        <h2>{checking ? "正在重新检查" : "存档需要修复"}</h2>
                        <p>服务已连接，但当前存档未通过校验；没有自动替换。</p>
                        <p>从机身外的存档盒选择已有备份，预览后按 B 确认；A / C 可取消。</p>
                        <small>没有备份也可在存档盒明确确认重新开始。B 只重新检查，不会自动导入或重置。</small>
                      </div>
                    ) : !pet ? (
                      <div className="screen-wait">
                        <PixelEgg />
                        <p>
                          {error ? "小窝暂时没有连接" : "正在寻找你的小伙伴…"}
                        </p>
                        <small>{error ? "按 B 重试" : "请稍等一下"}</small>
                      </div>
                    ) : (
                      <>
                        {page === "arcade" && (
                          <ArcadePanel
                            choice={arcadeChoice}
                            economy={pet.economy}
                            companion={pet.companion}
                            shop={shop}
                            now={now}
                            sleeping={pet.sleeping}
                          />
                        )}
                        {page === "pause-guide" && pauseGuide && <GameGuide game={pauseGuide} page={guidePage} paused economy={pet.economy} growth={growth} shop={shop} now={now} />}
                        {page === "game-guide" && <GameGuide game={games[arcadeChoice]} page={guidePage} review={guideReview} sleeping={pet.sleeping} economy={pet.economy} growth={growth} shop={shop} now={now} />}
                        {abandoning && <AbandonGame game={pet.game} />}
                        {page === "shop" && (
                          <ShopPanel
                            pet={pet}
                            shop={shop}
                            category={shopCategory}
                            page={shopCategory ? shopItemIndex : shopPage}
                            confirm={purchaseReady}
                            notice={shopNotice}
                            now={now}
                          />
                        )}
                        {page === "park-album" && <CareReadingRegion className="memory-reading-region" label="公园沿途发现阅读区">
                          <ParkAlbum pet={pet} page={parkPage} />
                        </CareReadingRegion>}
                        {page === "fish-album" && <CareReadingRegion className="memory-reading-region" label="池塘鱼图鉴阅读区">
                          <FishAlbum pet={pet} page={fishPage} />
                        </CareReadingRegion>}
                        {page === "album" && <CareReadingRegion className="memory-reading-region" label="永久纪念册阅读区">
                          {albumCategory === null ? <AlbumDirectory pet={pet} choice={albumChoice} /> : <AlbumPanel pet={pet} shop={shop} now={now} page={albumReading?.page ?? 0} missing={albumReading?.cursor.missing} category={albumCategory} />}
                        </CareReadingRegion>}
                        {page === "return" && returnRecap && (
                          <ReturnPanel pet={pet} recap={returnRecap} page={returnPage} updated={returnUpdated} />
                        )}
                        {page === "choose" && (
                          <>
                            <div className="screen-caption">
                              遇见你的第一位小伙伴
                            </div>
                            <div className="choose-sprite">
                              <span className="pixel-spark spark-left">✦</span>
                              <PetArt
                                index={chosen}
                                stage="baby"
                                className={chosen === 2 ? "" : "idle"}
                                expression="awake"
                              />
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
                            <PetScene
                              index={index}
                              motion={motion}
                              echo={echo}
                              need={need?.kind}
                              clipId={clip?.id ?? 0}
                              duration={clip ? clipDurations[clip.kind] : 0}
                              stage={growth.stage}
                              form={growth.form}
                              equipped={pet.economy?.equipped}
                              dirty={pet.needs.clean < 35}
                            />
                            <CareFeedback
                              rules={careRules}
                              growthRecorded={!!pet.growth}
                              feedback={careFeedback}
                              growth={growth}
                              mood={echo ? experienceWords[echo] : message || mood}
                            />
                            {!clip && !evolution && need && (need.kind === "hungry" || need.kind === "dirty" || need.kind === "tired") && (
                              <section className="home-care-guidance" aria-label="小窝中的照顾建议">
                                <strong>现在怎么照顾 · 最近读取</strong>
                                <CareAdvice pet={pet} />
                              </section>
                            )}
                            {pet.sleeping && <CareReadingRegion className="sleep-home-guidance" label="休息中的照顾提示"
                              hint="Tab 聚焦：↑/↓ 或空格滚动；Enter 不操作，A/B/C 不变。">
                              <strong>最近读取 · 正在休息</strong>
                              <CareAdvice pet={pet} />
                            </CareReadingRegion>}
                            {gameOutcome ? (
                              <GameOutcome outcome={gameOutcome} careFeedback={careOutcome} readable />
                            ) : (
                              <CareOutcome feedback={careOutcome} readable />
                            )}
                          </>
                        )}
                        {page === "menu" && (
                          <CareReadingRegion className="care-menu-reading" label="照顾菜单阅读区"
                            hint="Tab 聚焦：↑/↓ 或空格滚动；Enter 不操作，A/B/C 不变。">
                            <div className="care-menu-pagination" aria-live="polite" aria-atomic="true" aria-label="菜单浏览进度">
                              {(() => {
                                const start = Math.max(0, selected - 5);
                                const end = Math.min(items.length, start + 6);
                                const remaining = items.length - end;
                                return remaining > 0
                                  ? <>第 {start + 1}–{end} / {items.length} 项 · A 继续浏览（还有 {remaining} 项）</>
                                  : selected === items.length - 1
                                    ? <>第 {start + 1}–{end} / {items.length} 项 · 已到最后一项，A 将回到第 1 项</>
                                    : <>第 {start + 1}–{end} / {items.length} 项 · A 继续浏览</>;
                              })()}
                            </div>
                            <div className="care-menu">
                              {items
                                .slice(
                                  Math.max(0, selected - 5),
                                  Math.max(0, selected - 5) + 6,
                                )
                                .map((item, offset) => {
                                  const i = Math.max(0, selected - 5) + offset;
                                  const Icon = item.icon;
                                  return (
                                    <div
                                      key={item.kind}
                                      className={`care-item ${i === selected ? "selected" : ""}`}
                                      aria-current={i === selected ? "true" : undefined}
                                    >
                                      <span className="menu-arrow">
                                        {i === selected ? "▸" : ""}
                                      </span>
                                      <Icon size={15} />
                                      <span>
                                        {item.kind === "sleep" && pet.sleeping
                                          ? careMenuLabel("sleep", true)
                                          : item.label}
                                      </span>
                                      <span className="menu-number">
                                        {String(i + 1).padStart(2, "0")}
                                      </span>
                                    </div>
                                  );
                                })}
                            </div>
                            <section className="care-menu-advice" aria-label="菜单中的照顾建议">
                              <strong>现在怎么照顾 · 最近读取</strong>
                              <CareAdvice pet={pet} />
                            </section>
                            <CarePreview pet={pet} kind={items[selected].kind} hint={items[selected].hint} rules={careRules} />
                          </CareReadingRegion>
                        )}
                        {page === "moment" && <QuietMoment pet={pet} choice={quietMomentChoice} replied={quietMomentReplied} memoryKey={quietMemoryKey} />}
                        {page === "growth" && (
                          <GrowthPanel
                            pet={pet}
                            growth={growth}
                            rules={careRules}
                            companion={pet.companion}
                            index={index}
                            page={growthPage}
                          />
                        )}
                        {page === "status" && (
                          <CareReadingRegion className="screen-status" data-status-page={statusPage} label="状态说明阅读区">
                            {statusPage === 0 ? <>
                            <div className="status-name">
                              <PetArt
                                index={index}
                                stage={growth.stage}
                                accessory={pet.economy?.equipped.accessory}
                              />
                              <div>
                                <strong>{pet.name}</strong>
                                <small>
                                  {stage} · 相识第 {Math.floor(age / 86400000) + 1}{" "}
                                  天
                                </small>
                              </div>
                            </div>
                            {needs.map((n) => (
                              <div className="lcd-meter" key={n.key} {...needMeterAttributes(n.label, pet.needs[n.key])}>
                                <span>{n.label}</span>
                                <div>
                                  <i
                                    style={{ width: `${pet.needs[n.key]}%` }}
                                  />
                                </div>
                                <b>{Math.round(pet.needs[n.key])}</b>
                              </div>
                            ))}
                            <StatusReading at={pet.lastTick} />
                            <CareAdvice pet={pet} />
                            {gameOutcome ? (
                              <GameOutcome outcome={gameOutcome} careFeedback={careOutcome} />
                            ) : (
                              <CareOutcome feedback={careOutcome} />
                            )}
                            <div className="care-total">
                              收到过 {pet.careCount} 次温柔照顾 ♡
                            </div>
                            </> : <StatusGuide pet={pet} rules={careRules} now={now} />}
                            <small className="status-page-number">{statusPage + 1} / {statusPageCount}</small>
                          </CareReadingRegion>
                        )}
                        {page === "journal" && <CareReadingRegion className="memory-reading-region" label="成长日记阅读区">
                          <JournalPanel logs={pet.logs} cursor={journalCursor} />
                        </CareReadingRegion>}
                        {page === "game" && !abandoning && pet.game?.kind === "treasure" && <TreasureGame pet={pet} active={treasureSession === pet.game.id && !tools && !help && !reset} cursor={treasureCursor} choice={treasureChoice} reaction={treasureReaction}/>}
                        {page === "game" && !abandoning && pet.game?.kind === "walk" && <WalkingGame pet={pet} active={walkSession===pet.game.id && !tools && !help && !reset} choice={walkChoice}/>}
                        {page === "game" && !abandoning && pet.game?.kind === "fishing" && <FishingGame pet={pet} active={fishingSession === pet.game.id && !tools && !help && !reset} choice={fishingChoice} />}
                        {page === "game" && !abandoning && pet.game?.kind === "tetris" && (
                          <TetrisGame key={pet.game.id} pet={pet} now={now} active={tetrisSession === pet.game.id && !tools && !help && !reset} choice={tetrisChoice} />
                        )}
                        {page === "game" && !abandoning && pet.game?.kind === "snake" && (
                          <SnakeGame
                            key={pet.game.id}
                            pet={pet}
                            now={now}
                            active={snakeSession === pet.game.id && !tools && !help && !reset}
                            turn={queuedTurn}
                          />
                        )}
                        {page === "game" && !abandoning && pet.game?.kind === "tiles" && (
                          <TileGame
                            pet={pet}
                            cursor={tileCursor}
                            link={tileLink}
                            hint={tileHint}
                            message={message}
                            now={now}
                          />
                        )}
                        {page === "game" && !abandoning && pet.game && !pet.game.kind && (
                          <StarsGame pet={pet} now={now} lane={lane} target={target} message={message}
                            reaction={!tools && !help && !reset && foreground ? starsReaction : null} />
                        )}
                        {page === "game" && !abandoning && gameRewardReading && <section className="session-allowance" aria-label="本局奖励提示">
                          <strong>本局奖励提示</strong>
                          <GameAllowance economy={pet.economy} shop={shop} now={now} />
                          <small>基础规则不代表本局一定得币；是否满足条件、实际所得以结算时为准。</small>
                        </section>}
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
                      disabled={(busy && !(key === "C" && (canPauseFishingPulse(busyAction) || canPauseWalkingStep(busyAction) || canPauseBoardStep(busyAction)))) || checking || ((uncertain || unavailable) && key !== "B") || (clip !== null && key !== "C")}
                      className={`physical-button button-${key.toLowerCase()} ${pressed === key ? "is-pressed" : ""}`}
                      aria-label={`${key} ${["选择", "确认", "返回"][i]}`}
                      onPointerDown={(event) => {
                        // Blurring a reading stop collapses its hint and moves the
                        // keys. Keep the tap target still until click activation.
                        if (event.button === 0 && document.activeElement?.matches(".care-reading-region")) event.preventDefault();
                      }}
                      onClick={(event) => {
                        event.currentTarget.focus({ preventScroll: true });
                        controls.current(key);
                      }}
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
            {clockAhead ? <>
              <div className="companion-title"><h2>先校时，再继续</h2><span>存档未替换</span></div>
              <p className="personality">暂不展示可能过时的伙伴状态。校准服务电脑时间后按 B 检查，不要重置或重复提交。</p>
            </> : corrupt ? <>
              <div className="companion-title"><h2>先保留，再修复</h2><span>存档待修复</span></div>
              <p className="personality">当前内容未通过校验，暂不展示伙伴状态。</p>
              <div className="note-rule" />
              <p>从存档盒选择备份后，在屏幕预览并用三键确认。B 重新检查不会替换存档。</p>
            </> : <>
            <div className="companion-title">
              <h2>{pet?.hatchedAt ? pet.name : species[chosen]}</h2>
              <span>{pet?.hatchedAt ? stage : "等待相遇"}</span>
            </div>
            <p className="personality">{personalities[index]}</p>
            {pet?.hatchedAt ? (
              <div className="companion-growth">
                <div>
                  <span>
                    {growth.stage === "adult"
                      ? `成年 · ${formNames[growth.form || "balanced"]}`
                      : "本阶段成长进度"}
                  </span>
                  <span>{growthPercentReading(growth)}</span>
                </div>
                <GrowthTrack growth={growth} estimated={!pet?.growth} />
                <small>
                  {growth.stage === "adult"
                    ? "形态已确定，继续好好陪伴。"
                    : `本阶段 ${stagePointsReading(growth)} / ${stagePoints(growth).target} · ${formNames[form]}倾向`}
                </small>
              </div>
            ) : null}
            <div className="note-rule" />
            {pet?.hatchedAt ? (
              <div className="outside-needs">
                {needs.map((n) => {
                  const Icon = n.icon;
                  return (
                    <div className={`outside-meter ${n.color}`} key={n.key} {...needMeterAttributes(n.label, pet.needs[n.key])}>
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
            </>}
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
        {readingNotice && notice}
        <section
          className="collection"
          aria-label={corrupt || clockAhead ? "十位原创小伙伴展示" : "十位原创小伙伴，使用 A 键选择"}
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
                className={`collection-pet ${!corrupt && !clockAhead && index === i ? "is-chosen" : ""}`}
                key={name}
              >
                <div>
                  <PetArt
                    index={i}
                    stage={!corrupt && !clockAhead && i === index ? growth.stage : "baby"}
                  />
                </div>
                <span>{name}</span>
                {!corrupt && !clockAhead && index === i && <i />}
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
      {!recoveryVisible && !readingNotice && notice}
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
                  {corrupt ? "重新开始会用一颗新蛋替换无法读取的存档。也可以取消并导入已有备份；原始内容会保留为恢复快照。" : "重新开始会替换当前宠物。建议先导出备份，留住这段小小的陪伴。"}
                </p>
                {resetSummary && <section className="reset-summary" aria-label="重新开始会清除的共同经历">
                  <strong>这会清除当前共同经历</strong>
                  <dl>
                    <div><dt>相识日子</dt><dd>{resetSummary.days ? `${resetSummary.days} 天` : "尚未孵化"}</dd></div>
                    <div><dt>成长日记</dt><dd>{resetSummary.logs} 条</dd></div>
                    <div><dt>永久纪念册</dt><dd>{resetSummary.memories} 条</dd></div>
                    <div><dt>鱼图鉴</dt><dd>{resetSummary.fishFound} / {resetSummary.fishTotal}</dd></div>
                    <div><dt>沿途发现</dt><dd>{resetSummary.parkFound} / {resetSummary.parkTotal}</dd></div>
                  </dl>
                  <small>导出备份会把这些记录一起保存；取消不会改变当前小窝。</small>
                </section>}
                {!corrupt && !clockAhead && <>
                  <button className="modal-export" disabled={backupExport.pending || busy || uncertain || unavailable || !pet} onClick={() => void backupExport.download()} aria-busy={backupExport.pending}>
                    <ArrowDownToLine size={16} />
                    先导出当前存档
                  </button>
                  {backupExport.pending && <p role="status">正在读取备份，请稍候…</p>}
                  {backupExport.feedback && <p className="export-feedback" role={backupExport.feedback.error ? "alert" : "status"}>{backupExport.feedback.text}</p>}
                </>}
                <label className="reset-confirmation" htmlFor="reset-confirmation">
                  <strong>请输入「{resetWords}」再确认</strong>
                  <input id="reset-confirmation" aria-label="重新开始确认文字"
                    aria-describedby="reset-confirmation-hint" type="text" autoComplete="off"
                    spellCheck={false} value={resetConfirmation} disabled={busy}
                    onChange={event => setResetConfirmation(event.target.value)} />
                  <small id="reset-confirmation-hint">{resetWords === "重新开始" ? "输入上方文字，确认替换当前存档。" : "输入当前宠物名，确认告别这段陪伴。"}输入时 A/B/C 是文字，Esc 可取消；Enter 不会提交。</small>
                </label>
                <button
                  disabled={!resetConfirmed || backupExport.pending || busy || uncertain || unavailable || (!pet && !corrupt)}
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
                    <span>切换角色、菜单或说明页；游戏操作以各自说明为准。</span>
                  </p>
                  <p>
                    <kbd>B</kbd>
                    <span>确认选择；小游戏说明中，A 翻页重看，B 按各游戏提示进入开始、准备或暂停。</span>
                  </p>
                  <p>
                    <kbd>C</kbd>
                    <span>返回；实时游戏里暂停，放弃本局还需 B 再次确认。</span>
                  </p>
                </div>
                <p>也可以用 Tab 聚焦机身按钮，再按 Enter 或空格操作该按钮。</p>
                <p>游戏选择页显示每款的操作、预计时长与领奖条件；每次都能重看说明。所有游戏共用当日金币额度，按 UTC 日更新，额度用完仍可玩。</p>
                <PetCareGuide rules={careRules} />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
