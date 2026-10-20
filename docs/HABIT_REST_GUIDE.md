# 成长手册的休息规则同步（2026-10-20）

## 可复现的问题

成长手册第2页“照顾习惯”仍写死「休息按体力恢复积累，每 28 点 +0.25」，而睡眠菜单、入睡回执和手册第5页已读取响应中的 `careRules.growth`。缺少或无效的基准下，第2页会继续给出猜测数字；接受另一组合法基准后，两页也会矛盾。

独立旧构建上的浏览器断言已复现：响应明确给出17.5 / 0.4时，第2页仍显示28 / 0.25。新增14项组件/App用例在旧版失败；这是同一说明问题及其边界，不是14个独立产品Bug。

## 本批修复

- 第2页复用既有 `sleepGrowthGuidance`，与睡眠预览/入睡回执使用同一说明来源；第5页继续读取同一份响应基准。
- 幼年、成长期显示每恢复多少体力记录休息习惯，以及相应成长点，并明确按实际恢复比例记录。
- 成年保留“不再加成长点”，只说明休息习惯和成年形态不变，不承诺继续获得成长点。
- 基准缺失/无效时只提示尚未读到，以服务端为准；旧响应没有成长记录时，不用年龄估算冒充已保存的睡眠成长。
- 新规则响应可更新当前打开页，过期响应不覆盖已接受规则；刷新后仍按实际读到的能力显示。
- **不改成长/睡眠算法、实际默认28 / 0.25、需求、奖励、schema、旧档或A/B/C操作。** 一般照顾规则不在本批调整范围；不声称所有手册数字都已改为动态配置。

## 验收与边界

- 新增14项组件/App回归；定向5文件117项通过，最终全量 **3427项 / 133文件**通过，TypeScript及独立Vite构建通过。
- Go无缓存全量 `-race`、`vet` 与独立二进制构建通过；本批无后端代码变更。
- 新增 `scripts/check-habit-rest-guide.mjs`，独立临时SQLite/随机端口/Chrome **54组**通过：
  - 18组真实schema1迁移读取：三阶段 × 清醒/睡眠 × 三种显示模式。年龄和初始状态为构造输入，不冒称自然多日成长。
  - 36组显式响应夹具：三阶段 × 合法不同基准/缺少元数据/无效基准/旧响应无成长记录 × 三种显示模式。
  - 三种显示模式为1200×700正常字、320×700双倍根字号、320×380双倍根字号并启用强制颜色；均减少动态效果。
  - 经机身三键进入第2页、与第5页交叉、刷新后重新读取并退出，检查说明、文字/底栏边界、无横向溢出、字号未缩、零LCD玩法控件和零运行异常。无照顾/经济操作请求，钱包、照顾次数、睡眠状态、阶段及形态不因阅读改变；真实睡眠中的自然结算仍照常。
  - 17.5 / 0.4仅为能力与布局响应夹具，**不是实际服务规则改变或按此结算的证明**。
- 既有 `check-growth-meters.mjs` **63组**交叉通过：6组迁移读取、5组真实新档两步B孵化后自然数秒成长、52组显式读数/布局响应夹具；不把边界夹具当作自然成长。完整分类见[GROWTH_VISIBLE_PROGRESS.md](GROWTH_VISIBLE_PROGRESS.md)。
- 已查看最终幼年桌面、成长期320px双倍字、成年正常规则桌面及成年无效规则短屏强制颜色截图，完整长文和底栏均可读。自动验收不代替实体设备/真人易读性评价。

日志与独立构建：`/tmp/pet-habit-rest/`；54组浏览器截图和 `results.json` 目录后缀为 `pixelpet-habit-rest-926xMx`，完整路径见 `browser.log`。63组交叉产物后缀为 `pixelpet-growth-meters-ihuNnF`，完整路径见 `growth-meters.log`。

## 独立复跑

```sh
cd web
./node_modules/.bin/vitest run --maxWorkers=4
./node_modules/.bin/tsc -b
./node_modules/.bin/vite build --outDir /tmp/pet-habit-rest/web
cd ..
.tools/go/bin/go test -count=1 -race ./...
.tools/go/bin/go vet ./...
.tools/go/bin/go build -o /tmp/pet-habit-rest/pixelpet ./cmd/pet
PIXELPET_TEST_BINARY=/tmp/pet-habit-rest/pixelpet \
PIXELPET_TEST_WEB=/tmp/pet-habit-rest/web \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-habit-rest-guide.mjs
# 同一独立构建，另一临时库和随机端口：
PIXELPET_TEST_BINARY=/tmp/pet-habit-rest/pixelpet \
PIXELPET_TEST_WEB=/tmp/pet-habit-rest/web \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-growth-meters.mjs
```

本批未访问、重启或部署玩家18102服务，未修改玩家数据库、共享bin/dist。持续完善目标保留，继续优先照顾、成长和离开恢复的实际可复现问题，不为扩内容增加打卡资源。
