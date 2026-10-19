# 回访小结的历史睡眠状态（2026-10-19）

## 本批内容

回访小结原先只记录需求、阶段、成长与有效休息，无法直接看出离开时和结算结束时是否睡眠。本批在已有两页小结中补充两个历史时点：

- 「离开时：睡眠 / 清醒 / 未记录」来自上次前台活动后的已保存基线。
- 「结算结束时：睡眠 / 清醒 / 未记录」来自本次时间结算后、返回操作前的状态。回来第一下是起床，也不会把过去写成清醒。
- 明确说明这只是两个时点，不代表当前状态或整个离开期间。轮询、当前需求变化、起床、翻页和刷新不改写历史。
- 旧基线或旧小结缺失的状态显示「未记录」，不从体力增长或当前宠物推断。缺失字段继续省略，新清醒状态明确保存为 `false`。
- 仍在已有两页内，A 循环翻页、B 继续/回小窝、C 返回，无新 LCD 点击控件或写请求。

服务端仅在安装级 `visits` 元数据的快照增加可选 `sleeping`，不变更 portable save 或 schema 12；不修改衰减、恢复、成长、奖励、12 小时结算上限和小结认领规则。重复 action 仍不重放小结通知，也不再次切换睡眠。

## 放大阅读修复

检查截图时发现原固定像素三列会在双倍字号下拆开「饱食」和有符号小数。已改为可换行的完整读数单元：名称、前后值、差值各自不拆字，空间不足时差值独立换行。不缩小文字或三键面积；页面按内容自然增高。

## 验证

- 红测：新增界面 8 项失败，Go 清醒/睡眠/旧基线/重启用例因缺少真实字段失败；日志为本机 `/tmp/pet-return-sleep-red-{web,go}.log`。
- 新增前端 9 项，涵盖两个页面的 true/false、全旧/部分旧记录、无控件、重渲染和真实 App 三键/轮询保留历史；全量 **1322 项 / 63 文件**、TypeScript 与生产构建通过。
- Go 新增 4 个测试函数（含清醒、睡眠两个返回动作分支）：记录动作前状态与动作后基线、实际体力增减、重复请求不写业务表、不重放通知、旧字段缺失、值复制、重启与认领。全量 `-race -count=1`、vet、构建通过。原精度回归改用深值比较，避免把新可选字段的指针地址差异误认为历史被改写。
- 既有节奏算术 6 项通过，没有新增节奏小游戏。
- 独立临时库、真实 Chrome **41 项**通过：4 组清醒/睡眠/旧基线/全旧小结的重看刷新；320/390/1200 宽 × 普通/双倍字号 × 普通/强制配色与减少动态，共 12 组分别核对需求页、成长页及三键/前台同步（36 项）；另 1 项真实三键起床后认领仍保留睡眠历史。
- 逐项检查文本边界、字体放大、无横向溢出、需求名称及数值完整一行、三键至少 44px、无 LCD 玩法控件、无页面错误。除专门的起床场景外，阅读无 action/import/reset/recap-read 请求。
- 布局红测确实捕获 320px 双倍文字拆行，见 `/tmp/pet-return-sleep-layout-red.log`。首次浏览器起床夹具误把小窝 B 当成起床（实际是打开菜单），等待超时；改为 A 打开菜单、A 选择睡眠项、B 确认后，最终 41 项通过，没有为适配夹具修改游戏操作。
- `return-sleep.png`、`return-sleep-large-text.png`、`return-sleep-legacy.png` 最终截图均已查看。

## 复查与边界

持久测试位于 `internal/store/recap_sleep_test.go`、`web/src/ReturnSleep.test.tsx` 和 `web/src/ReturnNavigation.test.tsx`，连同既有回归运行：

```sh
pnpm --dir web test
pnpm --dir web build
node --test scripts/evaluate-rhythm.test.mjs
./.tools/go/bin/go test -race -count=1 ./...
./.tools/go/bin/go vet ./...
./.tools/go/bin/go build -o /tmp/pixelpet-return-sleep-verified ./cmd/pet
```

本机临时浏览器脚本 `/tmp/pixelpet-return-sleep-browser.mjs`，日志 `/tmp/pet-return-sleep-browser.log`，分项 `/tmp/pet-return-sleep-browser-results.json`；最终临时库 `/tmp/pixelpet-return-sleep-fN3Qvi/test.db`。这些临时文件不是仓库内的持久浏览器回归入口。历史间隔由临时库夹具模拟并经真实服务结算，不冒称自然等待或用户试玩反馈。

自己的 18127 服务已停止。玩家库 SHA256 保持 `a8b712d5419fe6227b255f4d63869612e451da7abddffd60124de8ee65c23eee`，原玩家进程未重启；未自动部署，新历史记录需要更新后的服务。持续迭代目标保留，后续仍优先照顾、离线恢复与可复现的试玩问题，不把已有六游戏或旧功能重复算作新交付。
