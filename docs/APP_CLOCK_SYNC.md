# 接受状态响应时同步显示时钟（2026-10-20）

## 问题与修复

App 原先接受响应时只更新服务端与浏览器的时间差，显示用的 `now` 要等下一次 interval 才更新（普通页1000ms、游戏100ms）。首次加载、浏览器时钟偏差或收到新校时后，在下一次显示tick之前，新状态会短暂搭配旧时间：相识天数、缺少growth的旧响应阶段估算、接星星光点、今日问候及游戏额度可能显示不一致。

现在在通过revision / generation接受判断后，将 `now` 与响应的 `serverTime` 同批更新；旧响应仍不能改显示时钟。后续interval继续使用既有偏移。状态记录时间仍取同一份状态的 **lastTick**，不替换成serverTime。

这是前端响应与显示的一致性修复，不改服务端时间防护、成长/需求数值、奖励、schema、旧档或三键。错误的领取提示可能影响按B是否发请求，但服务端原有校验仍有效；不是重复产币漏洞。也不声称解决响应之后任意本机时钟跳变或所有网络延迟问题。

## 验收

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
