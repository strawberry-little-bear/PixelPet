# 微小成长的可见读数（2026-10-20）

## 已复现的问题

成长手册与外侧栏原本把点数向下截到一位小数、百分比截到整数。刚孵化或刚进入成长期，服务端已经记录正数时，仍显示 `0.0` / `0%`，容易被理解为没有成长。既有进度条的原始数值和无障碍描述已经保留微小值，本批补的是**可见数字**，不是重新实现成长或进度条。

新增可见断言在上一批独立构建复现 `0% !== <1%`。最初21项组件回归有10项失败、11项原已符合；后续补2项权威快照更新检查，共新增23项。

## 修复范围

- 共享只读格式：本阶段点数大于0且小于0.1显示 `<0.1`；进度大于0且小于1%显示 `<1%`。
- 精确零仍为 `0.0` / `0%`；普通数值继续向下截位，阶段临界不提前显示完成；成年保持 `72.0` / `100%`。
- 手册为微小值补一句解释；旧schema1无growth兼容估算明确保留来源，不冒称服务端已保存成长。
- 只采用已接受的权威快照，不因本地时间推进或旧响应而虚构增长。刷新不重放照顾，未孵化不显示成长。
- 不改成长速率、积分、阶段/定型判定、需求、奖励、原始进度条、存档schema、旧档或A/B/C三键，不加请求与可点击玩法控件。

## 验收结果与边界

- 前端全量 **3413项 / 132文件**、TypeScript、独立Vite构建通过；Go无缓存全量race、vet与独立构建通过。
- `check-growth-meters.mjs` **63组**：
  - 6组真实schema1迁移读取（三阶段×清醒/睡眠）；
  - 5组独立新存档，从选择伙伴按B进入孵化页，再按B真实孵化，等待自然数秒后读取、打开手册、刷新再读。覆盖桌面/320px普通和双倍根字号，以及320×380短屏双倍字；无响应/时钟夹具，唯一玩法写入为孵化、钱包与照顾次数不变；
  - 52组显式响应夹具（13种零/微小/普通/临界/成年/旧档读数×桌面/320px×普通/双倍文字），验证两处可见数字一致、原始ARIA及进度条值不变、文字/底栏/横向边界、仅三键、只读及零运行错误。夹具不冒称自然成长。
- `check-care-growth-journey.mjs` **8组**交叉回归：四形态×桌面/320px。真实新档孵化后明确构造近阶段门槛历史，再执行实际照顾、睡眠、跨阶段、形态冻结与备份还原，不冒称自然多日养成。
- 已查看自然首秒桌面、320px双倍字号/短屏及成长期微小值大字夹具截图。侧栏文字额外放大进行压力测试；不是实体设备、读屏或所有页面大字号的全面认证。
- 新自然首秒脚本首次误等未孵化档的首页，截图确认实际是选择伙伴页；修正测试走真实两步B流程后完整63组通过，没有为测试改变生产流程。

## 独立复跑

```sh
cd web
./node_modules/.bin/vitest run --maxWorkers=4
./node_modules/.bin/tsc -b
./node_modules/.bin/vite build --outDir /tmp/pet-growth-visible/web
cd ..
.tools/go/bin/go test -count=1 -race ./...
.tools/go/bin/go vet ./...
.tools/go/bin/go build -o /tmp/pet-growth-visible/pixelpet ./cmd/pet
PIXELPET_TEST_BINARY=/tmp/pet-growth-visible/pixelpet \
PIXELPET_TEST_WEB=/tmp/pet-growth-visible/web \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-growth-meters.mjs
# 同一独立构建，使用另一临时库与随机端口：
PIXELPET_TEST_BINARY=/tmp/pet-growth-visible/pixelpet \
PIXELPET_TEST_WEB=/tmp/pet-growth-visible/web \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-care-growth-journey.mjs
```

日志及独立构建：`/tmp/pet-growth-visible/`；最终浏览器产物后缀为 `pixelpet-growth-meters-sBJbgq`、`pixelpet-care-growth-journey-Rk8ude`，完整路径见日志。

本批不访问、重启或部署玩家18102服务，不改玩家数据库、共享bin/dist；持续完善目标保留。后续继续优先真实试玩可复现的照顾、成长和离开恢复问题，自动验收不代替真人对节奏与易读性的评价。
