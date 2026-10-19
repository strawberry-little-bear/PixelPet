# 机身三键的原生键盘激活（2026-10-19）

## 已复现的问题

全局快捷键一直把 Enter / 空格映射为 B，即使焦点已经在机身 A 或 C 上。Tab 到 C 后按 Enter，实际执行的不是返回，而是确认；导入预览为了安全默认聚焦 C，却因此可能确认替换整份存档。

- 新增组件回归在原实现上有 6 项失败，包含 Enter / 空格误触 A/C，以及默认 C 焦点下误导入。
- 独立临时数据库的 Chrome 实测，原版上第一个场景就失败：焦点在 C，原生 Enter 后，服务端存档名称从「键盘伙伴」变成「备份里的伙伴」。不只是 DOM 或 mock 断言；玩家存档未参与复现。
- 初步修正映射后，Chrome 进一步复现长按空格松开仍补发原生 click：四个 keydown 都已 `defaultPrevented`，三个 repeat 都为 true，keyup 后仍有可信 click，A 从第一项跳到了第三项。只靠 keydown 去重不够。

## 修复范围

`web/src/App.tsx`：

- 焦点在三个机身按钮时，Enter / 空格激活该按钮对应的 A/B/C，和点按一致。
- 不在机身按钮时，原有 Enter / 空格 → B 快捷键不变；明确输入 A/B/C、方向快捷键和 Escape 也不随焦点改义。
- 映射键 keydown 仍阻止默认行为和 repeat。另仅对机身按钮的普通 Space keyup 阻止原生补发 click，不在松开时再发一次操作。
- 非玩法按钮、输入、链接、组合键及输入法保护不变；回访阅读区域的空格/方向键仍留给原生滚动。
- 玩法说明补充 Tab 聚焦后用 Enter / 空格操作当前按钮。不增加玩法键、LCD 点击控件或存档字段，不修改成长/照顾规则。

## 验收

新增 38 项组件回归，覆盖三按钮激活、长按、导入确认/取消、明确的全局快捷键、松键保护，以及非玩法/输入法/组合键边界。完整前端 **2491 项 / 100 文件**、TypeScript、独立目录生产构建通过；Go 无缓存 race（包串行）、vet、构建及既有节奏算术 6 项通过。

`scripts/check-physical-keyboard.mjs` 使用独立临时服务、数据库、随机端口和单独 Chrome，不拦截响应，也不伪造已保存结果：

- 1200/320px × 14/28px 根字号 × Enter/Space × 菜单/导入预览 × A/B/C，共 **48 组**。320px 使用强制颜色，全部减少动态效果。
- 每组经 Tab 验证 A→B→C；原生 keydown 四次（首次及三次 repeat）再 keyup，检查可信事件、默认行为被阻止且没有补发 click。
- 菜单 A 只移动一项，C 只返回，B 只保存一次喂食。导入 A/C 不发写请求且保持原伙伴，只有 B 替换一次；特别保留预览自动聚焦 C 的路径。
- 非玩法的帮助关闭按钮仍用原生 Enter/Space 激活，关闭后焦点恢复，未把辅助控制也当成玩法键。
- 同时检查独立库权威状态、写请求数量、三机身按钮、LCD 无点击玩法控件及无 pageerror。320px/双倍字号截图另留在脚本输出目录。

既有回访布局 **12 组**、键盘阅读 **96 组**、原生滚动中途换页 **96 次**也在本批构建上复跑通过。为避免改动共享输出，原回归脚本复制到临时目录，`web/dist` 链接本批独立构建；脚本内容未改，每次仍创建自己的临时数据库和端口。

测试构建输出放 `/tmp`，不覆盖共享 `web/dist`，不刷新玩家标签或重启原服务。原玩家库 SHA256 保持 `a8b712d5419fe6227b255f4d63869612e451da7abddffd60124de8ee65c23eee`。

这是 Chrome 原生输入自动化，不是实体手机、读屏器或所有浏览器认证。不会自动改写已导入的任何存档；本批只防止后续误操作。

## 重跑

```sh
export PATH="/Users/xjx/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
./.tools/go/bin/go build -o /tmp/pixelpet-physical-keys ./cmd/pet
# 指定新的输出目录，避免覆盖玩家服务正在使用的共享构建。
(cd web && ./node_modules/.bin/tsc -b && ./node_modules/.bin/vite build --outDir /tmp/pixelpet-physical-check)
PIXELPET_TEST_BINARY=/tmp/pixelpet-physical-keys \
PIXELPET_TEST_WEB=/tmp/pixelpet-physical-check \
PIXELPET_PLAYWRIGHT_MODULE=/绝对路径/playwright/index.mjs \
node scripts/check-physical-keyboard.mjs
```

脚本正常或断言失败均关闭自己的浏览器和服务；日志给出结果/截图目录，不连接用户端口。
