# 开发与运行说明

[项目首页](../README.md) · [文档导航](README.md) · [协作规则](../AGENTS.md)

## 环境

- Go 1.26+，依据 [`go.mod`](../go.mod)。SQLite 驱动为 `modernc.org/sqlite`，不需要 CGO。
- Node.js `^24.15.0 || >=26.0.0`，pnpm 11.25.0，依据 [`web/package.json`](../web/package.json)。
- 使用已提交的 `web/pnpm-lock.yaml`；安装依赖用 `pnpm install --frozen-lockfile`。

下列命令均从仓库根目录开始，除非代码块明确 `cd web`。首次启动和单服务构建见[首页快速开始](../README.md#快速开始)。

## 前后端开发

```sh
# 终端一：后端，默认 http://127.0.0.1:8080
go run ./cmd/pet

# 终端二：Vite，默认 http://127.0.0.1:5173
cd web
pnpm install --frozen-lockfile
pnpm dev
```

Vite 将 `/api` 代理到 `127.0.0.1:8080`，见 [`vite.config.ts`](../web/vite.config.ts)。如果修改后端端口，须同时调整代理。开发与构建运行默认共用 `data/pixelpet.db`；要试验新存档，请给后端显式指定独立数据库，而不是清空玩家数据库。

```sh
# 替换上面的后端命令：使用全新的临时存档
DEV_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixelpet-dev.XXXXXX")"
PIXELPET_DB="$DEV_DIR/test.db" go run ./cmd/pet
```

不要在已有玩家服务的端口上启动第二个后端，也不要把临时测试请求发给玩家服务。

## 服务配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PIXELPET_ADDR` | `127.0.0.1:8080` | HTTP 监听地址 |
| `PIXELPET_DB` | `data/pixelpet.db` | SQLite 存档路径 |
| `PIXELPET_WEB` | `web/dist` | 已构建网页目录 |

相对路径以启动进程的工作目录为基准；[`scripts/run.sh`](../scripts/run.sh) 会先切到仓库根目录，并在 PATH 无 Go 时尝试 `.tools/go/bin/go`。脚本要求已有 `web/dist/index.html`，不会自动构建前端。

这是没有身份认证的本地单玩家服务，不要直接暴露到公网。配置一个监听地址不等于具备安全的多人部署能力。

存档盒可查看[运行信息与构建标识](RUNTIME_INFO.md)，用于核对当前页面的同步诊断、接收时间及分别构建的网页／后端版本。查询成功不代表存档正常，也不自动部署 GitHub 新代码。

添加到主屏幕、图标资源和服务连接条件见[主屏幕与独立窗口](HOME_SCREEN.md)。

### 实体手机隔离试玩

需要在手机上检查前后台、锁屏、扬声器／耳机或 VoiceOver／TalkBack 时，可临时把**独立构建**开放给同一可信 Wi-Fi 下的手机。此服务没有身份认证，只能用于一次性测试宠物和临时数据库；不要连接玩家存档，不要在公共 Wi-Fi 或公网使用。它是普通 HTTP 浏览器访问，不代表已验收 PWA 安装行为。

从仓库根目录在终端前台运行，保持终端开启：

```sh
DEVICE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixelpet-device.XXXXXX")"
go build -o "$DEVICE_DIR/pixelpet" ./cmd/pet
(cd web && pnpm exec tsc --noEmit && pnpm exec vite build --emptyOutDir --outDir "$DEVICE_DIR/web")
PIXELPET_DB="$DEVICE_DIR/device-test.db" \
PIXELPET_ADDR="0.0.0.0:18081" \
PIXELPET_WEB="$DEVICE_DIR/web" \
"$DEVICE_DIR/pixelpet"
```

若 `18081` 已被占用，换一个本机空闲端口。查看运行电脑当前 Wi-Fi 的局域网 IPv4 地址，在手机连接同一可信 Wi-Fi 后访问 `http://电脑的局域网IPv4:18081/`。只允许操作测试宠物；结束后在服务终端按 `Ctrl+C`。临时目录保留在本机，确认不再需要后可自行删除。详细步骤与结果记入[真人设备验收记录](REAL_DEVICE_ACCEPTANCE.md)。

### Windows 与 exFAT

`web/pnpm-workspace.yaml` 已固定使用 `nodeLinker: hoisted`，让 pnpm 使用平铺的依赖目录。Windows exFAT、同步盘或受限目录无法创建 symlink 时，先删除已有的 `web/node_modules`，再在 `web/` 中重新执行 `pnpm install --frozen-lockfile`。不要把依赖目录从 NTFS 复制到 exFAT 后继续复用；重新安装可以避免旧链接残留。安装完成后仍使用同一条 `pnpm build` 命令。

## 验证与隔离构建

后端和前端单元测试使用测试夹具／临时库；浏览器验收必须另外指定临时数据库和测试端口。下面把构建输出也放进独立目录，避免覆盖玩家正在使用的 `bin/pixelpet` 和 `web/dist`：

```sh
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixelpet-check.XXXXXX")"

go test -race -count=1 ./...
go vet ./...
go build -o "$CHECK_DIR/pixelpet" ./cmd/pet

(cd web && pnpm install --frozen-lockfile)
(cd web && pnpm test) # Uses one isolated jsdom worker with a 30s test timeout
(cd web && pnpm exec tsc --noEmit)
(cd web && pnpm exec vite build --outDir "$CHECK_DIR/web")

node --test scripts/*.test.mjs prototypes/rhythm/*.test.mjs
node scripts/check-build-cache.mjs
```

浏览器脚本按专项文档运行，显式提供 `PIXELPET_TEST_BINARY`、`PIXELPET_TEST_WEB` 和 `PIXELPET_PLAYWRIGHT_MODULE`。可用脚本及保护规则见 [`browser-test-builds.mjs`](../scripts/browser-test-builds.mjs)；不要直接运行未知脚本并假定它不会触及共享构建。玩家库 `data/pixelpet.db` 不用于测试，也不通过导入或重置覆盖。

阅读页的集中回归入口是 `node scripts/check-reading-layout.mjs`，会顺序调用首次迎接、普通阅读、小游戏规则／游玩、提示、回访和异常恢复的专项脚本；也可以把一个或多个脚本名作为参数，只跑指定范围。覆盖矩阵与验收边界见[阅读布局统一回归](READING_LAYOUT_REGRESSION.md)。

陪伴闲聊的专项回归是 `node scripts/check-quiet-memory.mjs`，同样需要上述三个隔离环境变量。它在临时库中导入阶段年龄夹具，再通过真实喂食、洗澡操作生成回忆，检查 A/B 双向回忆与首尾循环、C 返回陪伴选择再回小窝、重复回应的真实 CSS 动画（结束后／播放中再按 B）、普通读取不重播、减少动态效果、阅读区 Enter 不操作、分层返回、刷新、小屏文字可达和闲聊无写入；触摸机身键后核对当前标题、对白与回忆来源进入视口，阅读区切回触摸不漏按或重复，普通同步不重放定位；另通过独立客户端真实入睡／起床，核对三种睡眠陪伴、闭眼姿态、睡眠状态保持、刷新和同步后旧回应清除。加 `--items-only` 可单独检查四槽物品回忆：构造库存后通过真实使用／收起生成纪念，换装后仍聊起保存的旧物，并核对轮换、刷新、320px 双倍字号及无额外写入。加 `--room-only` 可单独检查已保存布置在陪伴场景中的显示、静止背景与宠物回应分层、外部换装／收起同步、刷新和睡眠，默认完整运行也包含这组检查。阶段与库存夹具不代表自然多日游玩或自然赚齐物品。

加 `--reactions-only` 可检查成长发呆动作及无记录时的中性文字。空成长期的三种视口使用该页专属的只读响应投影（照顾与有效时间归零），随后撤掉投影接收真实服务数据，核对普通同步不重播回应、不移动焦点；不把这组构造边界算作自然养成或数据库迁移验收。其余阶段、成年形态、睡眠、三键和刷新仍在隔离服务中验证。

两个代表视口还检查帮助／重置取消／存档盒关闭后保留对白、不重播动画或阅读定位、键盘 B 能继续轮换；通过仅限该页的读取网络拦截，验证重连先清旧回应、再按 B 才重新互动。该模拟不覆盖实体手机后台或服务进程重启。

`node scripts/check-game-history.mjs` 还会在真实重复完成接星星后检查闲聊：从保存的最近一局与首次纪念轮换、显示完成时间、阅读 Enter 不操作、刷新后主动再聊、无额外操作写入；覆盖桌面与 320×380 双倍根字号。沿用三个隔离环境变量；成年年龄及高熟悉度背景为显式夹具，不能作为自然长期游玩的证据。产品逻辑只读现有 `companion.recent`，不新增存档字段或奖励，边界见[共同游戏闲聊](COMPANION.md#闲聊记得最近一次共同游戏)。

状态头像专项回归为 `node scripts/check-status-appearance.mjs`，使用同样的隔离环境变量与临时数据库。覆盖十种宠物的幼年／成长／成年外观、四种成年形态、装备替换、睡醒同步、翻页和刷新，并比较小窝与状态页的装饰及物种定位；在桌面、320px 双倍字号、短屏与强制颜色模式下核对长名字、头像边界和三键约束。成年形态使用通过导入校验的构造旧档，不能作为自然养大或实体手机验收的证据。整页文字可达性另见 `node scripts/check-status-reading.mjs`。

低体力开局专项回归为 `node scripts/check-game-readiness.mjs`，使用同样的隔离环境变量、临时数据库和随机端口。覆盖七款游戏的首次／重复规则入口、服务端拒绝、无开局写入、翻页返回、320px 双倍字号与短屏；另用三颗机身键完成休息、短暂真实恢复、起床和手动开局。起始体力由构造旧档提供，不代表自然多日游玩；正常目录／规则阅读另见 `node scripts/check-arcade-reading.mjs`。

七款小游戏阅读布局专项回归为 `node scripts/check-game-reading-layout.mjs`，使用同样的隔离构建、临时数据库、随机端口和真实 Chromium。覆盖接星星、连连看、贪吃蛇、俄罗斯方块、钓鱼、公园散步、森林寻宝在桌面、390px 手机和 320px 双倍字号下的阅读／暂停态，检查设备外壳高度固定、LCD 内部滚动、长内容底部可达、横向文字不裁切、页面无横溢及三键约束；蛇、俄罗斯方块、钓鱼和散步另会通过 C 实际执行“暂停→继续→再次暂停”，复核外壳几何恢复一致。钓鱼还会通过 C 进入真实暂停菜单。手机寻宝另外以 C 继续真实局，断言 390px 和 320px／200% 根字号下九格完整处于 LCD 可视区。

GitHub Actions 当前运行 Go 竞态测试和构建、前端测试／构建，以及节奏原型协议和算术检查；并不自动包含全部 Chrome 专项验收。另含临时双构建的[稳定运行时与更新缓存检查](BUILD_CACHE.md)。具体以 [CI 配置](../.github/workflows/ci.yml) 为准。

## 游戏结算回复

可选的 `gameReceipt.interest` 只随本次有效终局回复返回：包含 `kind`、`gameId`、`before`、`after` 与 `reason`（`credited`、`cooldown`、`familiar`）；间隔内另有服务端 `retryAt`。它在 SQLite 操作事务中对比本局结算前后的真实兴趣记录，并与请求 ID 的完整回复一起缓存。重复请求、服务重启后的同 ID 回复保留原结果；普通读取、开局、取消、未达计入条件的终局均不补造熟悉度回执。

前端验证游戏与局 ID、结算时间、共同记录、数值和原因一致后，放入现有结算回执。缺少字段的旧回复或无效可选数据保留原有说明；不比较客户端两次状态推算增量。散步奖励拆解与熟悉度可同时返回。此项不增加存档字段，不修改熟悉度、陪玩习惯、成长或金币规则。

可选的 `careFeedback.growthComplete: true` 随喂食、清洁或有效游戏终局的照顾回复返回，要求操作前后均成年且实际成长为零；习惯计入、间隔内和需求已满足三种原因均可带有此标记。它是回复及请求幂等缓存中的说明元数据，不存入宠物状态，不增加存档字段。本次照顾刚跨入成年仍使用原有 `milestone`；睡眠、未完成或不符合计入条件的游戏结果不带此标记。前端只在标记为字面值 `true`、动作与习惯匹配、成长为零且没有阶段里程碑时解释成年；按习惯实际 +1 或 +0 分开说明，保留间隔及需求已满足原因。陪玩间隔说明明确七款游戏共用，区别于各款游戏分别记录的熟悉度。旧回复没有标记时不补造成年解释，不按当前状态推断历史。

隔离浏览器验收 `scripts/check-game-outcome.mjs` 覆盖真实寻宝结算、熟悉度三种结果、陪玩习惯间隔及每日金币额度；加 `--adult-only` 可单独运行成年后的桌面及 320×380 双倍根字号、习惯计入及间隔内四组结算阅读检查。历史时间、成年起点与已熟悉程度使用显式导入夹具，不作为自然多日游玩或实体手机验收证据。

## 存档与安全边界

- SQLite 保存宠物、时间戳、钱包、库存、四槽布置、游戏会话、图鉴、最近 30 条日记及独立永久纪念册。当前支持版本以 `internal/game/game.go` 的 `Schema` 常量为准（本次为 23，兼容 schema 1–22）；实际迁移逻辑位于 `internal/store/`。
- 后端校验规则并事务提交，收到保存成功回复后前端才展示成功。断线、响应异常和多页面冲突先核对状态，不自动重放照顾或继续实时游戏。
- 时间采用服务端 UTC。每次结算最多 12 小时，不是一次离开的全局累计上限；时间倒退时暂停写入并引导校时，不误报存档损坏。
- JSON 导入先预览再确认，由服务端严格校验，替换前保留恢复快照，存档盒可查看最近 10 份并预览确认恢复（见 [自动恢复点](RECOVERY_POINTS.md)）。导入清理未完成对局，不发完成奖励、不补造历史。
- 本地备份可由用户迁移，不宣称防篡改的在线经济。服务重启可续玩，与浏览器缓存不是同一份存储。

专项说明：[连接恢复](SAVE_RECOVERY.md) · [备份确认](BACKUP_CONFIRMATION.md) · [损坏存档修复](CORRUPT_SAVE_RECOVERY.md) · [时间保护](CLOCK_RECOVERY.md) · [多页面存档同步](SAVE_SYNC.md)

## 目录结构

```text
cmd/pet/          HTTP 服务入口
internal/game/    养成规则与时间结算
internal/store/   SQLite 持久化与迁移
internal/httpapi/ JSON API 与静态文件服务
web/              React 前端、素材与前端测试
scripts/          启动脚本、隔离浏览器验收与辅助检查
prototypes/       不接正式存档的独立实验
docs/             玩法说明、专项设计、截图与历史验证
data/             本机存档（不提交）
```

## 协作与文档维护

- 按完整功能批次交付，测试通过后提交并推送；提交身份按 [`AGENTS.md`](../AGENTS.md) 核对，不修改全局 Git 配置，不重写历史。
- 仅使用 A / B / C 三键，不在 LCD 新增可点击玩法控件；保持旧档兼容。
- README 只保留项目介绍、启动和核心玩法；技术细节进专项文档，由[文档导航](README.md)按主题收录。
- 新功能与历史验证不要堆到首页；最新进度放 [PROGRESS.md](PROGRESS.md)，下一步放 [NEXT_STEPS.md](NEXT_STEPS.md)。不要把历史测试数量当成当前全量结果。
- 提交源码、锁文件和测试，不提交数据库、构建输出、工具或私密配置。运行中的玩家服务不会因提交或推送自动更新；部署前应单独确认存档和服务边界。
