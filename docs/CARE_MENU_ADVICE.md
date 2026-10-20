# 菜单中的当前照顾建议（2026-10-20）

## 本批改进

照顾菜单在选项列表之后、所选操作说明之前，显示「现在怎么照顾 · 最近读取」。直接复用状态页已有的 `CareAdvice`，依据最近接受的服务端状态给出吃饭、清洁、休息、玩耍、安静陪伴或不必反复照顾的建议；睡眠中会说明何时先叫醒。

这是一个体验补充，**没有发现或改动成长/照顾算法Bug**。不新建阈值，不改变照顾效果、成长速度、成年形态、习惯、资源、schema和旧档迁移；缺少成长记录的旧状态仍可根据需求给建议，不编造成长奖励。

- 建议只读，不自动选择、更不会自动照顾。默认仍选「吃点东西」，A/B/C顺序与返回行为不变。
- 接受新状态后更新建议；本地时钟不自行推算需求，旧revision响应不能覆盖较新的建议。
- 仍只有三个实体玩法按键，LCD不添加可点击控件。
- 建议使用既有阅读字号，强制颜色使用系统边框；随页面自然展开和滚动，不额外引入内层滚动或抢夺定位。不改变回访小结的固定屏幕布局。

## 验收

- 新增 **34项**App回归：三阶段×10种状态，全部12个菜单选项顺序、只读、刷新状态接受、旧档降级、点击不执行和B执行实际选择。将最终34项测试放在临时源码副本并替换为旧App时，**34项均失败**；没有回退工作树。
- 定向5文件 **82项**，前端全量 **3461项 / 134文件**，TypeScript、独立Vite构建，Go无缓存全量race、vet及独立二进制构建全部通过。
- 独立Chrome **132组**：三阶段×11种状态×四种显示模式（1280×900常规字、320×568双倍字、同尺寸强制颜色、320×380双倍字）。其中108组实际schema1导入与读取，24组是明确标记的满体力响应夹具；不把浏览器自然衰减后的体力冒称始终精确100。构造阶段年龄不等于自然多日成长。
- 核对与状态页建议一致、默认选择不变、刷新保留建议、文字不裁切、无横向溢出、菜单/建议/预览不重叠、建议字号不缩、原生滚动可达以及仅三键。除明确的操作测试外，不发送照顾写请求。
- 其中 **12组**在建议休息时真实按B执行默认喂食，确认服务响应和持久读取都是喂食、没有改为睡眠，也没有为原已满足的饱食记录习惯或成长奖励。它们包含在132组内，不重复计数。
- 同一浏览器脚本对上一批独立前端构建在首组等待新建议区时失败，证明新增断言能识别缺失实现。既有菜单阅读/定位 **15组**交叉通过，保持普通同步不抢滚动/焦点。
- 已人工查看最终桌面舒适状态、320px双倍字睡眠清洁建议的短屏和强制颜色截图。这不是实体手机、读屏或自然长期真人游玩认证。

日志和独立构建：`/tmp/pet-menu-advice/`。最终浏览器结果与截图：`/var/folders/12/7y0bpzpj5055788qjjnq3c9c0000gn/T/pixelpet-care-menu-guidance-ZiJK0s/`；既有阅读回归产物：`/var/folders/12/7y0bpzpj5055788qjjnq3c9c0000gn/T/pixelpet-care-menu-reading-a6u5dz/`。

本批没有访问、重启或部署玩家18102服务；玩家数据库、共享bin/dist七文件SHA256及dist完整文件列表核对不变。持续完善目标保留，后续仍优先处理实际照顾、成长、离开恢复的可复现问题，不用自动化组数替代真人反馈。

## 独立复跑

先构建到临时目录，不能将测试输出覆盖共享bin/dist或使用玩家库：

```sh
.tools/go/bin/go test -count=1 -race ./...
.tools/go/bin/go vet ./...
.tools/go/bin/go build -o /tmp/pet-menu-advice/pixelpet ./cmd/pet
(cd web && ./node_modules/.bin/vitest run --maxWorkers=4)
(cd web && ./node_modules/.bin/tsc -b)
(cd web && ./node_modules/.bin/vite build --outDir /tmp/pet-menu-advice/web)
PIXELPET_TEST_BINARY=/tmp/pet-menu-advice/pixelpet \
PIXELPET_TEST_WEB=/tmp/pet-menu-advice/web \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-care-menu-guidance.mjs
```

浏览器脚本自行选择临时端口和SQLite，拒绝直接传入共享bin/dist路径；需已安装Chrome，并将Node加入PATH。其他机器请替换Playwright模块路径。
