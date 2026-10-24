package game

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"
)

const Schema = 20

var Species = []string{"星星狸", "云朵雀", "草莓兔", "海豚宝", "蘑菇菇", "蜜桃熊", "柠檬蛙", "樱花喵", "银河龙", "焦糖犬"}

type Needs struct {
	Hunger float64 `json:"hunger"`
	Mood   float64 `json:"mood"`
	Clean  float64 `json:"clean"`
	Energy float64 `json:"energy"`
}
type Log struct {
	At   int64  `json:"at"`
	Text string `json:"text"`
}

func newGameID() string {
	var id [16]byte
	rand.Read(id[:])
	return hex.EncodeToString(id[:])
}
func validGameID(id string) bool {
	if len(id) != 32 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}

type MiniGame struct {
	Treasure  *TreasureHunt `json:"treasure,omitempty"`
	Walking   *Walking      `json:"walking,omitempty"`
	Fishing   *Fishing      `json:"fishing,omitempty"`
	Tetris    *Tetris       `json:"tetris,omitempty"`
	Snake     *Snake        `json:"snake,omitempty"`
	Kind      string        `json:"kind,omitempty"`
	Tiles     *TileMatch    `json:"tiles,omitempty"`
	ID        string        `json:"id,omitempty"`
	StartedAt int64         `json:"startedAt"`
	Round     int           `json:"round"`
	Score     int           `json:"score"`
	LastBeat  int64         `json:"lastBeat"`
}
type State struct {
	Park      *Park      `json:"park,omitempty"`
	Companion *Companion `json:"companion,omitempty"`
	Pond      *Pond      `json:"pond,omitempty"`
	Schema    int        `json:"schema"`
	Revision  int64      `json:"revision"`
	Species   int        `json:"species"`
	Name      string     `json:"name"`
	CreatedAt int64      `json:"createdAt"`
	HatchedAt int64      `json:"hatchedAt"`
	LastTick  int64      `json:"lastTick"`
	Sleeping  bool       `json:"sleeping"`
	Needs     Needs      `json:"needs"`
	CareCount int        `json:"careCount"`
	Logs      []Log      `json:"logs"`
	Game      *MiniGame  `json:"game,omitempty"`
	Growth    *Growth    `json:"growth,omitempty"`
	Album     *Album     `json:"album,omitempty"`
	Economy   *Economy   `json:"economy,omitempty"`

	SleepSession *SleepSession `json:"sleepSession,omitempty"`
}

// ErrGameFinished is a known refusal: an old unfinished-game discard intent
// must not remove a terminal result produced by another page.
var ErrGameFinished = errors.New("本局已经结束，放弃未执行。请先读取本局结果")

// ErrSleepChanged refuses a stale bedtime/wake intent instead of reversing it.
var ErrSleepChanged = errors.New("睡眠状态已变化，本次入睡或起床未执行。请先读取当前状态")

// AwaitingFinish excludes stars/tiles, which settle and remove their session in
// the last action. The other five games keep a result for explicit collection.
func (g *MiniGame) AwaitingFinish() bool {
	if g == nil {
		return false
	}
	switch g.Kind {
	case "snake":
		return g.Snake != nil && g.Snake.End != ""
	case "tetris":
		return g.Tetris != nil && g.Tetris.End != ""
	case "fishing":
		return g.Fishing != nil && g.Fishing.Phase == "done"
	case "treasure":
		return g.Treasure != nil && g.Treasure.done()
	case "walk":
		return g.Walking != nil && g.Walking.Beat == WalkLength
	default:
		return false
	}
}

type Action struct {
	Step      int    `json:"step,omitempty"`
	Turn      int    `json:"turn,omitempty"`
	Kind      string `json:"kind"`
	Species   int    `json:"species"`
	Lane      int    `json:"lane"`
	Name      string `json:"name"`
	RequestID string `json:"requestId"`
	Item      string `json:"item,omitempty"`
	Tile      int    `json:"tile,omitempty"`
	GameID    string `json:"gameId,omitempty"`

	// Transport-only preconditions; not part of portable commands or saves.
	RequireUnfinished bool  `json:"-"`
	ExpectedSleeping  *bool `json:"-"`
}

func New(now time.Time) State {
	ms := now.UnixMilli()
	return State{Park: newPark(now), Companion: newCompanion(now), Pond: newPond(now), Economy: newEconomy(), Schema: Schema, Species: 0, Name: Species[0], CreatedAt: ms, LastTick: ms, Needs: Needs{80, 80, 90, 85}, Growth: &Growth{Stage: "egg"}, Album: &Album{Since: ms, Entries: []Memory{}}, Logs: []Log{{ms, "一颗小小的蛋，正在等待与你相遇。"}}}
}
func clamp(n float64) float64 { return math.Max(0, math.Min(100, n)) }
func (s *State) Log(now time.Time, message string) {
	s.Logs = append([]Log{{now.UnixMilli(), message}}, s.Logs...)
	if len(s.Logs) > 30 {
		s.Logs = s.Logs[:30]
	}
}

// Advance settles at most 12 hours, including the same interval of growth.
func (s *State) Advance(now time.Time) bool {
	ms := now.UnixMilli()
	if ms <= s.LastTick {
		return false
	}
	hours := math.Min(float64(ms-s.LastTick)/3600000, MaxOfflineHours)
	s.LastTick = ms
	if s.HatchedAt == 0 {
		return true
	}
	beforeEnergy := s.Needs.Energy
	var beforePoints, beforeRest float64
	if s.Growth != nil {
		beforePoints, beforeRest = s.Growth.Points, s.Growth.Care.Rest
	}
	s.settle(hours, now)
	if s.Sleeping && s.SleepSession != nil && s.Growth != nil {
		s.SleepSession.SettledHours += hours
		s.SleepSession.EnergyRecovered += math.Max(0, s.Needs.Energy-beforeEnergy)
		s.SleepSession.RestGain += s.Growth.Care.Rest - beforeRest
		s.SleepSession.GrowthPoints += s.Growth.Points - beforePoints
	}
	s.rememberDays()
	return true
}
func (s *State) Apply(a Action, now time.Time) (string, error) {
	if a.ExpectedSleeping != nil && (a.Kind != "sleep" || s.Sleeping != *a.ExpectedSleeping) {
		return "", ErrSleepChanged
	}
	if a.Kind == "hatch" {
		if s.HatchedAt != 0 {
			return "", errors.New("小伙伴已经孵化啦")
		}
		if a.Species < 0 || a.Species >= len(Species) {
			return "", errors.New("请选择有效的角色")
		}
		s.Species = a.Species
		s.Name = Species[a.Species]
		s.HatchedAt = now.UnixMilli()
		s.LastTick = now.UnixMilli()
		if s.Growth != nil {
			s.Growth.Stage = "baby"
		}
		s.sharedMemory("hatch", now)
		msg := fmt.Sprintf("%s孵化了。今后请多多关照！", s.Name)
		s.Log(now, msg)
		return msg, nil
	}
	if s.HatchedAt == 0 {
		return "", errors.New("先迎接你的第一只小伙伴吧")
	}
	if (strings.HasPrefix(a.Kind, "snake-") || strings.HasPrefix(a.Kind, "tetris-") || strings.HasPrefix(a.Kind, "fish-") || strings.HasPrefix(a.Kind, "walk-") || strings.HasPrefix(a.Kind, "treasure-") || a.Kind == "catch" || a.Kind == "cancel-play" || a.Kind == "tile-pick" || a.Kind == "tile-clear") && s.Game != nil && a.GameID != s.Game.ID {
		return "", errors.New("这不是当前的一局，请刷新后再试")
	}
	if a.Kind == "cancel-play" {
		if a.RequireUnfinished && s.Game.AwaitingFinish() {
			return "", ErrGameFinished
		}
		s.Game = nil
		return "下次再一起玩吧", nil
	}
	if s.Game != nil && !(strings.HasPrefix(a.Kind, "snake-") || strings.HasPrefix(a.Kind, "tetris-") || strings.HasPrefix(a.Kind, "fish-") || strings.HasPrefix(a.Kind, "walk-") || strings.HasPrefix(a.Kind, "treasure-")) && a.Kind != "catch" && a.Kind != "tile-pick" && a.Kind != "tile-clear" {
		return "", errors.New("请先完成小游戏，或通过放弃确认返回")
	}
	if s.Sleeping && a.Kind != "sleep" && a.Kind != "rename" {
		return "", errors.New("它正在睡觉，先把它叫醒吧")
	}
	var msg, diary string
	switch a.Kind {
	case "daily", "buy", "equip":
		var err error
		msg, err = s.applyEconomy(a, now)
		if err != nil {
			return "", err
		}
	case "feed":
		if careNeed(s.Needs.Hunger, 96) >= 96 {
			return "", errors.New("肚子已经饱饱的啦，等一会儿再吃吧")
		}
		before := s.Needs.Hunger
		effect := careActionEffects().Feed
		s.Needs.Hunger = clamp(s.Needs.Hunger + effect.Hunger)
		s.Needs.Clean = clamp(s.Needs.Clean + effect.Clean)
		s.Needs.Mood = clamp(s.Needs.Mood + effect.Mood)
		s.CareCount++
		s.recordCare("feed", before, now)
		s.sharedMemory("meal", now)
		msg = "啊呜！吃了一份香喷喷的小饭团。"
	case "clean":
		if careNeed(s.Needs.Clean, 99) >= 99 {
			return "", errors.New("已经洗得干干净净啦")
		}
		before := s.Needs.Clean
		effect := careActionEffects().Clean
		s.Needs.Clean = clamp(s.Needs.Clean + effect.Clean)
		s.Needs.Mood = clamp(s.Needs.Mood + effect.Mood)
		s.CareCount++
		s.recordCare("clean", before, now)
		s.sharedMemory("bath", now)
		msg = "泡泡咕噜咕噜，又变得香香的了。"
	case "sleep":
		s.Sleeping = !s.Sleeping
		if s.Sleeping {
			s.SleepSession = &SleepSession{StartedAt: now.UnixMilli()}
			s.sharedMemory("goodnight", now)
			msg = "晚安，小伙伴。睡着时体力会慢慢恢复。"
		} else {
			// Only a known session with actual recovery can leave this memory.
			// Ordinary reads and an immediate wake at full energy do not qualify.
			if s.Schema >= 18 && s.SleepSession != nil && s.SleepSession.EnergyRecovered > 0 && s.Needs.Energy == 100 {
				s.sharedMemory("rested", now)
			}
			diary = sleepDiary(s.SleepSession, now.UnixMilli())
			s.SleepSession = nil
			msg = "早安！今天也一起慢慢长大吧。"
		}
	case "play-tetris":
		if s.Needs.Energy < 10 {
			return "", errors.New("有点累了，先睡一觉吧")
		}
		blocks, err := newTetris(now)
		if err != nil {
			return "", err
		}
		s.Game = &MiniGame{ID: newGameID(), Kind: "tetris", Tetris: blocks, StartedAt: now.UnixMilli(), LastBeat: -1}
		return "A 选择 · B 确认 · C 继续；消除 2 行后完成才计入陪伴。", nil
	case "play-treasure":
		if s.Needs.Energy < 10 {
			return "", errors.New("有点累了，先睡一觉吧")
		}
		hunt, err := newTreasure()
		if err != nil {
			return "", err
		}
		s.Game = &MiniGame{ID: newGameID(), Kind: "treasure", Treasure: hunt, StartedAt: now.UnixMilli(), LastBeat: -1}
		return "A 选格 · B 探索 · C 暂停；不计时，准备好再继续。", nil
	case "treasure-dig", "treasure-pause", "treasure-resume", "treasure-finish":
		return s.applyTreasure(a, now)
	case "play-walk":
		if s.Needs.Energy < 10 {
			return "", errors.New("有点累了，先睡一觉吧")
		}
		walking, err := newWalking(now)
		if err != nil {
			return "", err
		}
		s.Game = &MiniGame{ID: newGameID(), Kind: "walk", Walking: walking, StartedAt: now.UnixMilli(), LastBeat: -1}
		return "A 跳跃 · B 蹲下 · C 暂停；轻松走完就有陪伴与发现。", nil
	case "walk-step", "walk-jump", "walk-duck", "walk-pause", "walk-resume", "walk-finish":
		return s.applyWalking(a, now)
	case "play-fishing":
		if s.Needs.Energy < 10 {
			return "", errors.New("有点累了，先睡一觉吧")
		}
		s.Game = &MiniGame{ID: newGameID(), Kind: "fishing", Fishing: newFishing(now), StartedAt: now.UnixMilli(), LastBeat: -1}
		return "A 换钓点 · B 抛竿 · C 暂停菜单；三次机会，慢慢来。", nil
	case "fish-step", "fish-pause", "fish-resume", "fish-spot", "fish-cast", "fish-reel", "fish-finish":
		return s.applyFishing(a, now)
	case "tetris-step", "tetris-move", "tetris-pause", "tetris-resume", "tetris-rotate", "tetris-drop", "tetris-finish":
		return s.applyTetris(a, now)
	case "snake-step", "snake-pause", "snake-resume", "snake-finish":
		return s.applySnake(a, now)
	case "play-snake":
		if s.Needs.Energy < 10 {
			return "", errors.New("有点累了，先睡一觉吧")
		}
		snake, err := newSnake(now)
		if err != nil {
			return "", err
		}
		s.Game = &MiniGame{ID: newGameID(), Kind: "snake", Snake: snake, StartedAt: now.UnixMilli(), LastBeat: -1}
		return "A / C 继续 · B 放弃确认；吃到 3 颗才计入陪伴。", nil
	case "tile-pick", "tile-clear":
		return s.applyTile(a, now)
	case "play-tiles":
		if s.Needs.Energy < 10 {
			return "", errors.New("有点累了，先睡一觉吧")
		}
		tiles, err := newTiles()
		if err != nil {
			return "", err
		}
		s.Game = &MiniGame{ID: newGameID(), Kind: "tiles", Tiles: tiles, StartedAt: now.UnixMilli(), LastBeat: -1}
		return "A 移动 · B 选牌 · C 取消选择 / 退出", nil
	case "play":
		if s.Needs.Energy < 10 {
			return "", errors.New("有点累了，先睡一觉吧")
		}
		s.Game = &MiniGame{ID: newGameID(), StartedAt: now.UnixMilli(), LastBeat: -1}
		return "A 移动 · B 接星星 · C 放弃确认", nil
	case "catch":
		if s.Game == nil || s.Game.Kind != "" || a.Lane < 0 || a.Lane > 2 {
			return "", errors.New("游戏还没有开始")
		}
		beat := (now.UnixMilli() - s.Game.StartedAt) / 900
		if beat <= s.Game.LastBeat {
			return "", errors.New("等下一颗星星落下再接哦")
		}
		s.Game.LastBeat = beat
		s.Game.Round++
		if int(beat%3) == a.Lane {
			s.Game.Score++
			msg = "接住了！★"
		} else {
			msg = "差一点！再试一次。"
		}
		if s.Game.Round >= 5 {
			score := s.Game.Score
			s.recordGameExperience("stars", now)
			s.Game = nil
			s.Needs.Mood = clamp(s.Needs.Mood + 6 + float64(score)*4)
			s.Needs.Energy = clamp(s.Needs.Energy - 8)
			s.Needs.Hunger = clamp(s.Needs.Hunger - 4)
			s.CareCount++
			s.recordCare("play", 0, now)
			s.remember(Memory{Kind: "stars", At: now.UnixMilli(), Source: "shared", Score: score})
			if score == 5 {
				s.remember(Memory{Kind: "perfect-stars", At: now.UnixMilli(), Source: "shared", Score: 5})
			}
			coins := s.rewardStars(score, now)
			msg = fmt.Sprintf("一起接住了 %d 颗星星！+%d 金币（小游戏每日最多 %d）。", score, coins, GameDailyLimit)
		} else {
			return msg, nil
		}
	case "rename":
		name := strings.TrimSpace(a.Name)
		if name == "" || utf8.RuneCountInString(name) > 12 {
			return "", errors.New("名字需要 1–12 个字")
		}
		s.Name = name
		msg = "以后就叫我" + name + "吧！"
	default:
		return "", errors.New("不认识这个操作")
	}
	if diary == "" {
		diary = msg
	}
	s.Log(now, diary)
	return msg, nil
}

func (s State) Validate(now time.Time) error {
	bad := errors.New("存档格式无效，请选择 PixelPet 导出的备份")
	if (s.Schema < 1 || s.Schema > Schema) || s.Species < 0 || s.Species >= len(Species) || strings.TrimSpace(s.Name) == "" || utf8.RuneCountInString(s.Name) > 12 || s.Revision < 0 || s.Revision > 1_000_000_000 || s.CareCount < 0 || s.CareCount > 1_000_000 || len(s.Logs) > 30 {
		return bad
	}
	ms := now.UnixMilli()
	if s.CreatedAt <= 0 || s.CreatedAt > ms || s.LastTick < s.CreatedAt || s.LastTick > ms || s.HatchedAt < 0 || (s.HatchedAt > 0 && (s.HatchedAt < s.CreatedAt || s.HatchedAt > s.LastTick)) {
		return bad
	}
	for _, v := range []float64{s.Needs.Hunger, s.Needs.Mood, s.Needs.Clean, s.Needs.Energy} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 100 {
			return bad
		}
	}
	for _, l := range s.Logs {
		if l.At < s.CreatedAt || l.At > ms || utf8.RuneCountInString(l.Text) > 200 {
			return bad
		}
	}
	if s.HatchedAt == 0 && (s.Sleeping || s.Game != nil) {
		return bad
	}
	if s.Game != nil && ((s.Schema >= 4 && !validGameID(s.Game.ID)) || (s.Schema < 4 && s.Game.ID != "")) {
		return bad
	}
	if s.Game != nil && (s.Game.StartedAt < s.HatchedAt || s.Game.StartedAt > ms || s.Game.Round < 0 || s.Game.Round > 4 || s.Game.Score < 0 || s.Game.Score > s.Game.Round || s.Game.LastBeat < -1 || s.Game.LastBeat > (ms-s.Game.StartedAt)/900) {
		return bad
	}
	if !s.validSleepSession() || !s.validTreasureGame() || !s.validPark() || !s.validWalkingGame() || !s.validCompanion() || !s.validGrowth(now) || !s.validAlbum(now) || !s.validEconomy(now) || !s.validTileGame() || !s.validSnakeGame() || !s.validTetrisGame() || !s.validPond() || !s.validFishingGame() {
		return bad
	}
	return nil
}
