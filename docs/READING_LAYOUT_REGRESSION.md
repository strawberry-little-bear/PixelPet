# 阅读布局统一回归

PixelPet 的阅读页必须保持同一套物理外壳：设备高度稳定，长内容在 LCD 内滚动，三枚机身键始终可见。这个约束覆盖普通阅读页、小游戏暂停／结算、回访小结和异常恢复，但恢复界面不能误套用回访固定高度。

## 一键运行

先按[开发说明](DEVELOPMENT.md#验证与隔离构建)构建隔离后端和前端，再设置三项环境变量：

```sh
export PIXELPET_TEST_BINARY=/absolute/path/to/temporary/pixelpet
export PIXELPET_TEST_WEB=/absolute/path/to/temporary/web
export PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs

node scripts/check-reading-layout.mjs
```

也可以只跑一个或几个专项，例如：

```sh
node scripts/check-reading-layout.mjs check-return-layout check-return-scroll check-recovery-reading
```

统一入口按顺序调用现有专项脚本，不共享数据库、端口或浏览器上下文。每个脚本仍由 `browser-test-builds.mjs` 拒绝仓库的 `bin/`、`web/dist/` 及其别名，因此不能把玩家服务或正式构建误当成测试目标。

## 当前覆盖

- 首次迎接、首页／状态页身份布局、普通照顾、日记、记忆回看、纪念册、图鉴、商店、状态和成长阅读页；首页切到状态页时比较完整设备外壳几何，防止机身跳高。
- 小游戏入口说明、七款小游戏的规则／阅读态、暂停／结算态，以及 LCD 内滚动到底。
- 接星星、连连看和游戏纪念物各自的完整阅读流程；小窝纪念角切换空位／已选物件时，设备、机身、屏幕外壳和 LCD 内容区高度保持一致；照顾回执／临时通知不能遮挡正文或三个操作键。
- 回访第 1／2 页等高、换页归零、滚动中替换内容不继承旧滚动目标、触摸边界不带动外层页面。
- 桌面、390px 手机、320px 极窄视口，以及普通字号和 200% 根字号。
- 三个物理按键的可见性、横向溢出、LCD 内没有新增可点击玩法控件。
- 断线、坏档和时间异常恢复界面保持自己的自然高度，不被固定阅读壳截断。

图鉴的长文检查以 LCD 滚动区的完整可滚动内容范围为准；进入暂停菜单后，也会分别滚动验证标题和末尾提示可达，不把当前滚动位置误判为裁切。

## 验收边界

这些是隔离数据库、模拟视口和自动化 Chrome 回归，不能替代实体手机、真人读屏、真实多日养成或长时间游玩的舒适度验收。测试不访问、重置、导入或覆盖 `data/pixelpet.db`，也不会连接或重启正式服务。
