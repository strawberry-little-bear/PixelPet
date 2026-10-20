# 每日额度的本地刷新时间（2026-10-20）

## 体验缺口与范围

经济规则原本就是 UTC 日切换，游戏目录已有“UTC 日更新”，问候可领取时也写了 UTC 0 点；这不是奖励计算 Bug。但领取后的“明天再来”省略了日界线，且两个入口都没有给出玩家本地的具体刷新时间。

- 游戏目录、商店“今日问候”共用只读说明，例如“下次更新：2026/10/21 08:00（本地；UTC 0 点）”。日期和时区来自浏览器；示例时间不是固定北京时间。
- 按服务端校准的 `now` 计算下一 UTC 日起点，用该未来时刻的本地时区偏移格式化，包含夏令时变化。`time[datetime]` 保留对应的 ISO 时刻。
- 使用当前时间与各自最近问候/游戏奖励时间的较大值，遵守既有时间倒退保护；问候和游戏时间戳不串用。异常或不可表示的时刻不显示虚假日期。
- 已领取改为“今日已领取 · 不必连续来”。可领取、睡眠、钱包满、当日游戏额度耗尽时仍有时间说明；未知规则/经济数据不估算，物品分类不增加无关说明。
- 不新增倒计时、通知、定时请求或交互控件，不自动领取；既有 UTC 规则、10 币问候、30 币共享游戏额度、钱包上限、照顾/成长、schema和三键不变。旧服务/旧档仍使用原有字段。

## 截图复核补出的商店布局问题

最终截图另发现双倍字号时，商店目录的预览说明与分类重叠。旧目录选择器比阅读模式更具体，仍将预览区固定高度；两行说明越过父盒，既有裁切检查因为`overflow: visible`而漏过两元素互相覆盖。

新浏览器断言在未修CSS上复现说明底部越过分类顶部约35.8px。仅给阅读模式目录增加足够具体的`height: auto`覆盖，让说明参加自然排版；不改预览角色大小、分类位置语义、普通同步/焦点和三键。回归明确比较预览说明底部与分类顶部，而不再只检查裁切/横向溢出。

## 验收

- 新增前端40项：旧界面的14项先跑有9失败、5项原本符合；其后新增26项纯计算、非法时间及本地格式测试。
- 覆盖精确日界线、年界线、闰日、保存时间在未来、问候与游戏各自日界线、未知规则、睡眠和已满钱包。六个本地时区含整点、半小时、45分钟偏移，另有纽约春秋夏令时切换前后的未来时刻测试。
- 全量前端3378项/130文件、TypeScript和独立Vite构建通过；Go无缓存全量race、vet、独立构建通过，无Go生产改动。
- 新脚本 `scripts/check-daily-refresh.mjs`：独立真实HTTP/SQLite/Chrome共54组（三阶段 × 六时区 × 桌面 / 320px双倍文字 / 短屏强制颜色）。每组从临时旧schema档迁移，实际按B领取一次10币，刷新后核对不重复发币，再只读进入游戏目录；验证本地日期与ISO时刻、字号、文字/底栏/横向边界、预览说明不压到分类、末尾说明可滚到、仅三键和零运行错误。已查看最终桌面与手机大字强制颜色截图。
- 浏览器按实际测试时刻运行；精确日切换、夏令时和时间倒退由受控组件测试覆盖，不冒称自然跨日、多日养成或实体设备认证。没有为测试耗尽额度而修改真实HTTP奖励数据；额度耗尽说明保留并由组件回归覆盖。

复跑（Node需在PATH，Go使用仓库`.tools/go/bin/go`）：

```sh
cd web
./node_modules/.bin/vitest run --maxWorkers=4
./node_modules/.bin/tsc -b
./node_modules/.bin/vite build --outDir /tmp/pet-daily-refresh/web
cd ..
.tools/go/bin/go test -count=1 -race ./...
.tools/go/bin/go vet ./...
.tools/go/bin/go build -o /tmp/pet-daily-refresh/pixelpet ./cmd/pet
PIXELPET_TEST_BINARY=/tmp/pet-daily-refresh/pixelpet \
PIXELPET_TEST_WEB=/tmp/pet-daily-refresh/web \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-daily-refresh.mjs
```

日志和独立构建：`/tmp/pet-daily-refresh/`。浏览器截图、临时库及JSON结果路径由脚本输出。脚本拒绝共享bin/dist（包括其软链接），只监听随机测试端口；不访问、重启或部署玩家18102服务。
