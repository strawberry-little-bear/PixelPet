# 接受状态响应时同步显示时钟（2026-10-20）

## 首批：接受响应时立即同步

App 原先接受响应时只更新服务端与浏览器的时间差，显示用的 `now` 要等下一次 interval 才更新（普通页1000ms、游戏100ms）。首次加载、浏览器时钟偏差或收到新校时后，在下一次显示tick之前，新状态会短暂搭配旧时间：相识天数、缺少growth的旧响应阶段估算、接星星光点、今日问候及游戏额度可能显示不一致。

现在在通过revision / generation接受判断后，将 `now` 与响应的 `serverTime` 同批更新；旧响应仍不能改显示时钟。后续interval继续使用既有偏移。状态记录时间仍取同一份状态的 **lastTick**，不替换成serverTime。

这是前端响应与显示的一致性修复，不改服务端时间防护、成长/需求数值、奖励、schema、旧档或三键。错误的领取提示可能影响按B是否发请求，但服务端原有校验仍有效；不是重复产币漏洞。首批尚未处理响应之后的本机时钟跳变，后续修复见下；两批都不声称消除所有网络延迟。

## 首批验收

- 新增 `AppClock.test.tsx` **16项**：浏览器前后偏差七天及正常时间，初始相识天数、旧阶段估算、星星位置、今日问候和显式B、接受新读取或接取响应、拒绝旧revision及后续tick。全程不需等待第一次显示interval来通过即时断言。
- 最终16项放进独立旧源码副本验证：**12失败、4通过**；不是16项全红。读取时间前后变化是前端响应夹具，不代表后端允许时间回拨。
- 全量前端 **3507项 / 137文件**、TypeScript、独立Vite构建、Go无缓存全量race、vet及独立二进制构建通过。
- 新增 `scripts/check-app-clock.mjs`，独立Chrome **36组**：三种浏览器偏差 × 桌面/320px双倍字号 × 状态、旧响应、接星星、已领问候、可领问候、额度耗尽六场景。只偏移浏览器Date.now，不修改OS或服务端时钟。
- 浏览器明确hold App的100ms/1000ms显示interval，rAF、输入、网络及timeout保持真实。断言验证的是第一次显示tick之前的一致性，不是自然长时试玩。脚本记录并转交真实HTTP响应；**旧响应场景显式移除growth并设schema1**，不冒称旧服务。可领问候和额度耗尽通过导入构造的经济历史准备，不是实际陪玩赚币；已领问候通过真实daily命令预领。
- 每组核对三键、LCD无新增可点击玩法控件、无横向溢出或文字越出LCD左右、无浏览器运行异常；页面打开后没有玩法写请求，已领问候按B也不重复发送领取。星星只观察实际响应对应位置，不接取、不自动完成。
- 同脚本对上一批独立前端构建在第一组相识天数断言失败。共享bin/dist的符号链接别名均在启动前被拒绝。
- 既有状态读数 **48组**、每日刷新 **54组**交叉回归通过。最终桌面状态/旧估算、320px双倍字号状态/已领问候/星星截图已复核；已领问候截图在按B产生toast前截取，避免遮挡，不为截图改变产品。

日志和独立构建：`/tmp/pet-clock-sync/`。

最终浏览器产物：
- 新增36组：`/var/folders/12/7y0bpzpj5055788qjjnq3c9c0000gn/T/pixelpet-app-clock-8mnP5b`
- 状态48组：`/var/folders/12/7y0bpzpj5055788qjjnq3c9c0000gn/T/pixelpet-status-reading-FT5xXV`
- 每日刷新54组：`/var/folders/12/7y0bpzpj5055788qjjnq3c9c0000gn/T/pixelpet-daily-refresh-DybhwE`

未访问、重启或部署玩家18102服务；全部使用独立构建、随机端口及临时SQLite。提交前核验玩家数据库、共享bin/dist七文件SHA256及dist完整文件列表不变。持续完善目标保留。

## 后续：运行途中调整本机日期，不跳动游戏时间

首批只修了接受响应的瞬间。随后证实：接受正常响应后，再前拨或后拨浏览器Date.now，下次真实显示tick仍会把相识天数、旧成长估算、星星位置或每日提示带偏。本批将偏移计算换为 **已接受serverTime + performance.now经过时间**；每次接受响应重新锚定，不让之后的本机墙钟跳变决定游戏时间。四款自动步进游戏（蛇、方块、钓鱼、散步）的下一步等待也使用同一时钟，原速率、最小等待、服务端校验及离开后的手动续局不变。

这仍只是显示与调度时间源的修复：不推算/修改需求、成长或奖励，不新增自动领取，不改schema、旧档与三键。lastTick仍是状态读数的记录时间。performance.now在部分环境的系统休眠期间不一定推进，返回时仍依赖原有权威读取重新锚定；不冒称离线结算算法改动、所有设备休眠认证或网络公平性保证。短暂回窝对白等纯视觉超时未纳入本批，不声称所有Date.now用途都已替换。

- 新增 **10项**：7项App覆盖运行途中正/负七天偏移（另加1234ms避免星星周期巧合）、天数/星星/已领问候、无写请求及模拟经过时间跨UTC日（fake timers）后仍需明确B领取；3项时间源测试覆盖经过时间、重新锚定与非负采样差。App最终23项在上一批独立源码副本上 **6失败 / 17通过**，其中原有16项均通过，新增7项中6失败、1个控制通过；不把所有控制都算红测试。
- 定向七文件197项（新增跨日用例之前），最终全量前端 **3517项 / 138文件**、TypeScript及独立Vite构建通过；Go无缓存全量race、vet和独立构建通过。原有游戏暂停、续局、输入、迟到回复和音效测试仍通过；未用浏览器长局覆盖每款游戏的所有成绩分支。
- `check-app-clock.mjs --jump-after-load` 新增 **36组**浏览器运行模式：正常加载接受响应后才调整Date.now，100ms/1000ms显示interval **真实运行**，实际等待1100ms；rAF、timeout、performance.now和服务端/OS时钟都不改。星星在900ms周期中段对照同机未改变的服务端/测试进程时钟，避开100ms显示频率的边界误差；不接取、不自动完成。
- 默认首次加载模式 **36组**交叉通过，仍hold首次显示tick，两种测试模式不能混称。两者都保留原先的六场景、桌面/320px双倍字号、三键和边界检查；runtimeJump字段记录于results.json。原先的growth缺失响应夹具、导入构造经济历史和真实预领问候的区分保持，不冒称自然多日游玩。
- 运行模式对上一批独立前端构建在第一组相识天数断言失败。最终两模式各36个独特组合、均无浏览器玩法写请求或运行异常；运行模式读取后到观察时确实经过1115–1160ms。已复核运行模式320px大字状态及接星星截图。

本批日志/构建：`/tmp/pet-monotonic-clock/`。运行模式产物：`/var/folders/12/7y0bpzpj5055788qjjnq3c9c0000gn/T/pixelpet-app-clock-shEqjf`；首次加载交叉产物：`/var/folders/12/7y0bpzpj5055788qjjnq3c9c0000gn/T/pixelpet-app-clock-qcojeR`。未访问、重启或部署18102玩家服务；提交前核验七文件SHA256和dist完整列表不变。

## 独立复跑

```sh
.tools/go/bin/go test -count=1 -race ./...
.tools/go/bin/go vet ./...
.tools/go/bin/go build -o /tmp/pet-clock-sync/pixelpet ./cmd/pet
(cd web && ./node_modules/.bin/vitest run --maxWorkers=4)
(cd web && ./node_modules/.bin/tsc -b)
(cd web && ./node_modules/.bin/vite build --outDir /tmp/pet-clock-sync/web)
PIXELPET_TEST_BINARY=/tmp/pet-clock-sync/pixelpet \
PIXELPET_TEST_WEB=/tmp/pet-clock-sync/web \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-app-clock.mjs
```

需将Node加入PATH并安装Chrome；按本机环境替换Playwright模块路径。对既有 `check-status-reading.mjs` / `check-daily-refresh.mjs` 使用相同三个环境变量复跑。脚本拒绝共享bin/dist及其符号链接别名，不接触玩家服务。

本批复跑时将上述输出目录改为 `/tmp/pet-monotonic-clock`；浏览器默认模式和新增模式分别运行：

```sh
node scripts/check-app-clock.mjs
node scripts/check-app-clock.mjs --jump-after-load
```

两条命令都需沿用上面的三个环境变量，指向本批独立binary/web和本机Playwright模块，不使用玩家服务。

## 后续：回窝短回应

上面显示校时两批明确排除的本地临时回应，现已单独改为同源的performance截止时间；不使用serverTime锚点、不改存档时间或12秒规则。问题复现、边界和独立验收见[HOME_ECHO_CLOCK.md](HOME_ECHO_CLOCK.md)。

## 后续：局内陪伴造型

贪吃蛇／方块组件剩余的 `petGrowth(pet, Date.now())` 已改为显式接收 App 的校准 `now`。仅影响响应缺失成长记录时的兼容预览；正常保存记录优先、原校时算法与成长结算不变。复现边界、三阶段与刷新／真实步进验收见 [GAME_COMPANION_CLOCK.md](GAME_COMPANION_CLOCK.md)。
