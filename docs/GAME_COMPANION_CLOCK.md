# 贪吃蛇／方块陪伴造型统一校时（2026-10-20）

## 范围与根因

`App` 的成长展示已使用接受响应时的 `serverTime` 与 `performance.now()` 经过时间；但 `SnakeGame`、`TetrisGame` 仍将 `Date.now()` 传给 `petGrowth`。**仅在响应没有 `growth` 的兼容路径**，电脑日期前后偏移会让局内宠物误用年龄估算，和旁边的成长阶段不同。正常当前 Go 服务提供的成长记录一直优先，不是正常存档成长丢失或服务端结算错误。

两个组件现在要求显式 `now`，由 App 传入同一个已校准时间；不再自行取电脑日期，也不拿 `lastTick` 充当会继续推进的显示时间。已有真实 `growth` 仍直接使用保存阶段。六个角色造型及原蛇／方块组件测试只补充必需 prop，原断言不变。

不改服务端、schema17、旧档、成长／照顾规则、成年形态、资源、自动步进协议、三键和现有布局。也不把兼容预览写回存档。

## 复现与回归

### App 集成测试

新增 `web/src/GameCompanionClock.test.tsx` 共 **38 项**：

- 两游戏 × 三阶段（孵化后1／30／80小时）× 首次加载日期偏移（前后7天1234ms及正常），18项。
- 两游戏 × 三阶段 × 运行中前后偏移日期，fake timers 再推进1秒（包含单调时钟），12项。
- 两游戏 × 三种保存阶段优先于本机日期／年龄估算，6项。
- 两游戏分别接受新 `serverTime` 立即更新兼容阶段，再拒绝低 revision 响应倒退，2项。
- 同时检查三键、LCD 无玩法按钮、没有照顾／游戏写请求、不修改夹具状态。

最终测试在旧生产实现上 **18失败／20控制通过**；修复后专项四文件83项通过。全量前端 **4197项／154文件**、TypeScript、隔离 Vite 构建通过。Go 无缓存全量 `-race`、`vet`、独立 binary 构建通过；Vite 仍有既有大 chunk 提示，本轮没有处理代码拆包。

### 独立 HTTP／Chrome

新增 `scripts/check-game-companion-clock.mjs`，自建临时 SQLite、随机端口及独立服务；拒绝共享 binary／dist 的符号链接别名。

- 默认模式 **48组**：两游戏 × 三阶段 × 日期前后7天1234ms × 桌面／320px双倍字号 × 缺失／提供 `growth`。hold 100ms／1000ms 显示 interval，检验首次显示不依赖下一次 tick。
- `--jump-after-load` **48组**：同一矩阵，正常加载后只改浏览器 `Date.now()`；显示 interval 真实运行，实际等待1100ms。刷新后再次偏移并等待，确认同一暂停局与阶段。未更改 OS、服务端、performance、rAF、timeout 或游戏步进时钟。
- 两模式都验证三键、LCD 无新增玩法控件、页面无横向溢出；读取／刷新没有游戏写请求，不自动续玩、不产币、不增加照顾次数。缺失 `growth` **只删除 HTTP 回复字段**，不损坏 SQLite，当前 Go 服务本身仍提供记录。
- 每种模式中，两游戏各有一组320px大字成长期夹具，用真实机身 C 继续、等待实际自动步进、再 C 暂停，共4条操作旅程；不自动结束或收好，不发奖励，不是完整高分游玩。
- 三阶段来自真实 schema1 导入迁移的受控年龄，开局与读取是实际 HTTP；不是自然三天养成、实体手机或系统休眠认证。
- 对上一提交 `70a3cdf` 的独立构建，首组“蛇／幼年／电脑日期偏快／缺失growth”精确失败：预期 `baby`、实际 `adult`。
- 既有显示校时默认36组、运行中跳变36组及小游戏响应保护44组交叉通过，共 **116组**；不重复计入新增96组。

已复核桌面成年方块、320px大字幼年蛇／成长期方块及运行中偏移代表性截图。无横向溢出断言不是所有文字可读性或所有屏幕比例的认证。

## 独立复跑

```sh
# Node、Chrome、Playwright 使用本机安装，以下输出不覆盖玩家构建。
.tools/go/bin/go build -o /tmp/pet-game-companion-clock/pixelpet ./cmd/pet
(cd web && ./node_modules/.bin/vite build --outDir /tmp/pet-game-companion-clock/web)
export PIXELPET_TEST_BINARY=/tmp/pet-game-companion-clock/pixelpet
export PIXELPET_TEST_WEB=/tmp/pet-game-companion-clock/web
export PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
node scripts/check-game-companion-clock.mjs
node scripts/check-game-companion-clock.mjs --jump-after-load
node scripts/check-app-clock.mjs
node scripts/check-app-clock.mjs --jump-after-load
node scripts/check-game-response.mjs
```

日志与构建根目录：`/tmp/pet-game-companion-clock/`。浏览器各次产物目录见相应日志的 `artifacts`；最终采用 `browser-initial-final.log`／`browser-runtime-final.log`，旧构建失败见 `browser-red-final.log`。前端红／绿回归见 `red.log`／`targeted.log`，全量见 `full-vitest.log`。

玩家18102未访问、重启或部署。提交前核对 `data/pixelpet.db`、共享 `bin/pixelpet` 与 `web/dist` 七文件 SHA256 和 dist 完整文件列表保持不变。持续目标保留，下一步仍优先真人试玩的照顾、成长及离开恢复问题，不自动扩充资源或上线第八款游戏。
