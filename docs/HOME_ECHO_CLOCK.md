# 回窝短回应使用本地单调期限（2026-10-20）

## 问题与修复范围

真实游戏结算后的回窝回应原本将 `Date.now() + 12000` 存为本页期限，并在渲染时比较墙钟。本机日期前拨七天后，下一个显示 tick 会提前隐藏回应；期限内再拨回来还可能重新出现。结算、兴趣、存档最近经历和成长本身并没有出错。

现在只将这段**本页临时显示**的截止时间改为 `performance.now() + 12000`，定时清除和显示判断都使用同一单调时间。它不使用服务端显示时钟锚点，普通校时不会重新开始回应。12 秒仍从实际接受结算开始计算，不从庆祝结束或回到正常日期开始计算；庆祝继续优先播放。

- 不改已保存的 `companion.recent.at`、兴趣、奖励、成长、需求、schema 或迁移。
- 不扩大真实经历的资格：仍需本地结算、正确局 ID 和照顾回执；读取/刷新/同步不能造回应。
- 原有饥饿/疲惫/脏污/睡眠优先、离开/帮助/存档盒/跳过/后台清除规则保持。
- 仍只有 A/B/C 三键；LCD 不增加交互控件。
- 不处理系统休眠期间所有平台的 performance 差异；后台继续按原规则作废，不排队补播。不是新离线结算规则。

## 独立复跑

先在独立目录构建前后端，不能使用共享 `bin/pixelpet` 或 `web/dist`：

```sh
.tools/go/bin/go build -o /tmp/pet-home-echo-clock/pixelpet ./cmd/pet
(cd web && ./node_modules/.bin/vite build --outDir /tmp/pet-home-echo-clock/web)
PIXELPET_TEST_BINARY=/tmp/pet-home-echo-clock/pixelpet \
PIXELPET_TEST_WEB=/tmp/pet-home-echo-clock/web \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-home-echo-clock.mjs
```

需要可用的 Node、Playwright 和 Chrome。脚本拒绝共享产物及符号链接别名；自建随机端口、临时 SQLite 并在退出时关停服务。不会访问玩家18102服务。

浏览器脚本只偏移 `Date.now`，不改 OS/服务时间、performance、rAF 或 timeout；真实等待结算庆祝和约12秒到期。三阶段由 schema1 导入迁移构造，寻宝选格读取测试地图，不冒称自然多日养成、盲玩、实体手机或真人舒适度验收。

## 本批验证

- 新增5项App回归：三阶段回应显示时先前拨七天、后拨七天、恢复，另测庆祝期间正/负偏移；保留原截止时间、精确12秒清除、到期后不重播、保存日期和写请求数不变。旧实现 **4失败 / 1通过**，后拨控制并非红测试；修复后5项全过。原有中断/失败/需求优先保护和最近经历回看测试保留。
- 定向三文件130项，全量前端 **3601项 / 140文件**，TypeScript与独立Vite构建通过；Go无缓存全量race、vet和独立构建通过。独立节奏协议/HTTP18项与历史算术6项交叉通过，没有正式第八款或奖励变化。
- 新Chrome **12组**：三阶段 × 桌面/320px双倍文字强制颜色 × 庆祝中/回应已显示后跳变。两类均依次检查正/负七天与恢复，真实等待显示interval和原始约12秒到期；到期再改日期及刷新不重播，持久最近经历时间不变、照顾只结算一次，只有三键且无横向溢出。均使用减少动态模式；不是所有动画/真人长玩认证。
- 相同浏览器脚本在上一批独立构建首组因前拨日期隐藏回应而失败。新版12组通过，实际查看桌面幼年与320px双倍文字强制颜色的回应截图。共享产物的两个符号链接别名也被最终脚本启动前拒绝。
- 既有运行中显示校时Chrome **36组**交叉通过，沿用原先响应/经济夹具边界，不冒称全七款均真实完成。七款共用同一小窝计时逻辑，本批真实结算浏览器路径为寻宝，App新增单测路径为接星星。

日志/隔离构建：`/tmp/pet-home-echo-clock/`。新增12组产物：`/var/folders/12/7y0bpzpj5055788qjjnq3c9c0000gn/T/pixelpet-home-echo-clock-jBlcdR`；校时36组：`/var/folders/12/7y0bpzpj5055788qjjnq3c9c0000gn/T/pixelpet-app-clock-vmH2Oj`。

玩家数据库、共享bin/dist七文件SHA256和dist完整列表保持不变，18102未访问/部署/重启。试玩页不会自动加载本次独立构建；持续目标保留，下一步仍优先真实试玩的照顾、成长和离开恢复问题，不为迭代增加每日负担。
