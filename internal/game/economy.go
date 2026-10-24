package game

import (
	"errors"
	"fmt"
	"time"
)

const DailyCoins = 10
const GameDailyLimit = 30
const MaxCoins = 1_000_000

type ShopItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Slot        string `json:"slot"`
	Price       int    `json:"price"`
	Description string `json:"description"`
}
type Shop struct {
	MaxCoins       int        `json:"maxCoins"`
	Catalog        []ShopItem `json:"catalog"`
	DailyCoins     int        `json:"dailyCoins"`
	GameDailyLimit int        `json:"gameDailyLimit"`
}

// Prices and the finite catalog are server-owned. Cosmetic items never modify
// needs, growth, game scores or the pet's locked adult form.
func ShopRules() Shop {
	return Shop{MaxCoins: MaxCoins, DailyCoins: DailyCoins, GameDailyLimit: GameDailyLimit, Catalog: []ShopItem{
		{"leaf-pin", "嫩叶胸针", "accessory", 12, "把一片小小的春天，别在胸前。"},
		{"berry-scarf", "草莓围巾", "accessory", 18, "软软的格纹，陪你在星光下跑动。"},
		{"star-badge", "星光徽章", "accessory", 24, "不是高分奖章，只是你喜欢的星星。"},
		{"clover-pot", "四叶草盆栽", "room", 16, "窗边长出一点绿，等你一起回家。"},
		{"patchwork-rug", "拼布地毯", "room", 20, "为小脚丫留下一块柔软的地方。"},
		{"moon-lamp", "月亮夜灯", "room", 26, "睡着时，也有一小盏温柔的光。"},
		{"sunflower-pin", "向日葵胸针", "accessory", 16, "胸前开一朵小花，不遮住自己的模样。"},
		{"sky-bow", "晴空领结", "accessory", 22, "带着浅蓝色的风，继续一起散步。"},
		{"meadow-wall", "小叶墙纸", "wallpaper", 18, "让墙上长出小叶子，窗户仍望向外面。"},
		{"starlit-wall", "晚星墙纸", "wallpaper", 24, "把几颗晚星留在墙上，白天也能看见。"},
		{"autumn-wall", "秋叶墙纸", "wallpaper", 26, "把窗外的秋色留在小窝里，慢慢看叶影换色。"},
		{"honey-floor", "蜂蜜木地板", "floor", 18, "一条条温暖木纹，不占小窝摆件的位置。"},
		{"winter-floor", "雪夜地毯", "floor", 28, "柔软的雪花格纹，让冬日的小脚也有暖处。"},
		{"mint-floor", "薄荷方砖", "floor", 22, "浅浅的绿格子，和喜欢的地毯一起铺好。"},
	}}
}
func shopItem(id string) (ShopItem, bool) {
	for _, item := range ShopRules().Catalog {
		if item.ID == id {
			return item, true
		}
	}
	return ShopItem{}, false
}

type Equipment struct {
	Accessory string `json:"accessory"`
	Room      string `json:"room"`
	Wallpaper string `json:"wallpaper"`
	Floor     string `json:"floor"`
}
type Economy struct {
	Coins       int       `json:"coins"`
	LastDailyAt int64     `json:"lastDailyAt"`
	LastGameAt  int64     `json:"lastGameAt"`
	GameCoins   int       `json:"gameCoins"`
	Owned       []string  `json:"owned"`
	Equipped    Equipment `json:"equipped"`
}

func newEconomy() *Economy { return &Economy{Owned: []string{}} }
func (e *Economy) owns(id string) bool {
	for _, owned := range e.Owned {
		if owned == id {
			return true
		}
	}
	return false
}
func utcDay(ms int64) int64 { return ms / dayMillis }

func (s *State) applyEconomy(a Action, now time.Time) (string, error) {
	e := s.Economy
	if e == nil {
		return "", errors.New("请先更新小窝的存档版本")
	}
	switch a.Kind {
	case "daily":
		if e.LastDailyAt > 0 && utcDay(now.UnixMilli()) <= utcDay(e.LastDailyAt) {
			return "", errors.New("今天的问候已经收好啦，明天再来；不必连续来")
		}
		if e.Coins > MaxCoins-DailyCoins {
			return "", errors.New("小钱包装满啦，先挑一件喜欢的东西吧")
		}
		e.Coins += DailyCoins
		e.LastDailyAt = now.UnixMilli()
		return fmt.Sprintf("今天的小问候：+%d 金币。不必每天来，没有断签惩罚。", DailyCoins), nil
	case "buy":
		item, ok := shopItem(a.Item)
		if !ok {
			return "", errors.New("小店里没有这件物品")
		}
		if e.owns(item.ID) {
			return "", errors.New("已经拥有啦，不用重复购买")
		}
		if e.Coins < item.Price {
			return "", errors.New("金币还不够，慢慢来，不着急")
		}
		e.Coins -= item.Price
		e.Owned = append(e.Owned, item.ID)
		return fmt.Sprintf("收好%s，花费 %d 金币。按 B 可以穿戴或摆放。", item.Name, item.Price), nil
	case "equip":
		item, ok := shopItem(a.Item)
		if !ok || !e.owns(a.Item) {
			return "", errors.New("先拥有这件物品，才能使用哦")
		}
		slot := &e.Equipped.Accessory
		memory := "outfit"
		switch item.Slot {
		case "room":
			slot, memory = &e.Equipped.Room, "decoration"
		case "wallpaper":
			slot, memory = &e.Equipped.Wallpaper, "wallpaper"
		case "floor":
			slot, memory = &e.Equipped.Floor, "floor"
		}
		if *slot == item.ID {
			*slot = ""
			return "收好了" + item.Name + "，想用时再拿出来。", nil
		}
		*slot = item.ID
		s.remember(Memory{Kind: memory, At: now.UnixMilli(), Source: "shared", Item: item.ID})
		return "用上了" + item.Name + "，回小窝看看吧！", nil
	}
	return "", errors.New("不认识这个小店操作")
}

// Only a completed, server-scored game earns coins. Neither starts nor cancels
// earn anything; the store transaction and session removal make retries safe
// even after the bounded request cache has expired. UTC days never go backwards.
func (s *State) rewardStars(score int, now time.Time) int {
	return s.rewardGame(3+score, now)
}
func coinMessage(coins int) string {
	return fmt.Sprintf("+%d 金币（小游戏每日最多 %d）。", coins, GameDailyLimit)
}
func (s *State) rewardGame(amount int, now time.Time) int {
	e := s.Economy
	if e == nil {
		return 0
	}
	day := utcDay(now.UnixMilli())
	if e.LastGameAt > 0 && day < utcDay(e.LastGameAt) {
		return 0
	}
	if e.LastGameAt == 0 || day > utcDay(e.LastGameAt) {
		e.GameCoins = 0
	}
	reward := min(amount, GameDailyLimit-e.GameCoins, MaxCoins-e.Coins)
	e.Coins += reward
	e.GameCoins += reward
	e.LastGameAt = now.UnixMilli()
	return reward
}

func (s State) validEconomy(now time.Time) bool {
	if s.Schema < 4 {
		return s.Economy == nil
	}
	e := s.Economy
	if e == nil || e.Coins < 0 || e.Coins > MaxCoins || e.GameCoins < 0 || e.GameCoins > GameDailyLimit || len(e.Owned) > len(ShopRules().Catalog) {
		return false
	}
	for _, at := range []int64{e.LastDailyAt, e.LastGameAt} {
		if at != 0 && (s.HatchedAt == 0 || at < s.HatchedAt || at > s.LastTick || at > now.UnixMilli()) {
			return false
		}
	}
	if e.LastGameAt == 0 && e.GameCoins != 0 {
		return false
	}
	owned := map[string]bool{}
	for _, id := range e.Owned {
		if _, ok := shopItem(id); !ok || owned[id] || (s.Schema < 9 && !legacyShopItem(id)) {
			return false
		}
		owned[id] = true
	}
	if s.Schema < 9 && (e.Equipped.Wallpaper != "" || e.Equipped.Floor != "") {
		return false
	}
	for slot, id := range map[string]string{"accessory": e.Equipped.Accessory, "room": e.Equipped.Room, "wallpaper": e.Equipped.Wallpaper, "floor": e.Equipped.Floor} {
		if id == "" {
			continue
		}
		item, ok := shopItem(id)
		if !ok || item.Slot != slot || !owned[id] {
			return false
		}
	}
	if s.HatchedAt == 0 && (e.Coins != 0 || len(e.Owned) != 0) {
		return false
	}
	return true
}

// Version 4–8 backups only contained the original six items. Do not accept new
// belongings disguised as an old schema and then silently migrate them.
func legacyShopItem(id string) bool {
	switch id {
	case "leaf-pin", "berry-scarf", "star-badge", "clover-pot", "patchwork-rug", "moon-lamp":
		return true
	}
	return false
}
