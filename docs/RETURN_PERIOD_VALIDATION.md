# 回访历史的起止顺序校验（2026-10-20）

[文档导航](README.md) · [首次回访响应保护](RETURN_RESPONSE_SAFETY.md) · [累计结算规则](RETURN_SETTLEMENT.md)

## 修复什么

`returnRecap.from` 和 `to` 原来各自通过日期检查即可。两个时间戳都可显示，但 `from > to` 时，前端仍接收该历史；回访时长格式化的最小一分钟保护会把负时段显示成「离开了 1 分钟」。标为待读的异常历史也可能进入自动确认流程。

现在响应解析额外要求 **`from <= to`**。在展示、自动确认之前拒绝倒序时段，沿用既有恢复流程，不把负时长截成零、不交换两端、不补造历史。

这是通过受控响应复现的前端保护缺口，**不是发现玩家数据库损坏，也不是声称正常服务端会生成这种历史**。只补这一项顺序检查；不把前端扩展成完整存档校验器，不新增阶段、积分、休息量的配对推断。

## 操作和兼容边界

- 初次访问／轮询出现坏回复：保留连接恢复，B 重新核对；不展示异常小结、不先确认它。
- 照顾或确认请求结果未知：提示「可能已经保存」，A/C 暂停，B 只读取 `/api/state`。连续坏读取不会解锁，不自动重做照顾或确认。
- 正常核对后可用原有三键菜单手动查看真实保存的两页历史；手动查看不重发确认、不补播照顾、不额外发币。
- 仍兼容 `from === to`、从 Unix 零时刻开始的正向时段，以及旧档缺失／null 的历史睡眠信息。未知历史不按当前睡眠状态补填。
- B 核对与手动阅读不重发确认，不等于永久屏蔽之后普通前台心跳对仍待读记录的既有处理。
- 不改后端生产逻辑、schema17、存档内容、衰减／成长／休息／奖励、三键或回访等高布局。

## 回归覆盖

### 前端

- 三种倒序变体 × state／visit／action／recap-read 四入口：12 项拒绝回归。
- 相同时刻、零起点正向时段 × 四入口：8 项兼容回归，接收值不改写。
- 确认已保存／未转发两种结果：2 项 App 恢复回归，检查只发一次确认、连续坏读取仍锁定、恢复后两页可读且无额外照顾请求。
- 原实现新增用例为 **14 失败／8 通过**；修复后两文件全部 **218 项通过**。

### 独立 Chrome

`scripts/check-growth-response.mjs` 的 `return` 范围现在包括：

1. 倒序历史的初次访问、轮询、已保存照顾、未转发照顾：4 组。
2. 日期／需求／倒序历史三种确认回复 × 已保存／未转发：6 组。
3. 清醒／睡眠 × 历史睡眠字段缺失／null：4 组。

共14组，保留390px普通字号与320px双倍根字号的原分配；不是所有场景与视口的笛卡尔积。检查恢复提示、保存计数、成长形态／金币不变、正常核对后的手动回看、文字边界和底部可达、三个机身按钮及LCD无新增玩法控件。倒序值仅注入浏览器响应，不写入临时库；真实保存是否发生由独立服务状态核对。

浏览器时钟／历史时间平移都是受控夹具，不代替自然长离开、实体手机或真人长玩验收。另用既有累计结算及等高布局脚本交叉检查正常回访。

## 重复运行

使用独立构建与临时数据库，不能指向玩家实例：

```sh
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixelpet-return-period.XXXXXX")"
./.tools/go/bin/go build -o "$CHECK_DIR/pixelpet" ./cmd/pet
(cd web && ./node_modules/.bin/vite build --outDir "$CHECK_DIR/web")

export PIXELPET_TEST_BINARY="$CHECK_DIR/pixelpet"
export PIXELPET_TEST_WEB="$CHECK_DIR/web"
export PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
PIXELPET_TEST_SCOPE=return node scripts/check-growth-response.mjs
PIXELPET_TEST_SCOPE=settlement node scripts/check-growth-response.mjs
node scripts/check-return-layout.mjs
```

脚本各自创建SQLite和随机端口，保留结果与截图，退出时只关闭自己的服务。源码提交／推送不等于部署；本批不访问、刷新、重启或部署玩家18102，不修改玩家数据库与共享 `bin/pixelpet`、`web/dist`。

## 本轮结果

- 前端全量 **4438项／163文件**、TypeScript和独立Vite构建通过；原有主包大于500kB提示仍在，不宣称优化体积。
- Go全量无缓存race、vet及独立二进制构建通过；Node脚本及独立节奏原型 **64项通过**，原型仍不接正式游戏。
- Chrome回访保护 **14组**、真实服务累计结算 **6组**、原有等高／滚动布局 **12组**通过，共32组。累计结算采用受控24／48小时时段，验证12／24／20小时实际计入，不是自然等待；布局涵盖1200／390／320px、14／28px根字号和清醒／睡眠。
- 已查看倒序恢复的390px／320px大字号截图、恢复后两页历史及320px大字号滚动到底的布局截图。恢复中的浮层提示仍按原有行为显示；没有借截图隐藏错误提示，也不据此宣称完成全部遮挡或辅助技术验收。
- 构建与日志：`/tmp/pet-return-period/`。本轮临时产物位于系统临时目录 `pixelpet-growth-response-PfrEaq`（保护）、`pixelpet-growth-response-V9DRqg`（结算）、`pixelpet-return-layout-hiwCQ2`（布局）。保护清单的玩家库、共享二进制和前端七文件保持不变。
