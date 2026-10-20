# 成长／回访／睡眠浏览器构建隔离（2026-10-20）

## 确认的问题

`check-growth-response.mjs` 原先固定把 `PIXELPET_WEB` 设为仓库共享 `web/dist`，忽略调用方的 `PIXELPET_TEST_WEB`。数据库虽是临时库，页面却可能仍为旧版本，不能据此宣称验证了当前前端。用只记录启动环境就退出的假服务复现：请求独立临时 web 路径，实际收到仓库 `web/dist`；不是玩家游戏状态故障。

相邻四个回访脚本存在共享 dist 默认值，回访视口只检查绝对路径，睡眠进度只检查路径字符串。因此本批统一七个入口：`growth-response`、`return-layout`、`return-scroll`、`return-viewport`、`return-touch`、`return-keyboard`、`sleep-progress`。

## 当前规则

- 必填绝对 `PIXELPET_TEST_BINARY` 和 `PIXELPET_TEST_WEB`，不从玩家环境或共享 dist 补默认值。
- 在导入 Playwright、开端口、启动服务前检查；拒绝共享 bin／dist 内路径、目录/文件软链别名、共享二进制及 web 入口硬链接。web 必须含 `index.html`，启动时打印规范化后的实际路径。
- 七个脚本仍各自创建临时 SQLite 和随机端口，覆盖继承的 `PIXELPET_DB`、`PIXELPET_ADDR`、`PIXELPET_WEB`，不接受玩家 URL，不访问18102。
- 此检查验证入口路径隔离，不校验所有资源内容、递归资源链接、构建新旧或源代码哈希；调用方仍须先构建本轮产物。可以明确提供隔离旧构建做红绿对照，不能将其写成当前版本验收。
- 这是七个脚本的定向修复，不宣称仓库全部历史脚本已经迁移；旧文档历史验收记录不重写。

不改产品页面、三键、schema17、成长/照顾/奖励或旧存档。不使用、修改玩家库、共享 bin／dist，也不重启玩家服务。

## 重跑

```sh
mkdir -p /tmp/pet-build-isolation
export PIXELPET_TEST_BINARY=/tmp/pet-build-isolation/pixelpet
export PIXELPET_TEST_WEB=/tmp/pet-build-isolation/web
.tools/go/bin/go build -o "$PIXELPET_TEST_BINARY" ./cmd/pet
(cd web && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build --outDir "$PIXELPET_TEST_WEB")
export PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
node --test scripts/browser-test-builds.test.mjs
for name in growth-response return-layout return-scroll return-viewport return-touch return-keyboard sleep-progress; do
  node "scripts/check-$name.mjs" || exit 1
done
```

单元与入口测试36项：缺少/相对路径、正常别名、共享软链/父目录别名/硬链接、缺入口/错误文件类型、无共享产物的干净环境；七入口分别测试提前拒绝缺 web，并用假服务检查真实传入的构建、临时库、随机地址。假服务主动以23退出，仅验证启动接线，不计作浏览器游玩或真实后端结算。

完整浏览器及全量结果在本轮 `PROGRESS.md` 记录；日志、独立构建在 `/tmp/pet-build-isolation/`。历史小结和异常回复仍由原脚本夹具提供；短睡不代替自然长睡、自然多日养成或实体设备验收。
