# 三键键盘输入安全（2026-10-19）

## 复现与修复

全局快捷键原先没有排除输入法组字事件：`isComposing` 或旧浏览器 `keyCode=229` 的 A/B/C、方向键、回车、空格和 Escape 也会进入游戏控制。帮助/重新开始弹窗另有捕获阶段的焦点处理，组字时的 Escape/Tab 仍会关闭弹窗或循环焦点，不能只修全局监听。

本批仅调整这两处键盘入口：

- 两处均放过组字标志及旧式 229 事件，不取消输入法事件、不触发游戏或弹窗快捷键。
- 全局监听尊重其他处理器已取消的事件，并放过原生 `isContentEditable` 目标（含继承可编辑的子元素）。原有输入框、链接、工具按钮和修饰键过滤保留。
- 普通 A/B/C 及其既有别名不变；重复事件仍阻止机身按钮的原生 Enter/空格激活，但不重复调用游戏控制，不能简单提前放过所有重复键。
- 机身三键的点击/触摸不经过上述键盘过滤；不新增编辑器或 LCD 可点击玩法控件，不改变页面、玩法、成长、奖励或 schema 12。

## 验证

- 新增 `web/src/KeyboardSafety.test.tsx` **46 项**。修复前 **34 失败 / 12 通过**，修复后全部通过；覆盖两种组字标志、菜单、睡眠、孵化、备份确认、游戏、帮助焦点、已取消事件、可编辑目标和普通三键。针对性连同 App/备份预览 **131 项**通过。
- 前端全量 **1368 项 / 64 文件**，TypeScript/生产构建通过。既有节奏算术 **6 项**通过，没有开发新节奏游戏。
- Go 全量 `test -race -count=1 ./...`、`vet ./...`、构建通过，后端源码与存档格式未改。
- 独立临时库的真实 Chrome **44 项检查**通过：两种合成组字事件的九种快捷键；菜单、实际起床/备份确认；帮助和重置弹窗及正常 Tab/Escape 焦点；原生键盘别名；在聚焦 A 按钮时长按 Enter/空格只喂食一次；真实继承可编辑 DOM 与显式 `contenteditable=false` 边界；已消费事件；390px 触摸机身 A/B/C。
- 浏览器检查实际 API 写入：忽略的键不触发照顾/导入/重置；正常确认才保存，机身按钮仍仅三个，LCD 无新增控件，页面无脚本错误。临时可编辑 DOM 仅由验收脚本注入，不加入产品。

**验收边界：**组字场景是在真实 Chrome 中派发带标志的合成 `KeyboardEvent`，不是操作系统中文/日文输入法的实机选词测试；不宣称所有输入法或 Safari/Firefox 已认证。jsdom 不实现继承的 `isContentEditable`，单测显式建模该属性，原生继承/非继承边界由 Chrome 验证。界面布局未改，本批没有新增截图或真实用户试玩反馈。

## 复查

```sh
pnpm --dir web test
pnpm --dir web build
node --test scripts/evaluate-rhythm.test.mjs
./.tools/go/bin/go test -race -count=1 ./...
./.tools/go/bin/go vet ./...
./.tools/go/bin/go build -o /tmp/pixelpet-keyboard-safety ./cmd/pet
```

本机红测 `/tmp/pet-keyboard-safety-red.log`，全量 `/tmp/pet-keyboard-safety-{web,go}-final.log`，浏览器脚本 `/tmp/pixelpet-keyboard-safety-browser.mjs`，日志/分项 `/tmp/pet-keyboard-safety-browser{.log,-results.json}`，临时库 `/tmp/pixelpet-keyboard-safety-yLabad/test.db`。浏览器脚本和临时库不是仓库中的持久回归入口；持久回归是上述 Vitest 文件及原 App 的长按/焦点测试。

自己的 18128 测试服务已停止；不操作 `data/pixelpet.db`，保留原有服务进程，不主动刷新玩家页面或部署/重启后端。构建会生成本地 `web/dist`；若某个原服务使用该目录，页面下次重新加载可能取得新前端，不能据此宣称整套服务已部署。持续目标保留，后续优先处理可复现的照顾/离开恢复问题；真实系统输入法仍待人工试玩验收。
