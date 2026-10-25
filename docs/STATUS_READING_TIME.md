# 状态读数的记录时间（2026-10-20）

## 为什么补这一项

四项需求会随时间变化，但状态页此前没有说明这些读数对应哪个时刻。现于状态第一页的需求条下方显示「状态记录截至（本地时间）」及年月日、时分秒，明确四项需求来自已保存状态，不是浏览器实时推算。状态入口现在按三页阅读：第一页是当前读数，第二页是共同生活回顾，第三页是时间与状态规则说明；A 翻页、B/C 返回不变。

这是状态来源的体验补充，不是衰减或成长算法修复。时间直接取自**同一份已接受状态的 `lastTick`**，不用响应到达时间、服务端响应顶层时间或 `Date.now()` 替代；不新增计时器、写请求或自动照顾，不改离线结算上限、需求速率、成长、奖励、schema和旧档。

- 后台接受更新快照时，需求和时间一起更新；同一快照重复读取、本地时钟走动、旧revision响应均不能凭空刷新显示时间。
- 日期按浏览器本地时区显示，并保留机器可读的ISO `time[datetime]`；跨日不只显示一个含糊的钟点。
- 旧档仍可显示已有 `lastTick`，不依赖成长或睡眠新字段。组件遇到非法/缺失时间会说明未读到，不补写当前时间；这项防御不表示服务端允许损坏存档。
- 文字使用当前阅读字号、自然换行和原生页面滚动，不缩字、不抢焦点、不新增LCD玩法控件；回访小结的固定屏幕布局不变。

## 验收

- 新增 **30项**：20项组件覆盖有效日期范围、类型/范围异常、机器时间与本地显示、无计时器；10项App覆盖三阶段×清醒/睡眠、同快照与新/旧revision、需求/时间一致、两页与B/C返回、旧schema缺growth。最初10项App用例在原实现上全部失败。
- 定向4文件 **81项**、最终全量前端 **3491项 / 136文件**、TypeScript及独立Vite构建通过。Go无缓存全量race、vet及独立二进制构建通过。
- 新增独立Chrome脚本 `scripts/check-status-reading.mjs`，最终 **48组**实际HTTP读取：三阶段×清醒/睡眠×上海/洛杉矶时区×桌面、320px双倍字号、320×380短屏、双倍字号强制颜色。使用临时SQLite真实schema1迁移；路由仅记录并转交原响应，不篡改状态或时间。
- 每组核对时间和四项需求均匹配浏览器实际收到的同一份状态，显式时区格式、刷新后新读取、A翻页不造新时间、返回、文字/底栏/横向边界、区域不重叠、阅读字号不缩、原生滚动可达以及仅三键。没有照顾写请求。
- 同脚本对上一批独立前端构建在首组缺少时间区时失败。首轮脚本曾因同时匹配LCD和侧栏的两份同名需求条而失败，已限定在LCD内；没有为测试修改产品读数。
- 既有照顾/成长阅读脚本最终 **18组**通过，另验证八页阅读定位、普通同步不抢滚动/焦点及原生Enter/Space单次翻页，不重复计入48组。
- 已复核最终桌面、320px双倍字号短屏及睡眠强制颜色截图，文字自然换行、无裁切，仅A/B/C操作。新脚本产物：`/var/folders/12/7y0bpzpj5055788qjjnq3c9c0000gn/T/pixelpet-status-reading-8SZwgU`；交叉回归产物：`/var/folders/12/7y0bpzpj5055788qjjnq3c9c0000gn/T/pixelpet-care-reading-7FuGIO`。

本批是可复现的界面与响应一致性验证，不代替实体手机、读屏认证或自然多日养成。测试构造阶段年龄，不冒称自然成长经过两个阶段。

日志和独立构建：`/tmp/pet-status-reading/`。没有访问、重启或部署玩家18102服务；提交前核验玩家数据库、共享bin/dist七文件SHA256和dist完整文件列表不变。持续完善目标保留。

## 独立复跑

```sh
.tools/go/bin/go test -count=1 -race ./...
.tools/go/bin/go vet ./...
.tools/go/bin/go build -o /tmp/pet-status-reading/pixelpet ./cmd/pet
(cd web && ./node_modules/.bin/vitest run --maxWorkers=4)
(cd web && ./node_modules/.bin/tsc -b)
(cd web && ./node_modules/.bin/vite build --outDir /tmp/pet-status-reading/web-final)
PIXELPET_TEST_BINARY=/tmp/pet-status-reading/pixelpet \
PIXELPET_TEST_WEB=/tmp/pet-status-reading/web-final \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-status-reading.mjs
```

需将Node加入PATH并安装Chrome；按本机环境替换Playwright模块路径。脚本选择随机端口和临时数据库，并通过真实路径核对拒绝共享bin/dist（含符号链接别名）。
